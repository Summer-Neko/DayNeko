from __future__ import annotations

import json
import sqlite3
import hashlib
import base64
import binascii
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .admin import router as admin_router

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "dayneko.db"
MEDIA_ROOT = ROOT / "media"
PUBLIC_MEDIA_PREFIX = "/media"


class User(BaseModel):
    id: str
    name: str
    handle: str
    avatar: str | None = None
    machineKey: str | None = None


class BootEvent(BaseModel):
    id: str
    userId: str
    date: str | None = None
    startedAt: str
    endedAt: str | None = None
    device: str
    updatedAt: str | None = None


class ActivityEntry(BaseModel):
    id: str
    userId: str
    label: str
    mood: str
    date: str | None = None
    startedAt: str
    endedAt: str | None = None
    source: Literal["manual", "auto"] = "manual"
    updatedAt: str | None = None


class ScheduleItem(BaseModel):
    id: str
    userId: str
    title: str
    kind: Literal["daily", "temporary"]
    rotationDay: int = Field(ge=0, le=6)
    doneDates: list[str] = Field(default_factory=list)


class Friend(BaseModel):
    id: str
    name: str
    handle: str
    status: str
    mood: str
    lastSeen: str


class Review(BaseModel):
    id: str
    friendId: str
    scheduleTitle: str
    score: int = Field(ge=1, le=5)
    comment: str
    createdAt: str


class EvidenceImage(BaseModel):
    id: str
    name: str
    dataUrl: str = ""
    mimeType: str | None = None
    mediaUrl: str | None = None
    size: int
    date: str | None = None
    createdAt: str


class CustomEvent(BaseModel):
    id: str
    userId: str
    title: str
    description: str = ""
    date: str
    repeatDaily: bool = False
    isTemplate: bool | None = None
    templateId: str | None = None
    completedDates: list[str] = Field(default_factory=list)
    evidence: list[EvidenceImage] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class DailyRating(BaseModel):
    id: str
    userId: str
    date: str
    rank: Literal["SSS", "S", "A", "B", "C"]
    comment: str
    createdAt: str
    updatedAt: str


class FriendRating(BaseModel):
    id: str
    targetUserId: str
    raterFriendId: str
    date: str
    rank: Literal["SSS", "S", "A", "B", "C"]
    comment: str
    eventIds: list[str] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class DirtyRecord(BaseModel):
    id: str
    kind: Literal["user", "boot", "activity", "event", "daily-template", "friend", "daily-rating", "friend-rating", "presence"]
    payload: dict[str, Any]
    changedAt: str


class SyncPayload(BaseModel):
    user: User
    boots: list[BootEvent] = Field(default_factory=list)
    activities: list[ActivityEntry] = Field(default_factory=list)
    schedules: list[ScheduleItem] = Field(default_factory=list)
    events: list[CustomEvent] = Field(default_factory=list)
    dailyTemplates: list[CustomEvent] = Field(default_factory=list)
    friends: list[Friend] = Field(default_factory=list)
    reviews: list[Review] = Field(default_factory=list)
    dailyRatings: list[DailyRating] = Field(default_factory=list)
    friendRatings: list[FriendRating] = Field(default_factory=list)


class ChangesPayload(BaseModel):
    user: User
    changes: list[DirtyRecord] = Field(default_factory=list)


class FriendRequestCreate(BaseModel):
    fromUserId: str
    toHandle: str


class FriendRequestAction(BaseModel):
    userId: str


class DeviceAuthPayload(BaseModel):
    machineKey: str
    name: str | None = None
    avatar: str | None = None


app = FastAPI(title="DayNeko API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(admin_router)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_data_url(value: str | None) -> bool:
    return bool(value and value.startswith("data:") and "," in value)


def public_media_url(relative_path: str) -> str:
    normalized = relative_path.replace("\\", "/")
    return f"{PUBLIC_MEDIA_PREFIX}/{normalized}"


def absolute_media_url(request: Request | None, value: str | None) -> str | None:
    if not value:
        return value
    if value.startswith("http://") or value.startswith("https://") or value.startswith("data:"):
        return value
    if not value.startswith(PUBLIC_MEDIA_PREFIX):
        return value
    if request is None:
        return value
    return f"{str(request.base_url).rstrip('/')}{value}"


def safe_path_part(value: str, fallback: str = "image") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip()).strip("-")
    return cleaned or fallback


def media_extension(mime_type: str) -> str:
    return {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    }.get(mime_type.lower(), "bin")


def decode_data_url(data_url: str) -> tuple[str, bytes]:
    header, body = data_url.split(",", 1)
    mime_type = (
        header.removeprefix("data:")
        .split(";", 1)[0]
        .strip()
        or "application/octet-stream"
    )
    if not mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="only image data urls are supported")
    try:
        return mime_type, base64.b64decode(body, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid image data url") from exc


def save_media_asset(
    conn: sqlite3.Connection,
    *,
    asset_id: str,
    owner_user_id: str,
    kind: Literal["avatar", "evidence"],
    data_url: str,
    record_id: str | None = None,
    file_stem: str = "image",
) -> dict[str, Any]:
    mime_type, content = decode_data_url(data_url)
    extension = media_extension(mime_type)
    if extension == "bin":
        raise HTTPException(status_code=400, detail="unsupported image type")

    if kind == "avatar":
        relative_dir = Path("avatars")
        filename = f"{safe_path_part(owner_user_id, 'user')}.{extension}"
    else:
        relative_dir = Path("evidence") / safe_path_part(owner_user_id, "user") / safe_path_part(record_id or "record")
        filename = f"{safe_path_part(file_stem)}.{extension}"

    target_dir = MEDIA_ROOT / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / filename
    target.write_bytes(content)
    relative_path = (relative_dir / filename).as_posix()
    now = utc_now()
    conn.execute(
        """
        insert into media_assets (id, owner_user_id, record_id, kind, file_path, mime_type, size, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
            owner_user_id=excluded.owner_user_id,
            record_id=excluded.record_id,
            kind=excluded.kind,
            file_path=excluded.file_path,
            mime_type=excluded.mime_type,
            size=excluded.size,
            updated_at=excluded.updated_at
        """,
        (asset_id, owner_user_id, record_id, kind, relative_path, mime_type, len(content), now, now),
    )
    return {
        "id": asset_id,
        "url": public_media_url(relative_path),
        "mimeType": mime_type,
        "size": len(content),
    }


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            create table if not exists users (
                id text primary key,
                name text not null,
                handle text not null unique,
                avatar text,
                avatar_media_id text,
                machine_key text unique,
                updated_at text not null
            );

            create table if not exists records (
                id text primary key,
                user_id text not null,
                kind text not null,
                payload text not null,
                updated_at text not null
            );

            create table if not exists media_assets (
                id text primary key,
                owner_user_id text not null,
                record_id text,
                kind text not null,
                file_path text not null,
                mime_type text not null,
                size integer not null,
                created_at text not null,
                updated_at text not null
            );

            create table if not exists friend_requests (
                id text primary key,
                from_user_id text not null,
                to_user_id text not null,
                status text not null,
                created_at text not null,
                updated_at text not null,
                unique(from_user_id, to_user_id)
            );

            create table if not exists friendships (
                id text primary key,
                user_a text not null,
                user_b text not null,
                created_at text not null,
                unique(user_a, user_b)
            );
            """
        )
        columns = {row["name"] for row in conn.execute("pragma table_info(users)").fetchall()}
        if "avatar" not in columns:
            conn.execute("alter table users add column avatar text")
        if "avatar_media_id" not in columns:
            conn.execute("alter table users add column avatar_media_id text")
        if "machine_key" not in columns:
            conn.execute("alter table users add column machine_key text")
        conn.execute("create unique index if not exists idx_users_machine_key on users(machine_key)")
        conn.execute("create index if not exists idx_records_user_kind on records(user_id, kind)")
        conn.execute("create index if not exists idx_records_updated_at on records(updated_at)")
        conn.execute("create index if not exists idx_media_owner on media_assets(owner_user_id, kind)")
        conn.execute("create index if not exists idx_media_record on media_assets(record_id, kind)")
        migrate_existing_media(conn)


def normalize_user_media(conn: sqlite3.Connection, user_id: str, avatar: str | None) -> tuple[str | None, str | None]:
    if not is_data_url(avatar):
        return avatar, None
    media = save_media_asset(
        conn,
        asset_id=f"avatar:{user_id}",
        owner_user_id=user_id,
        kind="avatar",
        data_url=avatar or "",
        record_id=user_id,
        file_stem="avatar",
    )
    return media["url"], media["id"]


def normalize_event_media(conn: sqlite3.Connection, user_id: str, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    evidence = payload.get("evidence")
    if not isinstance(evidence, list):
        return payload

    next_payload = dict(payload)
    next_evidence: list[Any] = []
    for index, image in enumerate(evidence):
        if not isinstance(image, dict):
            next_evidence.append(image)
            continue
        next_image = dict(image)
        data_url = next_image.get("dataUrl")
        image_id = str(next_image.get("id") or f"{event_id}-{index}")
        if is_data_url(data_url):
            media = save_media_asset(
                conn,
                asset_id=f"evidence:{user_id}:{event_id}:{image_id}",
                owner_user_id=user_id,
                kind="evidence",
                data_url=str(data_url),
                record_id=event_id,
                file_stem=f"{image_id}-{next_image.get('name') or 'image'}",
            )
            next_image["dataUrl"] = media["url"]
            next_image["mediaUrl"] = media["url"]
            next_image["mimeType"] = media["mimeType"]
            next_image["size"] = media["size"]
        elif isinstance(next_image.get("mediaUrl"), str):
            next_image["dataUrl"] = next_image.get("dataUrl") or next_image["mediaUrl"]
        next_evidence.append(next_image)
    next_payload["evidence"] = next_evidence
    return next_payload


def normalize_record_media(conn: sqlite3.Connection, user_id: str, kind: str, row_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if kind == "event":
        return normalize_event_media(conn, user_id, row_id, payload)
    if kind == "user":
        user_payload = dict(payload)
        avatar, media_id = normalize_user_media(conn, str(user_payload.get("id") or user_id), user_payload.get("avatar"))
        user_payload["avatar"] = avatar
        if media_id:
            user_payload["avatarMediaId"] = media_id
        return user_payload
    return payload


def migrate_existing_media(conn: sqlite3.Connection) -> None:
    for row in conn.execute("select id, avatar from users where avatar like 'data:%'").fetchall():
        avatar, media_id = normalize_user_media(conn, row["id"], row["avatar"])
        conn.execute(
            "update users set avatar = ?, avatar_media_id = coalesce(?, avatar_media_id), updated_at = ? where id = ?",
            (avatar, media_id, utc_now(), row["id"]),
        )

    rows = conn.execute("select id, user_id, kind, payload from records where kind in ('event', 'user')").fetchall()
    for row in rows:
        try:
            payload = json.loads(row["payload"])
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        next_payload = normalize_record_media(conn, row["user_id"], row["kind"], row["id"], payload)
        if next_payload != payload:
            conn.execute(
                "update records set payload = ?, updated_at = ? where id = ? and user_id = ? and kind = ?",
                (json.dumps(next_payload, ensure_ascii=False), utc_now(), row["id"], row["user_id"], row["kind"]),
            )


def hydrate_payload_for_response(payload: dict[str, Any], request: Request | None = None) -> dict[str, Any]:
    evidence = payload.get("evidence")
    if not isinstance(evidence, list):
        return payload

    next_payload = dict(payload)
    next_evidence: list[Any] = []
    for image in evidence:
        if not isinstance(image, dict):
            next_evidence.append(image)
            continue
        next_image = dict(image)
        media_url = next_image.get("mediaUrl") or next_image.get("dataUrl")
        if isinstance(media_url, str):
            hydrated = absolute_media_url(request, media_url)
            next_image["dataUrl"] = hydrated or ""
            if next_image.get("mediaUrl"):
                next_image["mediaUrl"] = hydrated
        next_evidence.append(next_image)
    next_payload["evidence"] = next_evidence
    return next_payload


def upsert_record(conn: sqlite3.Connection, user_id: str, kind: str, row_id: str, payload: dict[str, Any]) -> None:
    if payload.get("deleted"):
        conn.execute("delete from records where id = ? and user_id = ? and kind = ?", (row_id, user_id, kind))
        return
    payload = normalize_record_media(conn, user_id, kind, row_id, payload)
    if kind == "friend-rating" and not payload.get("eventIds"):
        raise HTTPException(status_code=400, detail="cannot rate empty schedule")
    if kind == "activity" and not payload.get("endedAt"):
        rows = conn.execute(
            "select id, payload from records where user_id = ? and kind = 'activity' and id != ?",
            (user_id, row_id),
        ).fetchall()
        for row in rows:
            existing = json.loads(row["payload"])
            if existing.get("deleted") or existing.get("endedAt"):
                continue
            ended_at = existing.get("updatedAt") or existing.get("startedAt")
            if not ended_at:
                continue
            existing["endedAt"] = ended_at
            existing["updatedAt"] = ended_at
            conn.execute(
                """
                update records
                set payload = ?, updated_at = ?
                where id = ? and user_id = ? and kind = 'activity'
                """,
                (json.dumps(existing, ensure_ascii=False), utc_now(), row["id"], user_id),
            )
    if kind == "event" and not (payload.get("isTemplate") or (payload.get("repeatDaily") and not payload.get("templateId"))):
        title = (payload.get("title") or "").strip().lower()
        date = payload.get("date")
        if title and date:
            rows = conn.execute(
                "select id, payload from records where user_id = ? and kind = 'event' and id != ?",
                (user_id, row_id),
            ).fetchall()
            for row in rows:
                existing = json.loads(row["payload"])
                if existing.get("deleted") or existing.get("isTemplate") or (existing.get("repeatDaily") and not existing.get("templateId")):
                    continue
                if (existing.get("title") or "").strip().lower() == title and existing.get("date") == date:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "duplicate_event_title",
                            "title": payload.get("title") or "",
                            "date": date,
                            "conflictId": row["id"],
                        },
                    )
    conn.execute(
        """
        insert into records (id, user_id, kind, payload, updated_at)
        values (?, ?, ?, ?, ?)
        on conflict(id) do update set
            user_id=excluded.user_id,
            kind=excluded.kind,
            payload=excluded.payload,
            updated_at=excluded.updated_at
        """,
        (
            row_id,
            user_id,
            kind,
            json.dumps(payload, ensure_ascii=False),
            utc_now(),
        ),
    )


def upsert_user(conn: sqlite3.Connection, user: User) -> None:
    avatar, avatar_media_id = normalize_user_media(conn, user.id, user.avatar)
    conn.execute(
        """
        insert into users (id, name, handle, avatar, avatar_media_id, machine_key, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
            name=excluded.name,
            handle=excluded.handle,
            avatar=excluded.avatar,
            avatar_media_id=coalesce(excluded.avatar_media_id, users.avatar_media_id),
            machine_key=coalesce(users.machine_key, excluded.machine_key),
            updated_at=excluded.updated_at
        """,
        (user.id, user.name, user.handle, avatar, avatar_media_id, user.machineKey, utc_now()),
    )


def user_payload(row: sqlite3.Row, request: Request | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "handle": row["handle"],
        "avatar": absolute_media_url(request, row["avatar"]),
        "machineKey": row["machine_key"],
    }


def allocate_user(machine_key: str, name: str | None = None, avatar: str | None = None) -> User:
    digest = hashlib.sha256(machine_key.encode("utf-8")).hexdigest()
    return User(
        id=f"dn-{digest[:16]}",
        name=name or f"DayNeko {digest[:4].upper()}",
        handle=f"@dn-{digest[:10]}",
        avatar=avatar,
        machineKey=machine_key,
    )


def public_user(row: sqlite3.Row | None, request: Request | None = None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "handle": row["handle"],
        "avatar": absolute_media_url(request, row["avatar"]),
        "machineKey": row["machine_key"],
        "updatedAt": row["updated_at"],
    }


def latest_activity(conn: sqlite3.Connection, user_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        """
        select payload from records
        where user_id = ? and kind = 'activity'
        order by updated_at desc
        limit 1
        """,
        (user_id,),
    ).fetchone()
    return json.loads(row["payload"]) if row else None


def latest_presence(conn: sqlite3.Connection, user_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        """
        select payload from records
        where user_id = ? and kind = 'presence'
        order by updated_at desc
        limit 1
        """,
        (user_id,),
    ).fetchone()
    return json.loads(row["payload"]) if row else None


def request_payload(conn: sqlite3.Connection, row: sqlite3.Row, request: Request | None = None) -> dict[str, Any]:
    from_user = public_user(conn.execute("select * from users where id = ?", (row["from_user_id"],)).fetchone(), request)
    to_user = public_user(conn.execute("select * from users where id = ?", (row["to_user_id"],)).fetchone(), request)
    return {
        "id": row["id"],
        "fromUserId": row["from_user_id"],
        "toUserId": row["to_user_id"],
        "fromName": (from_user or {}).get("name", row["from_user_id"]),
        "fromHandle": (from_user or {}).get("handle", ""),
        "toName": (to_user or {}).get("name", row["to_user_id"]),
        "toHandle": (to_user or {}).get("handle", ""),
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": str(DB_PATH)}


@app.get("/media/{asset_path:path}")
def media_file(asset_path: str) -> FileResponse:
    target = (MEDIA_ROOT / asset_path).resolve()
    if not str(target).startswith(str(MEDIA_ROOT.resolve())) or not target.is_file():
        raise HTTPException(status_code=404, detail="media not found")
    return FileResponse(target)


@app.post("/users/register")
def register_user(user: User) -> dict[str, str]:
    init_db()
    with connect() as conn:
        upsert_user(conn, user)
        upsert_record(conn, user.id, "user", user.id, user.model_dump())
    return {"status": "registered"}


@app.post("/auth/device")
def auth_device(payload: DeviceAuthPayload, request: Request) -> dict[str, Any]:
    init_db()
    machine_key = payload.machineKey.strip()
    if len(machine_key) < 8:
        raise HTTPException(status_code=400, detail="machine key is too short")
    with connect() as conn:
        row = conn.execute("select * from users where machine_key = ?", (machine_key,)).fetchone()
        created = False
        if not row:
            user = allocate_user(machine_key, payload.name, payload.avatar)
            upsert_user(conn, user)
            upsert_record(conn, user.id, "user", user.id, user.model_dump())
            row = conn.execute("select * from users where id = ?", (user.id,)).fetchone()
            created = True
        assert row is not None
        return {"status": "created" if created else "logged-in", "user": user_payload(row, request)}


@app.get("/users/search")
def search_users(request: Request, handle: str, requester_id: str | None = None) -> dict[str, Any]:
    init_db()
    normalized = handle.strip()
    if normalized and not normalized.startswith("@"):
        normalized = f"@{normalized}"
    with connect() as conn:
        row = conn.execute("select * from users where lower(handle) = lower(?)", (normalized,)).fetchone()
        user = public_user(row, request)
        if not user or user["id"] == requester_id:
            return {"user": None}
        return {"user": user}


@app.get("/users/{user_id}/friends")
def user_friends(user_id: str, request: Request) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            select * from friendships
            where user_a = ? or user_b = ?
            order by created_at desc
            """,
            (user_id, user_id),
        ).fetchall()
        friends = []
        for row in rows:
            friend_id = row["user_b"] if row["user_a"] == user_id else row["user_a"]
            user_row = conn.execute("select * from users where id = ?", (friend_id,)).fetchone()
            user = public_user(user_row, request)
            if not user:
                continue
            presence = latest_presence(conn, friend_id)
            activity = latest_activity(conn, friend_id)
            friends.append(
                {
                    "id": user["id"],
                    "name": user["name"],
                    "handle": user["handle"],
                    "avatar": user.get("avatar"),
                    "status": (presence or activity or {}).get("label", "暂无状态"),
                    "mood": (presence or activity or {}).get("mood", "未知"),
                    "detail": (presence or {}).get("detail", ""),
                    "foregroundTitle": (presence or {}).get("foregroundTitle", ""),
                    "foregroundProcess": (presence or {}).get("foregroundProcess", ""),
                    "lastSeen": (presence or activity or {}).get("updatedAt", user["updatedAt"]),
                    "updatedAt": (presence or activity or {}).get("updatedAt", user["updatedAt"]),
                }
            )

        request_rows = conn.execute(
            """
            select * from friend_requests
            where from_user_id = ? or to_user_id = ?
            order by updated_at desc
            """,
            (user_id, user_id),
        ).fetchall()
        requests = [request_payload(conn, row, request) for row in request_rows]
    return {"friends": friends, "requests": requests}


@app.post("/friend-requests")
def create_friend_request(payload: FriendRequestCreate, request: Request) -> dict[str, Any]:
    init_db()
    normalized = payload.toHandle.strip()
    if normalized and not normalized.startswith("@"):
        normalized = f"@{normalized}"
    with connect() as conn:
        from_user = conn.execute("select * from users where id = ?", (payload.fromUserId,)).fetchone()
        to_user = conn.execute("select * from users where lower(handle) = lower(?)", (normalized,)).fetchone()
        if not from_user:
            raise HTTPException(status_code=404, detail="from user not found")
        if not to_user:
            raise HTTPException(status_code=404, detail="target user not found")
        if from_user["id"] == to_user["id"]:
            raise HTTPException(status_code=400, detail="cannot add yourself")
        a, b = sorted([from_user["id"], to_user["id"]])
        existing_friend = conn.execute("select id from friendships where user_a = ? and user_b = ?", (a, b)).fetchone()
        if existing_friend:
            raise HTTPException(status_code=409, detail="already friends")
        existing = conn.execute(
            """
            select * from friend_requests
            where ((from_user_id = ? and to_user_id = ?) or (from_user_id = ? and to_user_id = ?))
            and status = 'pending'
            """,
            (from_user["id"], to_user["id"], to_user["id"], from_user["id"]),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="pending request exists")
        now = datetime.now(timezone.utc).isoformat()
        request_id = f"{from_user['id']}:{to_user['id']}"
        conn.execute(
            """
            insert into friend_requests (id, from_user_id, to_user_id, status, created_at, updated_at)
            values (?, ?, ?, 'pending', ?, ?)
            on conflict(from_user_id, to_user_id) do update set
                status='pending',
                updated_at=excluded.updated_at
            """,
            (request_id, from_user["id"], to_user["id"], now, now),
        )
        row = conn.execute("select * from friend_requests where id = ?", (request_id,)).fetchone()
        return {"request": request_payload(conn, row, request)}


@app.post("/friend-requests/{request_id}/accept")
def accept_friend_request(request_id: str, payload: FriendRequestAction, request: Request) -> dict[str, Any]:
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    with connect() as conn:
        row = conn.execute("select * from friend_requests where id = ?", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="request not found")
        if row["to_user_id"] != payload.userId:
            raise HTTPException(status_code=403, detail="only receiver can accept")
        if row["status"] != "pending":
            raise HTTPException(status_code=409, detail="request already handled")
        conn.execute("update friend_requests set status = 'accepted', updated_at = ? where id = ?", (now, request_id))
        a, b = sorted([row["from_user_id"], row["to_user_id"]])
        conn.execute(
            """
            insert into friendships (id, user_a, user_b, created_at)
            values (?, ?, ?, ?)
            on conflict(user_a, user_b) do nothing
            """,
            (f"{a}:{b}", a, b, now),
        )
        updated = conn.execute("select * from friend_requests where id = ?", (request_id,)).fetchone()
        return {"request": request_payload(conn, updated, request)}


@app.post("/friend-requests/{request_id}/reject")
def reject_friend_request(request_id: str, payload: FriendRequestAction, request: Request) -> dict[str, Any]:
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    with connect() as conn:
        row = conn.execute("select * from friend_requests where id = ?", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="request not found")
        if row["to_user_id"] != payload.userId:
            raise HTTPException(status_code=403, detail="only receiver can reject")
        if row["status"] != "pending":
            raise HTTPException(status_code=409, detail="request already handled")
        conn.execute("update friend_requests set status = 'rejected', updated_at = ? where id = ?", (now, request_id))
        updated = conn.execute("select * from friend_requests where id = ?", (request_id,)).fetchone()
        return {"request": request_payload(conn, updated, request)}


@app.post("/sync")
def sync(payload: SyncPayload) -> dict[str, int | str]:
    init_db()
    with connect() as conn:
        upsert_user(conn, payload.user)

        for boot in payload.boots:
            upsert_record(conn, payload.user.id, "boot", boot.id, boot.model_dump())
        for activity in payload.activities:
            upsert_record(conn, payload.user.id, "activity", activity.id, activity.model_dump())
        for schedule in payload.schedules:
            upsert_record(conn, payload.user.id, "schedule", schedule.id, schedule.model_dump())
        for event in payload.events:
            upsert_record(conn, payload.user.id, "event", event.id, event.model_dump())
        for template in payload.dailyTemplates:
            upsert_record(conn, payload.user.id, "daily-template", template.id, template.model_dump())
        for friend in payload.friends:
            upsert_record(conn, payload.user.id, "friend", friend.id, friend.model_dump())
        for review in payload.reviews:
            upsert_record(conn, payload.user.id, "review", review.id, review.model_dump())
        for rating in payload.dailyRatings:
            upsert_record(conn, payload.user.id, "daily-rating", rating.id, rating.model_dump())
        for rating in payload.friendRatings:
            upsert_record(conn, payload.user.id, "friend-rating", rating.id, rating.model_dump())

    total = (
        len(payload.boots)
        + len(payload.activities)
        + len(payload.schedules)
        + len(payload.events)
        + len(payload.dailyTemplates)
        + len(payload.friends)
        + len(payload.reviews)
        + len(payload.dailyRatings)
        + len(payload.friendRatings)
    )
    return {"status": "synced", "records": total}


@app.post("/sync/changes")
def sync_changes(payload: ChangesPayload) -> dict[str, int | str]:
    init_db()
    with connect() as conn:
        upsert_user(conn, payload.user)
        for change in payload.changes:
            if change.kind == "user":
                upsert_user(conn, User(**change.payload))
                upsert_record(conn, payload.user.id, "user", payload.user.id, change.payload)
                continue
            row_id = str(change.payload.get("id") or change.id)
            upsert_record(conn, payload.user.id, change.kind, row_id, change.payload)

    return {"status": "synced", "records": len(payload.changes)}


@app.get("/users/{user_id}/snapshot")
def snapshot(user_id: str, request: Request) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        user_row = conn.execute("select * from users where id = ?", (user_id,)).fetchone()
        rows = conn.execute("select kind, payload from records where user_id = ? order by updated_at desc", (user_id,)).fetchall()

    grouped: dict[str, list[dict[str, Any]]] = {
        "boots": [],
        "activities": [],
        "schedules": [],
        "events": [],
        "dailyTemplates": [],
        "friends": [],
        "reviews": [],
        "dailyRatings": [],
        "friendRatings": [],
    }
    key_map = {
        "boot": "boots",
        "activity": "activities",
        "schedule": "schedules",
        "event": "events",
        "daily-template": "dailyTemplates",
        "friend": "friends",
        "review": "reviews",
        "daily-rating": "dailyRatings",
        "friend-rating": "friendRatings",
    }
    for row in rows:
        key = key_map.get(row["kind"])
        if key:
            payload = hydrate_payload_for_response(json.loads(row["payload"]), request)
            if not payload.get("deleted"):
                if row["kind"] == "friend-rating" and not payload.get("eventIds"):
                    continue
                grouped[key].append(payload)

    return {
        "user": public_user(user_row, request),
        **grouped,
    }


@app.get("/users/{user_id}/schedule")
def user_schedule(user_id: str, request: Request, cursor: str | None = None, limit: int = 7) -> dict[str, Any]:
    init_db()
    limit = max(1, min(limit, 30))
    with connect() as conn:
        rows = conn.execute(
            "select kind, payload from records where user_id = ? and kind in ('event', 'friend-rating', 'activity', 'boot')",
            (user_id,),
        ).fetchall()

    by_date: dict[str, dict[str, Any]] = {}
    for row in rows:
        payload = hydrate_payload_for_response(json.loads(row["payload"]), request)
        if payload.get("deleted"):
            continue
        if row["kind"] == "event" and (payload.get("isTemplate") or (payload.get("repeatDaily") and not payload.get("templateId"))):
            continue
        if row["kind"] == "friend-rating" and not payload.get("eventIds"):
            continue
        if row["kind"] in ("activity", "boot"):
            date = payload.get("date") or (payload.get("startedAt") or "")[:10]
        else:
            date = payload.get("date")
        if not date or (cursor and date >= cursor):
            continue
        bucket = by_date.setdefault(date, {"date": date, "events": [], "ratings": [], "activities": [], "boots": [], "totalMinutes": 0})
        if row["kind"] == "event":
            bucket["events"].append(payload)
        elif row["kind"] == "friend-rating":
            bucket["ratings"].append(payload)
        elif row["kind"] == "activity":
            bucket["activities"].append(payload)
        elif row["kind"] == "boot":
            bucket["boots"].append(payload)

    dates = sorted(by_date.keys(), reverse=True)
    page_dates = dates[:limit]
    next_cursor = dates[limit] if len(dates) > limit else None
    return {
        "items": [by_date[date] for date in page_dates],
        "nextCursor": next_cursor,
    }


@app.get("/leaderboard")
def leaderboard(scope: Literal["7d", "all"] = "7d") -> dict[str, Any]:
    init_db()
    since = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    rank_score = {"SSS": 100, "S": 88, "A": 76, "B": 62, "C": 45}
    def score_to_rank(score: float) -> str:
        if score >= 94:
            return "SSS"
        if score >= 84:
            return "S"
        if score >= 72:
            return "A"
        if score >= 58:
            return "B"
        return "C"

    scores: dict[str, dict[str, Any]] = {}
    completed: dict[str, int] = {}
    with connect() as conn:
        users = {row["id"]: dict(row) for row in conn.execute("select * from users").fetchall()}
        rows = conn.execute("select kind, payload from records where kind in ('friend-rating', 'event')").fetchall()

    for row in rows:
        payload = json.loads(row["payload"])
        if payload.get("deleted"):
            continue
        if row["kind"] == "event":
            if payload.get("isTemplate") or (payload.get("repeatDaily") and not payload.get("templateId")):
                continue
            user_id = payload.get("userId")
            done_dates = payload.get("completedDates") or []
            if user_id:
                completed[user_id] = completed.get(user_id, 0) + len([date for date in done_dates if scope == "all" or date >= since])
            continue
        if not payload.get("eventIds"):
            continue
        if scope == "7d" and payload.get("date", "") < since:
            continue
        user_id = payload.get("targetUserId")
        rank = payload.get("rank")
        if not user_id or rank not in rank_score:
            continue
        bucket = scores.setdefault(user_id, {"score": 0, "ratedDays": 0})
        bucket["score"] += rank_score[rank]
        bucket["ratedDays"] += 1

    entries = []
    for user_id in set(scores) | set(completed):
        bucket = scores.get(user_id, {"score": 0, "ratedDays": 0})
        user = users.get(user_id, {})
        average = bucket["score"] / bucket["ratedDays"] if bucket["ratedDays"] else 45
        entries.append(
            {
                "userId": user_id,
                "name": user.get("name", user_id),
                "handle": user.get("handle", ""),
                "score": bucket["score"],
                "rank": score_to_rank(average),
                "completed": completed.get(user_id, 0),
                "ratedDays": bucket["ratedDays"],
            }
        )

    return {"scope": scope, "entries": sorted(entries, key=lambda item: item["score"], reverse=True)}
