from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "dayneko.db"
MEDIA_ROOT = ROOT / "media"
STATIC_ROOT = Path(__file__).resolve().parent / "admin_static"

router = APIRouter()


class AdminSetupPayload(BaseModel):
    password: str = Field(min_length=8)


class AdminLoginPayload(BaseModel):
    password: str


class UserUpdatePayload(BaseModel):
    name: str | None = None
    handle: str | None = None


class RecordUpdatePayload(BaseModel):
    payload: dict[str, Any]


class FriendRequestUpdatePayload(BaseModel):
    status: str


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def password_hash(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def ensure_admin_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            create table if not exists admin_accounts (
                id text primary key,
                password_hash text not null,
                salt text not null,
                created_at text not null,
                updated_at text not null
            );

            create table if not exists admin_sessions (
                token_hash text primary key,
                created_at text not null,
                expires_at text not null
            );
            """
        )
        conn.execute("create index if not exists idx_admin_sessions_expires on admin_sessions(expires_at)")
        tables = {row["name"] for row in conn.execute("select name from sqlite_master where type = 'table'").fetchall()}
        if "friend_requests" in tables:
            conn.execute("create index if not exists idx_admin_requests_from on friend_requests(from_user_id)")
            conn.execute("create index if not exists idx_admin_requests_to on friend_requests(to_user_id)")
        if "friendships" in tables:
            conn.execute("create index if not exists idx_admin_friendships_a on friendships(user_a)")
            conn.execute("create index if not exists idx_admin_friendships_b on friendships(user_b)")


def admin_configured(conn: sqlite3.Connection) -> bool:
    row = conn.execute("select id from admin_accounts limit 1").fetchone()
    return row is not None


def require_admin(authorization: str | None = Header(default=None)) -> None:
    ensure_admin_db()
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="admin token required")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="admin token required")
    now = utc_now()
    with connect() as conn:
        row = conn.execute(
            "select expires_at from admin_sessions where token_hash = ?",
            (token_hash(token),),
        ).fetchone()
        if not row or row["expires_at"] <= now:
            raise HTTPException(status_code=401, detail="admin session expired")


def parse_payload(value: str) -> dict[str, Any]:
    try:
        data = json.loads(value)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def payload_references_user(payload: dict[str, Any], user_id: str) -> bool:
    direct_fields = ("id", "userId", "targetUserId", "raterFriendId", "fromUserId", "toUserId")
    if any(payload.get(field) == user_id for field in direct_fields):
        return True
    for value in payload.values():
        if isinstance(value, dict) and payload_references_user(value, user_id):
            return True
        if isinstance(value, list) and any(isinstance(item, dict) and payload_references_user(item, user_id) for item in value):
            return True
    return False


def page_bounds(limit: int, offset: int) -> tuple[int, int]:
    return max(1, min(limit, 100)), max(0, offset)


def delete_media_file(relative_path: str) -> None:
    target = (MEDIA_ROOT / relative_path).resolve()
    media_root = MEDIA_ROOT.resolve()
    if not str(target).startswith(str(media_root)):
        return
    try:
        target.unlink()
    except FileNotFoundError:
        return


def delete_media_rows(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> None:
    for row in rows:
        delete_media_file(row["file_path"])
        conn.execute("delete from media_assets where id = ?", (row["id"],))


def delete_media_for_user(conn: sqlite3.Connection, user_id: str) -> None:
    rows = conn.execute("select id, file_path from media_assets where owner_user_id = ?", (user_id,)).fetchall()
    delete_media_rows(conn, rows)


def delete_media_for_record(conn: sqlite3.Connection, record_id: str) -> None:
    rows = conn.execute("select id, file_path from media_assets where record_id = ?", (record_id,)).fetchall()
    delete_media_rows(conn, rows)


@router.get("/admin")
def admin_page() -> FileResponse:
    return FileResponse(STATIC_ROOT / "index.html")


@router.get("/admin/assets/{asset_path:path}")
def admin_asset(asset_path: str) -> FileResponse:
    target = (STATIC_ROOT / asset_path).resolve()
    if not str(target).startswith(str(STATIC_ROOT.resolve())) or not target.is_file():
        raise HTTPException(status_code=404, detail="asset not found")
    return FileResponse(target)


@router.get("/admin/api/status")
def admin_status() -> dict[str, bool]:
    ensure_admin_db()
    with connect() as conn:
        return {"configured": admin_configured(conn)}


@router.post("/admin/api/setup")
def admin_setup(payload: AdminSetupPayload) -> dict[str, str]:
    ensure_admin_db()
    with connect() as conn:
        if admin_configured(conn):
            raise HTTPException(status_code=409, detail="admin already configured")
        salt = secrets.token_hex(16)
        now = utc_now()
        conn.execute(
            "insert into admin_accounts (id, password_hash, salt, created_at, updated_at) values ('default', ?, ?, ?, ?)",
            (password_hash(payload.password, salt), salt, now, now),
        )
    return {"status": "configured"}


@router.post("/admin/api/login")
def admin_login(payload: AdminLoginPayload) -> dict[str, str]:
    ensure_admin_db()
    with connect() as conn:
        row = conn.execute("select * from admin_accounts limit 1").fetchone()
        if not row:
            raise HTTPException(status_code=409, detail="admin is not configured")
        expected = row["password_hash"]
        actual = password_hash(payload.password, row["salt"])
        if not hmac.compare_digest(expected, actual):
            raise HTTPException(status_code=401, detail="invalid password")
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        conn.execute(
            "insert into admin_sessions (token_hash, created_at, expires_at) values (?, ?, ?)",
            (token_hash(token), now.isoformat(), (now + timedelta(hours=12)).isoformat()),
        )
    return {"token": token}


@router.get("/admin/api/summary")
def admin_summary(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_admin(authorization)
    with connect() as conn:
        users = conn.execute("select count(*) as value from users").fetchone()["value"]
        records = conn.execute("select count(*) as value from records").fetchone()["value"]
        media = conn.execute("select count(*) as value from media_assets").fetchone()["value"]
        media_size = conn.execute("select coalesce(sum(size), 0) as value from media_assets").fetchone()["value"]
        friendships = conn.execute("select count(*) as value from friendships").fetchone()["value"]
        requests = conn.execute("select count(*) as value from friend_requests").fetchone()["value"]
        by_kind = [dict(row) for row in conn.execute("select kind, count(*) as count from records group by kind order by count desc").fetchall()]
    return {
        "users": users,
        "records": records,
        "mediaAssets": media,
        "mediaBytes": media_size,
        "friendships": friendships,
        "friendRequests": requests,
        "recordsByKind": by_kind,
        "database": str(DB_PATH),
    }


@router.get("/admin/api/users")
def admin_users(q: str = "", limit: int = 50, offset: int = 0, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_admin(authorization)
    limit, offset = page_bounds(limit, offset)
    search = f"%{q.strip()}%"
    with connect() as conn:
        total = conn.execute(
            """
            select count(*) as value
            from users u
            where ? = '%%' or u.id like ? or u.name like ? or u.handle like ?
            """,
            (search, search, search, search),
        ).fetchone()["value"]
        rows = conn.execute(
            """
            select
                u.*,
                (select count(*) from records r where r.user_id = u.id) as record_count
            from users u
            where ? = '%%' or u.id like ? or u.name like ? or u.handle like ?
            order by u.updated_at desc
            limit ? offset ?
            """,
            (search, search, search, search, limit, offset),
        ).fetchall()
    return {"items": [dict(row) for row in rows], "limit": limit, "offset": offset, "total": total}


@router.patch("/admin/api/users/{user_id}")
def admin_update_user(user_id: str, payload: UserUpdatePayload, authorization: str | None = Header(default=None)) -> dict[str, str]:
    require_admin(authorization)
    fields: list[str] = []
    values: list[str] = []
    if payload.name is not None:
        fields.append("name = ?")
        values.append(payload.name.strip())
    if payload.handle is not None:
        handle = payload.handle.strip()
        fields.append("handle = ?")
        values.append(handle if handle.startswith("@") else f"@{handle}")
    if not fields:
        return {"status": "unchanged"}
    fields.append("updated_at = ?")
    values.append(utc_now())
    values.append(user_id)
    with connect() as conn:
        conn.execute(f"update users set {', '.join(fields)} where id = ?", values)
    return {"status": "updated"}


@router.delete("/admin/api/users/{user_id}")
def admin_delete_user(user_id: str, authorization: str | None = Header(default=None)) -> dict[str, str]:
    require_admin(authorization)
    with connect() as conn:
        record_ids = [
            row["id"]
            for row in conn.execute(
                """
                select id from records
                where user_id = ?
                   or json_extract(payload, '$.id') = ?
                   or json_extract(payload, '$.userId') = ?
                   or json_extract(payload, '$.targetUserId') = ?
                   or json_extract(payload, '$.raterFriendId') = ?
                   or json_extract(payload, '$.fromUserId') = ?
                   or json_extract(payload, '$.toUserId') = ?
                """,
                (user_id, user_id, user_id, user_id, user_id, user_id, user_id),
            ).fetchall()
        ]
        if record_ids:
            for record_id in record_ids:
                delete_media_for_record(conn, record_id)
            conn.executemany("delete from records where id = ?", [(record_id,) for record_id in record_ids])
        delete_media_for_user(conn, user_id)
        conn.execute("delete from friend_requests where from_user_id = ? or to_user_id = ?", (user_id, user_id))
        conn.execute("delete from friendships where user_a = ? or user_b = ?", (user_id, user_id))
        conn.execute("delete from users where id = ?", (user_id,))
    return {"status": "deleted"}


@router.get("/admin/api/records")
def admin_records(
    kind: str = "",
    user_id: str = "",
    q: str = "",
    from_time: str = "",
    to_time: str = "",
    limit: int = 50,
    offset: int = 0,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_admin(authorization)
    limit, offset = page_bounds(limit, offset)
    clauses: list[str] = []
    values: list[str] = []
    if kind:
        clauses.append("kind = ?")
        values.append(kind)
    if user_id:
        clauses.append("user_id = ?")
        values.append(user_id)
    if q:
        clauses.append("payload like ?")
        values.append(f"%{q}%")
    if from_time:
        clauses.append("updated_at >= ?")
        values.append(from_time)
    if to_time:
        clauses.append("updated_at <= ?")
        values.append(to_time)
    where = f"where {' and '.join(clauses)}" if clauses else ""
    with connect() as conn:
        total = conn.execute(f"select count(*) as value from records {where}", values).fetchone()["value"]
        rows = conn.execute(
            f"select id, user_id, kind, payload, updated_at from records {where} order by updated_at desc limit ? offset ?",
            [*values, limit, offset],
        ).fetchall()
    return {
        "limit": limit,
        "offset": offset,
        "total": total,
        "items": [
            {
                "id": row["id"],
                "userId": row["user_id"],
                "kind": row["kind"],
                "payload": parse_payload(row["payload"]),
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]
    }


@router.delete("/admin/api/records/{record_id}")
def admin_delete_record(record_id: str, authorization: str | None = Header(default=None)) -> dict[str, str]:
    require_admin(authorization)
    with connect() as conn:
        delete_media_for_record(conn, record_id)
        conn.execute("delete from records where id = ?", (record_id,))
    return {"status": "deleted"}


@router.patch("/admin/api/records/{record_id}")
def admin_update_record(record_id: str, payload: RecordUpdatePayload, authorization: str | None = Header(default=None)) -> dict[str, str]:
    require_admin(authorization)
    now = utc_now()
    with connect() as conn:
        row = conn.execute("select id from records where id = ?", (record_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="record not found")
        conn.execute(
            "update records set payload = ?, updated_at = ? where id = ?",
            (json.dumps(payload.payload, ensure_ascii=False), now, record_id),
        )
    return {"status": "updated"}


@router.get("/admin/api/friend-requests")
def admin_friend_requests(limit: int = 50, offset: int = 0, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_admin(authorization)
    limit, offset = page_bounds(limit, offset)
    with connect() as conn:
        total = conn.execute("select count(*) as value from friend_requests").fetchone()["value"]
        rows = conn.execute("select * from friend_requests order by updated_at desc limit ? offset ?", (limit, offset)).fetchall()
    return {"items": [dict(row) for row in rows], "limit": limit, "offset": offset, "total": total}


@router.patch("/admin/api/friend-requests/{request_id}")
def admin_update_friend_request(request_id: str, payload: FriendRequestUpdatePayload, authorization: str | None = Header(default=None)) -> dict[str, str]:
    require_admin(authorization)
    if payload.status not in {"pending", "accepted", "rejected"}:
        raise HTTPException(status_code=400, detail="invalid friend request status")
    with connect() as conn:
        conn.execute("update friend_requests set status = ?, updated_at = ? where id = ?", (payload.status, utc_now(), request_id))
    return {"status": "updated"}


@router.delete("/admin/api/friend-requests/{request_id}")
def admin_delete_friend_request(request_id: str, authorization: str | None = Header(default=None)) -> dict[str, str]:
    require_admin(authorization)
    with connect() as conn:
        conn.execute("delete from friend_requests where id = ?", (request_id,))
    return {"status": "deleted"}
