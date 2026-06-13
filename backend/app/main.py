from __future__ import annotations

import json
import sqlite3
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .admin import router as admin_router

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "dayneko.db"


class User(BaseModel):
    id: str
    name: str
    handle: str
    avatar: str | None = None
    machineKey: str | None = None


class BootEvent(BaseModel):
    id: str
    userId: str
    startedAt: str
    endedAt: str | None = None
    device: str
    updatedAt: str | None = None


class ActivityEntry(BaseModel):
    id: str
    userId: str
    label: str
    mood: str
    startedAt: str
    endedAt: str | None = None
    source: Literal["manual", "auto"] = "manual"


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
    dataUrl: str
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
    kind: Literal["user", "boot", "activity", "event", "friend", "daily-rating", "friend-rating", "presence"]
    payload: dict[str, Any]
    changedAt: str


class SyncPayload(BaseModel):
    user: User
    boots: list[BootEvent] = Field(default_factory=list)
    activities: list[ActivityEntry] = Field(default_factory=list)
    schedules: list[ScheduleItem] = Field(default_factory=list)
    events: list[CustomEvent] = Field(default_factory=list)
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


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            create table if not exists users (
                id text primary key,
                name text not null,
                handle text not null unique,
                avatar text,
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
        if "machine_key" not in columns:
            conn.execute("alter table users add column machine_key text")
        conn.execute("create unique index if not exists idx_users_machine_key on users(machine_key)")


def upsert_record(conn: sqlite3.Connection, user_id: str, kind: str, row_id: str, payload: dict[str, Any]) -> None:
    if payload.get("deleted"):
        conn.execute("delete from records where id = ? and user_id = ? and kind = ?", (row_id, user_id, kind))
        return
    if kind == "friend-rating" and not payload.get("eventIds"):
        raise HTTPException(status_code=400, detail="cannot rate empty schedule")
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
                    raise HTTPException(status_code=409, detail="duplicate event title for this date")
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
            datetime.now(timezone.utc).isoformat(),
        ),
    )


def upsert_user(conn: sqlite3.Connection, user: User) -> None:
    conn.execute(
        """
        insert into users (id, name, handle, avatar, machine_key, updated_at)
        values (?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
            name=excluded.name,
            handle=excluded.handle,
            avatar=excluded.avatar,
            machine_key=coalesce(users.machine_key, excluded.machine_key),
            updated_at=excluded.updated_at
        """,
        (user.id, user.name, user.handle, user.avatar, user.machineKey, datetime.now(timezone.utc).isoformat()),
    )


def user_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "handle": row["handle"],
        "avatar": row["avatar"],
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


def public_user(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "handle": row["handle"],
        "avatar": row["avatar"],
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


def request_payload(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    from_user = public_user(conn.execute("select * from users where id = ?", (row["from_user_id"],)).fetchone())
    to_user = public_user(conn.execute("select * from users where id = ?", (row["to_user_id"],)).fetchone())
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


@app.post("/users/register")
def register_user(user: User) -> dict[str, str]:
    init_db()
    with connect() as conn:
        upsert_user(conn, user)
        upsert_record(conn, user.id, "user", user.id, user.model_dump())
    return {"status": "registered"}


@app.post("/auth/device")
def auth_device(payload: DeviceAuthPayload) -> dict[str, Any]:
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
        return {"status": "created" if created else "logged-in", "user": user_payload(row)}


@app.get("/users/search")
def search_users(handle: str, requester_id: str | None = None) -> dict[str, Any]:
    init_db()
    normalized = handle.strip()
    if normalized and not normalized.startswith("@"):
        normalized = f"@{normalized}"
    with connect() as conn:
        row = conn.execute("select * from users where lower(handle) = lower(?)", (normalized,)).fetchone()
        user = public_user(row)
        if not user or user["id"] == requester_id:
            return {"user": None}
        return {"user": user}


@app.get("/users/{user_id}/friends")
def user_friends(user_id: str) -> dict[str, Any]:
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
            user = public_user(user_row)
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
        requests = [request_payload(conn, row) for row in request_rows]
    return {"friends": friends, "requests": requests}


@app.post("/friend-requests")
def create_friend_request(payload: FriendRequestCreate) -> dict[str, Any]:
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
        return {"request": request_payload(conn, row)}


@app.post("/friend-requests/{request_id}/accept")
def accept_friend_request(request_id: str, payload: FriendRequestAction) -> dict[str, Any]:
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
        return {"request": request_payload(conn, updated)}


@app.post("/friend-requests/{request_id}/reject")
def reject_friend_request(request_id: str, payload: FriendRequestAction) -> dict[str, Any]:
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
        return {"request": request_payload(conn, updated)}


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
def snapshot(user_id: str) -> dict[str, Any]:
    init_db()
    with connect() as conn:
        user_row = conn.execute("select * from users where id = ?", (user_id,)).fetchone()
        rows = conn.execute("select kind, payload from records where user_id = ? order by updated_at desc", (user_id,)).fetchall()

    grouped: dict[str, list[dict[str, Any]]] = {
        "boots": [],
        "activities": [],
        "schedules": [],
        "events": [],
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
        "friend": "friends",
        "review": "reviews",
        "daily-rating": "dailyRatings",
        "friend-rating": "friendRatings",
    }
    for row in rows:
        key = key_map.get(row["kind"])
        if key:
            payload = json.loads(row["payload"])
            if not payload.get("deleted"):
                if row["kind"] == "friend-rating" and not payload.get("eventIds"):
                    continue
                grouped[key].append(payload)

    return {
        "user": dict(user_row) if user_row else None,
        **grouped,
    }


@app.get("/users/{user_id}/schedule")
def user_schedule(user_id: str, cursor: str | None = None, limit: int = 7) -> dict[str, Any]:
    init_db()
    limit = max(1, min(limit, 30))
    with connect() as conn:
        rows = conn.execute(
            "select kind, payload from records where user_id = ? and kind in ('event', 'friend-rating', 'activity')",
            (user_id,),
        ).fetchall()

    by_date: dict[str, dict[str, Any]] = {}
    for row in rows:
        payload = json.loads(row["payload"])
        if payload.get("deleted"):
            continue
        if row["kind"] == "event" and (payload.get("isTemplate") or (payload.get("repeatDaily") and not payload.get("templateId"))):
            continue
        if row["kind"] == "friend-rating" and not payload.get("eventIds"):
            continue
        if row["kind"] == "activity":
            date = (payload.get("startedAt") or "")[:10]
        else:
            date = payload.get("date")
        if not date or (cursor and date >= cursor):
            continue
        bucket = by_date.setdefault(date, {"date": date, "events": [], "ratings": [], "activities": [], "totalMinutes": 0})
        if row["kind"] == "event":
            bucket["events"].append(payload)
        elif row["kind"] == "friend-rating":
            bucket["ratings"].append(payload)
        elif row["kind"] == "activity":
            started = payload.get("startedAt")
            ended = payload.get("endedAt")
            if started:
                try:
                    start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                    end_dt = datetime.fromisoformat(ended.replace("Z", "+00:00")) if ended else datetime.now(timezone.utc)
                    minutes = max(1, round((end_dt - start_dt).total_seconds() / 60))
                except ValueError:
                    minutes = 1
            else:
                minutes = 1
            payload["minutes"] = minutes
            bucket["activities"].append(payload)
            bucket["totalMinutes"] += minutes

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
