use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WindowEvent};

struct CloseToTray(AtomicBool);

#[derive(Serialize)]
struct ForegroundActivity {
    title: String,
    process: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredImage {
    file_path: String,
    mime_type: String,
    size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirStatus {
    has_database: bool,
    has_evidence: bool,
    is_dayneko_data: bool,
}

const DATA_PATH_POINTER_FILE: &str = "dayneko-data-path.json";

fn resolve_data_dir(data_dir: &str) -> Result<PathBuf, String> {
    if !data_dir.trim().is_empty() {
        return Ok(PathBuf::from(data_dir));
    }
    default_data_dir()
}

fn legacy_exe_data_dir() -> Option<PathBuf> {
    let base = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .or_else(|| std::env::current_dir().ok())?;
    Some(base.join("data"))
}

fn default_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        return legacy_exe_data_dir()
            .ok_or_else(|| "cannot resolve application data directory".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        return legacy_exe_data_dir()
            .ok_or_else(|| "cannot resolve application data directory".to_string());
    }
}

fn previous_appdata_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA")
            .or_else(|| std::env::var_os("APPDATA"))
            .map(|base| PathBuf::from(base).join("DayNeko").join("data"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(|base| PathBuf::from(base).join("dayneko"))
            .or_else(|| {
                std::env::var_os("HOME").map(|home| {
                    PathBuf::from(home)
                        .join(".local")
                        .join("share")
                        .join("dayneko")
                })
            })
    }
}

fn migrate_legacy_default_data_dir(target: &PathBuf) -> Result<(), String> {
    let Some(legacy) = previous_appdata_data_dir() else {
        return Ok(());
    };
    if &legacy == target || !legacy.exists() {
        return Ok(());
    }
    let legacy_db = legacy.join("dayneko-local.db");
    let target_db = target.join("dayneko-local.db");
    if legacy_db.exists() && !target_db.exists() {
        fs::create_dir_all(target).map_err(|err| err.to_string())?;
        fs::copy(&legacy_db, &target_db).map_err(|err| err.to_string())?;
        fs::remove_file(&legacy_db).map_err(|err| err.to_string())?;
    }
    let legacy_evidence = legacy.join("evidence");
    if legacy_evidence.exists() {
        copy_dir_missing_files(&legacy_evidence, &target.join("evidence"), false)?;
        fs::remove_dir_all(legacy_evidence).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn data_path_pointer_path() -> Result<PathBuf, String> {
    Ok(default_data_dir()?.join(DATA_PATH_POINTER_FILE))
}

fn read_data_path_pointer() -> Result<Option<String>, String> {
    let path = data_path_pointer_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let value = serde_json::from_str::<Value>(&raw).map_err(|err| err.to_string())?;
    Ok(value
        .get("dataPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned))
}

fn write_data_path_pointer(state: &Value) -> Result<(), String> {
    let pointer_path = data_path_pointer_path()?;
    let default_dir = default_data_dir()?;
    let data_path = state
        .get("settings")
        .and_then(|settings| settings.get("dataPath"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    fs::create_dir_all(
        pointer_path
            .parent()
            .ok_or_else(|| "cannot resolve data path pointer directory".to_string())?,
    )
    .map_err(|err| err.to_string())?;

    let pointer = json!({
        "dataPath": if data_path.is_empty() {
            default_dir.to_string_lossy().to_string()
        } else {
            data_path.to_string()
        },
        "updatedAt": chrono_like_now()
    });
    fs::write(pointer_path, json_text(&pointer)?).map_err(|err| err.to_string())
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    seconds.to_string()
}

fn copy_dir_missing_files(from: &PathBuf, to: &PathBuf, overwrite: bool) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(|err| err.to_string())?;
    for entry in fs::read_dir(from).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            copy_dir_missing_files(&source, &target, overwrite)?;
        } else if overwrite || !target.exists() {
            fs::copy(&source, &target).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn connect_local_db(data_dir: &str) -> Result<Connection, String> {
    let dir = resolve_data_dir(data_dir)?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    if data_dir.trim().is_empty() {
        migrate_legacy_default_data_dir(&dir)?;
    }
    let mut conn = Connection::open(dir.join("dayneko-local.db")).map_err(|err| err.to_string())?;
    init_local_db(&conn)?;
    migrate_state_blob(&mut conn)?;
    migrate_daily_templates_once(&mut conn)?;
    Ok(conn)
}

fn init_local_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        create table if not exists app_state (
            key text primary key,
            value text not null,
            updated_at text not null
        );

        create table if not exists app_meta (
            key text primary key,
            value text not null,
            updated_at text not null
        );

        create table if not exists dirty_queue (
            id text primary key,
            kind text not null,
            payload text not null,
            changed_at text not null,
            updated_at text not null
        );

        create table if not exists boots (
            id text primary key,
            user_id text not null,
            payload text not null,
            updated_at text not null
        );

        create table if not exists activities (
            id text primary key,
            user_id text not null,
            payload text not null,
            updated_at text not null
        );

        create table if not exists events (
            id text primary key,
            user_id text not null,
            payload text not null,
            updated_at text not null
        );

        create table if not exists daily_templates (
            id text primary key,
            user_id text not null,
            payload text not null,
            updated_at text not null
        );

        create table if not exists friends (
            id text primary key,
            user_id text not null,
            payload text not null,
            updated_at text not null
        );

        create table if not exists friend_requests (
            id text primary key,
            user_id text not null,
            payload text not null,
            updated_at text not null
        );

        create table if not exists friend_ratings (
            id text primary key,
            user_id text not null,
            payload text not null,
            updated_at text not null
        );
        ",
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn json_text(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|err| err.to_string())
}

fn json_id(value: &Value) -> Option<&str> {
    value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
}

fn json_user_id(value: &Value, fallback: &str) -> String {
    value
        .get("userId")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn json_updated_at(value: &Value) -> &str {
    value
        .get("updatedAt")
        .or_else(|| value.get("createdAt"))
        .or_else(|| value.get("startedAt"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn upsert_meta(tx: &Transaction<'_>, key: &str, value: &Value) -> Result<(), String> {
    tx.execute(
        "
        insert into app_meta (key, value, updated_at)
        values (?, ?, datetime('now'))
        on conflict(key) do update set
            value=excluded.value,
            updated_at=excluded.updated_at
        ",
        params![key, json_text(value)?],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn insert_payload_table(
    tx: &Transaction<'_>,
    table: &str,
    owner_user_id: &str,
    payload: &Value,
) -> Result<(), String> {
    let id = json_id(payload).ok_or_else(|| format!("{table} payload missing id"))?;
    let user_id = json_user_id(payload, owner_user_id);
    let updated_at = json_updated_at(payload);
    let sql = format!("insert into {table} (id, user_id, payload, updated_at) values (?, ?, ?, ?)");
    tx.execute(&sql, params![id, user_id, json_text(payload)?, updated_at])
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn insert_payload_array(
    tx: &Transaction<'_>,
    state: &Value,
    key: &str,
    table: &str,
    owner_user_id: &str,
) -> Result<(), String> {
    if state.get(key).is_none() {
        return Ok(());
    }
    tx.execute(&format!("delete from {table}"), [])
        .map_err(|err| err.to_string())?;
    if let Some(items) = state.get(key).and_then(Value::as_array) {
        for item in items {
            insert_payload_table(tx, table, owner_user_id, item)?;
        }
    }
    Ok(())
}

fn save_state_tables(conn: &mut Connection, state: &Value) -> Result<(), String> {
    let user = state
        .get("user")
        .cloned()
        .unwrap_or_else(|| json!({ "id": "local-neko", "name": "Sunme", "handle": "@dayneko" }));
    let owner_user_id = user
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("local-neko");
    let tx = conn.transaction().map_err(|err| err.to_string())?;

    upsert_meta(&tx, "user", &user)?;
    if let Some(settings) = state.get("settings") {
        upsert_meta(&tx, "settings", settings)?;
    }
    if let Some(session) = state.get("cloudSession") {
        upsert_meta(&tx, "cloudSession", session)?;
    } else {
        tx.execute("delete from app_meta where key = 'cloudSession'", [])
            .map_err(|err| err.to_string())?;
    }
    if let Some(last_synced_at) = state.get("lastSyncedAt") {
        upsert_meta(&tx, "lastSyncedAt", last_synced_at)?;
    } else {
        tx.execute("delete from app_meta where key = 'lastSyncedAt'", [])
            .map_err(|err| err.to_string())?;
    }

    tx.execute("delete from dirty_queue", [])
        .map_err(|err| err.to_string())?;
    if let Some(items) = state.get("dirtyQueue").and_then(Value::as_array) {
        for item in items {
            let id = json_id(item).ok_or_else(|| "dirty_queue payload missing id".to_string())?;
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            let payload = item.get("payload").cloned().unwrap_or(Value::Null);
            let changed_at = item.get("changedAt").and_then(Value::as_str).unwrap_or("");
            tx.execute(
                "
                insert into dirty_queue (id, kind, payload, changed_at, updated_at)
                values (?, ?, ?, ?, datetime('now'))
                ",
                params![id, kind, json_text(&payload)?, changed_at],
            )
            .map_err(|err| err.to_string())?;
        }
    }

    insert_payload_array(&tx, state, "boots", "boots", owner_user_id)?;
    insert_payload_array(&tx, state, "activities", "activities", owner_user_id)?;
    insert_payload_array(&tx, state, "events", "events", owner_user_id)?;
    insert_payload_array(
        &tx,
        state,
        "dailyTemplates",
        "daily_templates",
        owner_user_id,
    )?;
    insert_payload_array(&tx, state, "friends", "friends", owner_user_id)?;
    insert_payload_array(
        &tx,
        state,
        "friendRequests",
        "friend_requests",
        owner_user_id,
    )?;
    insert_payload_array(&tx, state, "friendRatings", "friend_ratings", owner_user_id)?;

    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

fn table_for_record_kind(kind: &str) -> Result<&'static str, String> {
    match kind {
        "boot" | "boots" => Ok("boots"),
        "activity" | "activities" => Ok("activities"),
        "event" | "events" => Ok("events"),
        "daily-template" | "dailyTemplates" | "daily_templates" => Ok("daily_templates"),
        "friend" | "friends" => Ok("friends"),
        "friend-request" | "friendRequests" | "friend_requests" => Ok("friend_requests"),
        "friend-rating" | "friendRatings" | "friend_ratings" => Ok("friend_ratings"),
        _ => Err(format!("unsupported local record kind: {kind}")),
    }
}

fn upsert_local_record(
    conn: &mut Connection,
    kind: &str,
    owner_user_id: &str,
    payload: &Value,
) -> Result<(), String> {
    let table = table_for_record_kind(kind)?;
    let id = json_id(payload).ok_or_else(|| format!("{kind} payload missing id"))?;
    let user_id = json_user_id(payload, owner_user_id);
    let updated_at = json_updated_at(payload);
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        &format!(
            "
            insert into {table} (id, user_id, payload, updated_at)
            values (?, ?, ?, ?)
            on conflict(id) do update set
                user_id=excluded.user_id,
                payload=excluded.payload,
                updated_at=excluded.updated_at
            "
        ),
        params![id, user_id, json_text(payload)?, updated_at],
    )
    .map_err(|err| err.to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

fn load_meta(conn: &Connection, key: &str) -> Result<Option<Value>, String> {
    let raw = conn
        .query_row(
            "select value from app_meta where key = ?",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    raw.map(|value| serde_json::from_str(&value).map_err(|err| err.to_string()))
        .transpose()
}

fn migrate_daily_templates_once(conn: &mut Connection) -> Result<(), String> {
    if load_meta(conn, "migration:daily_templates_v1")?.is_some() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "
        insert into daily_templates (id, user_id, payload, updated_at)
        select id, user_id, payload, updated_at
        from events
        where json_extract(payload, '$.isTemplate') = 1
           or (json_extract(payload, '$.repeatDaily') = 1 and json_extract(payload, '$.templateId') is null)
        on conflict(id) do update set
            user_id=excluded.user_id,
            payload=excluded.payload,
            updated_at=excluded.updated_at
        ",
        [],
    )
    .map_err(|err| err.to_string())?;
    tx.execute(
        "
        delete from events
        where json_extract(payload, '$.isTemplate') = 1
           or (json_extract(payload, '$.repeatDaily') = 1 and json_extract(payload, '$.templateId') is null)
        ",
        [],
    )
    .map_err(|err| err.to_string())?;
    upsert_meta(
        &tx,
        "migration:daily_templates_v1",
        &json!({ "done": true, "updatedAt": chrono_like_now() }),
    )?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

fn load_payload_array(conn: &Connection, table: &str) -> Result<Value, String> {
    let sql = format!("select payload from {table} order by updated_at desc");
    let mut stmt = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let raw = row.map_err(|err| err.to_string())?;
        items.push(serde_json::from_str(&raw).map_err(|err| err.to_string())?);
    }
    Ok(Value::Array(items))
}

fn load_payload_array_limited(conn: &Connection, table: &str, limit: i64) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(&format!(
            "select payload from {table} order by updated_at desc limit ?"
        ))
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let raw = row.map_err(|err| err.to_string())?;
        items.push(serde_json::from_str(&raw).map_err(|err| err.to_string())?);
    }
    Ok(Value::Array(items))
}

fn load_time_dates(conn: &Connection, limit: i64) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "
            select date from (
                select coalesce(json_extract(payload, '$.date'), substr(json_extract(payload, '$.startedAt'), 1, 10)) as date
                from activities
                union
                select coalesce(json_extract(payload, '$.date'), substr(json_extract(payload, '$.startedAt'), 1, 10)) as date
                from boots
            )
            where date is not null and date != ''
            order by date desc
            limit ?
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    let mut dates = Vec::new();
    for row in rows {
        dates.push(Value::String(row.map_err(|err| err.to_string())?));
    }
    Ok(Value::Array(dates))
}

fn load_time_payloads_for_date(
    conn: &Connection,
    table: &str,
    date: &str,
    limit: i64,
) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(&format!(
            "
            select payload from {table}
            where json_extract(payload, '$.date') = ?
               or substr(json_extract(payload, '$.startedAt'), 1, 10) = ?
               or substr(json_extract(payload, '$.endedAt'), 1, 10) = ?
            order by updated_at desc
            limit ?
            "
        ))
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![date, date, date, limit], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|err| err.to_string())?;
    payload_rows_to_array(rows)
}

fn payload_rows_to_array(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<String>>,
) -> Result<Value, String> {
    let mut items = Vec::new();
    for row in rows {
        let raw = row.map_err(|err| err.to_string())?;
        items.push(serde_json::from_str(&raw).map_err(|err| err.to_string())?);
    }
    Ok(Value::Array(items))
}

fn month_range(month: &str) -> Result<(String, String), String> {
    let mut parts = month.split('-');
    let year = parts
        .next()
        .and_then(|value| value.parse::<i32>().ok())
        .ok_or_else(|| "invalid month".to_string())?;
    let month_number = parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| "invalid month".to_string())?;
    if parts.next().is_some() || !(1..=12).contains(&month_number) {
        return Err("invalid month".to_string());
    }
    let next_year = if month_number == 12 { year + 1 } else { year };
    let next_month = if month_number == 12 {
        1
    } else {
        month_number + 1
    };
    Ok((
        format!("{year:04}-{month_number:02}-01"),
        format!("{next_year:04}-{next_month:02}-01"),
    ))
}

fn load_events_for_date(conn: &Connection, date: &str, limit: i64) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "
            select payload from events
            where (json_extract(payload, '$.repeatDaily') = 1 and json_extract(payload, '$.date') <= ?)
               or json_extract(payload, '$.date') = ?
               or exists (
                    select 1 from json_each(events.payload, '$.completedDates')
                    where value = ?
               )
            order by updated_at desc
            limit ?
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![date, date, date, limit], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|err| err.to_string())?;
    payload_rows_to_array(rows)
}

fn load_events_for_month(conn: &Connection, month: &str) -> Result<Value, String> {
    let (start, end) = month_range(month)?;
    let mut stmt = conn
        .prepare(
            "
            select payload from events
            where (json_extract(payload, '$.date') >= ? and json_extract(payload, '$.date') < ?)
               or exists (
                    select 1 from json_each(events.payload, '$.completedDates')
                    where value >= ? and value < ?
               )
            order by json_extract(payload, '$.date') desc, updated_at desc
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![start, end, start, end], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|err| err.to_string())?;
    payload_rows_to_array(rows)
}

fn load_daily_templates(conn: &Connection, limit: i64) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "
            select payload from daily_templates
            order by updated_at desc
            limit ?
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    payload_rows_to_array(rows)
}

fn ensure_daily_instances(
    conn: &mut Connection,
    user_id: &str,
    date: &str,
) -> Result<Value, String> {
    let templates = load_daily_templates(conn, 1000)?;
    let now = conn
        .query_row("select strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|err| err.to_string())?;
    let mut existing_ids = std::collections::HashSet::new();
    let mut existing_titles = std::collections::HashSet::new();
    {
        let mut stmt = conn
            .prepare(
                "select id, coalesce(json_extract(payload, '$.title'), '') from events where json_extract(payload, '$.date') = ?",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![date], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|err| err.to_string())?;
        for row in rows {
            let (id, title) = row.map_err(|err| err.to_string())?;
            existing_ids.insert(id);
            existing_titles.insert(title.trim().to_lowercase());
        }
    }

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    let mut created = Vec::new();
    for template in templates.as_array().into_iter().flatten() {
        let Some(template_id) = json_id(template) else {
            continue;
        };
        if template
            .get("date")
            .and_then(Value::as_str)
            .is_some_and(|start| start > date)
        {
            continue;
        }
        let instance_id = format!("{template_id}:{date}");
        let title = template.get("title").and_then(Value::as_str).unwrap_or("");
        if existing_ids.contains(&instance_id)
            || existing_titles.contains(&title.trim().to_lowercase())
        {
            continue;
        }

        let completed = template
            .get("completedDates")
            .and_then(Value::as_array)
            .is_some_and(|dates| dates.iter().any(|value| value.as_str() == Some(date)));
        let mut instance = template.clone();
        let Some(instance_object) = instance.as_object_mut() else {
            continue;
        };
        instance_object.insert("id".to_string(), Value::String(instance_id.clone()));
        instance_object.insert("userId".to_string(), Value::String(user_id.to_string()));
        instance_object.insert("date".to_string(), Value::String(date.to_string()));
        instance_object.insert("repeatDaily".to_string(), Value::Bool(false));
        instance_object.insert(
            "templateId".to_string(),
            Value::String(template_id.to_string()),
        );
        instance_object.insert(
            "completedDates".to_string(),
            json!(if completed {
                vec![date]
            } else {
                Vec::<&str>::new()
            }),
        );
        instance_object.remove("isTemplate");
        if completed {
            let evidence = instance_object
                .get("evidence")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter(|image| {
                            image
                                .get("date")
                                .and_then(Value::as_str)
                                .is_none_or(|image_date| image_date == date)
                        })
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            instance_object.insert("evidence".to_string(), Value::Array(evidence));
        } else {
            instance_object.insert("evidence".to_string(), Value::Array(Vec::new()));
            instance_object.insert("createdAt".to_string(), Value::String(now.clone()));
            instance_object.insert("updatedAt".to_string(), Value::String(now.clone()));
        }

        tx.execute(
            "insert into events (id, user_id, payload, updated_at) values (?, ?, ?, ?)",
            params![
                instance_id,
                user_id,
                json_text(&instance)?,
                json_updated_at(&instance)
            ],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "
            insert into dirty_queue (id, kind, payload, changed_at, updated_at)
            values (?, 'event', ?, ?, datetime('now'))
            on conflict(id) do update set
                kind=excluded.kind,
                payload=excluded.payload,
                changed_at=excluded.changed_at,
                updated_at=excluded.updated_at
            ",
            params![format!("event:{instance_id}"), json_text(&instance)?, now],
        )
        .map_err(|err| err.to_string())?;
        existing_titles.insert(title.trim().to_lowercase());
        created.push(instance);
    }
    tx.commit().map_err(|err| err.to_string())?;
    Ok(Value::Array(created))
}

fn load_ratings_for_target_month(
    conn: &Connection,
    user_id: &str,
    month: &str,
) -> Result<Value, String> {
    let (start, end) = month_range(month)?;
    let mut stmt = conn
        .prepare(
            "
            select payload from friend_ratings
            where json_extract(payload, '$.targetUserId') = ?
              and json_extract(payload, '$.date') >= ?
              and json_extract(payload, '$.date') < ?
            order by json_extract(payload, '$.date') desc, updated_at desc
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![user_id, start, end], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    payload_rows_to_array(rows)
}

fn load_ratings_for_target(conn: &Connection, user_id: &str, limit: i64) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "
            select payload from friend_ratings
            where json_extract(payload, '$.targetUserId') = ?
            order by json_extract(payload, '$.date') desc, updated_at desc
            limit ?
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![user_id, limit], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    payload_rows_to_array(rows)
}

fn load_ratings_by_rater(conn: &Connection, user_id: &str, limit: i64) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "
            select payload from friend_ratings
            where json_extract(payload, '$.raterFriendId') = ?
            order by json_extract(payload, '$.date') desc, updated_at desc
            limit ?
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![user_id, limit], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    payload_rows_to_array(rows)
}

fn load_dirty_queue(conn: &Connection) -> Result<Value, String> {
    let mut stmt = conn
        .prepare("select id, kind, payload, changed_at from dirty_queue order by updated_at asc")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|err| err.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let (id, kind, payload, changed_at) = row.map_err(|err| err.to_string())?;
        items.push(json!({
            "id": id,
            "kind": kind,
            "payload": serde_json::from_str::<Value>(&payload).map_err(|err| err.to_string())?,
            "changedAt": changed_at
        }));
    }
    Ok(Value::Array(items))
}

fn load_state_tables(conn: &Connection) -> Result<Option<Value>, String> {
    let has_user = load_meta(conn, "user")?.is_some();
    let has_events = conn
        .query_row("select exists(select 1 from events limit 1)", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|err| err.to_string())?
        != 0;
    if !has_user && !has_events {
        return Ok(None);
    }

    let mut state = Map::new();
    if let Some(user) = load_meta(conn, "user")? {
        state.insert("user".to_string(), user);
    }
    if let Some(settings) = load_meta(conn, "settings")? {
        state.insert("settings".to_string(), settings);
    }
    if let Some(session) = load_meta(conn, "cloudSession")? {
        state.insert("cloudSession".to_string(), session);
    }
    if let Some(last_synced_at) = load_meta(conn, "lastSyncedAt")? {
        state.insert("lastSyncedAt".to_string(), last_synced_at);
    }

    state.insert("dirtyQueue".to_string(), load_dirty_queue(conn)?);
    state.insert("friends".to_string(), load_payload_array(conn, "friends")?);
    state.insert(
        "friendRequests".to_string(),
        load_payload_array(conn, "friend_requests")?,
    );

    Ok(Some(Value::Object(state)))
}

fn migrate_state_blob(conn: &mut Connection) -> Result<(), String> {
    let has_tables = load_meta(conn, "user")?.is_some()
        || conn
            .query_row("select exists(select 1 from events limit 1)", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|err| err.to_string())?
            != 0;
    if has_tables {
        return Ok(());
    }

    let raw = conn
        .query_row(
            "select value from app_state where key = 'state'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some(raw) = raw else {
        return Ok(());
    };
    let state = serde_json::from_str::<Value>(&raw).map_err(|err| err.to_string())?;
    save_state_tables(conn, &state)?;
    Ok(())
}

#[tauri::command]
fn set_close_to_tray(state: State<'_, CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn save_local_state(data_dir: String, state_json: String) -> Result<(), String> {
    if data_dir.trim().is_empty() {
        let state = serde_json::from_str::<Value>(&state_json).map_err(|err| err.to_string())?;
        write_data_path_pointer(&state)?;
        return Ok(());
    }
    let mut conn = connect_local_db(&data_dir)?;
    let state = serde_json::from_str::<Value>(&state_json).map_err(|err| err.to_string())?;
    save_state_tables(&mut conn, &state)?;
    conn.execute(
        "
        insert into app_state (key, value, updated_at)
        values ('legacy-migrated-state', ?, datetime('now'))
        on conflict(key) do update set
            value=excluded.value,
            updated_at=excluded.updated_at
        ",
        params![state_json],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_local_state(data_dir: String) -> Result<Option<String>, String> {
    if data_dir.trim().is_empty() {
        if let Some(pointer_data_dir) = read_data_path_pointer()? {
            let conn = connect_local_db(&pointer_data_dir)?;
            return load_state_tables(&conn)?
                .map(|mut state| {
                    if let Some(settings) = state.get_mut("settings").and_then(Value::as_object_mut)
                    {
                        settings.insert("dataPath".to_string(), Value::String(pointer_data_dir));
                    }
                    json_text(&state)
                })
                .transpose();
        }
    }
    let conn = connect_local_db(&data_dir)?;
    load_state_tables(&conn)?
        .map(|state| json_text(&state))
        .transpose()
}

#[tauri::command]
fn load_local_records(
    data_dir: String,
    kind: String,
    limit: Option<i64>,
) -> Result<String, String> {
    let conn = connect_local_db(&data_dir)?;
    let table = table_for_record_kind(&kind)?;
    let value = load_payload_array_limited(&conn, table, limit.unwrap_or(500).clamp(1, 5000))?;
    json_text(&value)
}

#[tauri::command]
fn load_local_home_data(data_dir: String, date: String, user_id: String) -> Result<String, String> {
    let conn = connect_local_db(&data_dir)?;
    let mut value = Map::new();
    value.insert(
        "events".to_string(),
        load_events_for_date(&conn, &date, 200)?,
    );
    value.insert(
        "dailyTemplates".to_string(),
        load_daily_templates(&conn, 500)?,
    );
    value.insert(
        "boots".to_string(),
        load_payload_array_limited(&conn, "boots", 1)?,
    );
    value.insert(
        "activities".to_string(),
        load_payload_array_limited(&conn, "activities", 1)?,
    );
    value.insert(
        "friendRatings".to_string(),
        load_ratings_for_target(&conn, &user_id, 30)?,
    );
    json_text(&Value::Object(value))
}

#[tauri::command]
fn load_local_schedule_data(
    data_dir: String,
    user_id: String,
    limit: Option<i64>,
) -> Result<String, String> {
    let conn = connect_local_db(&data_dir)?;
    let bounded_limit = limit.unwrap_or(500).clamp(1, 5000);
    let mut value = Map::new();
    value.insert(
        "events".to_string(),
        load_payload_array_limited(&conn, "events", bounded_limit)?,
    );
    value.insert(
        "dailyTemplates".to_string(),
        load_daily_templates(&conn, bounded_limit)?,
    );
    value.insert(
        "friendRatings".to_string(),
        load_ratings_for_target(&conn, &user_id, bounded_limit)?,
    );
    json_text(&Value::Object(value))
}

#[tauri::command]
fn load_local_schedule_month_data(
    data_dir: String,
    user_id: String,
    month: String,
) -> Result<String, String> {
    let conn = connect_local_db(&data_dir)?;
    let mut value = Map::new();
    value.insert("events".to_string(), load_events_for_month(&conn, &month)?);
    value.insert(
        "dailyTemplates".to_string(),
        load_daily_templates(&conn, 1000)?,
    );
    value.insert(
        "friendRatings".to_string(),
        load_ratings_for_target_month(&conn, &user_id, &month)?,
    );
    json_text(&Value::Object(value))
}

#[tauri::command]
fn ensure_local_daily_instances(
    data_dir: String,
    user_id: String,
    date: String,
) -> Result<String, String> {
    let mut conn = connect_local_db(&data_dir)?;
    json_text(&ensure_daily_instances(&mut conn, &user_id, &date)?)
}

#[tauri::command]
fn load_local_time_data(data_dir: String, limit: Option<i64>) -> Result<String, String> {
    let conn = connect_local_db(&data_dir)?;
    let bounded_limit = limit.unwrap_or(1000).clamp(1, 5000);
    let mut value = Map::new();
    value.insert(
        "activities".to_string(),
        load_payload_array_limited(&conn, "activities", bounded_limit)?,
    );
    value.insert(
        "boots".to_string(),
        load_payload_array_limited(&conn, "boots", bounded_limit)?,
    );
    json_text(&Value::Object(value))
}

#[tauri::command]
fn load_local_time_dates(data_dir: String, limit: Option<i64>) -> Result<String, String> {
    let conn = connect_local_db(&data_dir)?;
    json_text(&load_time_dates(
        &conn,
        limit.unwrap_or(5000).clamp(1, 20000),
    )?)
}

#[tauri::command]
fn load_local_time_day_data(
    data_dir: String,
    date: String,
    limit: Option<i64>,
) -> Result<String, String> {
    let conn = connect_local_db(&data_dir)?;
    let bounded_limit = limit.unwrap_or(1000).clamp(1, 5000);
    let mut value = Map::new();
    value.insert(
        "activities".to_string(),
        load_time_payloads_for_date(&conn, "activities", &date, bounded_limit)?,
    );
    value.insert(
        "boots".to_string(),
        load_time_payloads_for_date(&conn, "boots", &date, bounded_limit)?,
    );
    json_text(&Value::Object(value))
}

#[tauri::command]
fn load_local_friend_rating_data(
    data_dir: String,
    user_id: String,
    limit: Option<i64>,
) -> Result<String, String> {
    let conn = connect_local_db(&data_dir)?;
    let bounded_limit = limit.unwrap_or(500).clamp(1, 5000);
    let mut value = Map::new();
    value.insert(
        "received".to_string(),
        load_ratings_for_target(&conn, &user_id, bounded_limit)?,
    );
    value.insert(
        "given".to_string(),
        load_ratings_by_rater(&conn, &user_id, bounded_limit)?,
    );
    json_text(&Value::Object(value))
}

#[tauri::command]
fn save_local_record(
    data_dir: String,
    kind: String,
    record_json: String,
    user_id: String,
) -> Result<(), String> {
    let mut conn = connect_local_db(&data_dir)?;
    let payload = serde_json::from_str::<Value>(&record_json).map_err(|err| err.to_string())?;
    upsert_local_record(&mut conn, &kind, &user_id, &payload)
}

#[tauri::command]
fn delete_local_record(data_dir: String, kind: String, id: String) -> Result<(), String> {
    let conn = connect_local_db(&data_dir)?;
    let table = table_for_record_kind(&kind)?;
    conn.execute(&format!("delete from {table} where id = ?"), params![id])
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn data_dir_status(data_dir: String) -> Result<DataDirStatus, String> {
    let dir = resolve_data_dir(&data_dir)?;
    let db_path = dir.join("dayneko-local.db");
    let is_dayneko_data = if db_path.exists() {
        Connection::open(&db_path)
            .ok()
            .and_then(|conn| {
                conn.query_row(
                    "select exists(select 1 from sqlite_master where type = 'table' and name in ('events', 'app_meta', 'dirty_queue'))",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .ok()
            })
            .unwrap_or(0)
            != 0
    } else {
        false
    };
    Ok(DataDirStatus {
        has_database: db_path.exists(),
        has_evidence: dir.join("evidence").exists(),
        is_dayneko_data,
    })
}

#[tauri::command]
fn migrate_data_dir(
    from_data_dir: String,
    to_data_dir: String,
    overwrite: bool,
) -> Result<(), String> {
    let from = resolve_data_dir(&from_data_dir)?;
    let to = resolve_data_dir(&to_data_dir)?;
    if from == to {
        return Ok(());
    }
    fs::create_dir_all(&to).map_err(|err| err.to_string())?;
    let from_db = from.join("dayneko-local.db");
    let to_db = to.join("dayneko-local.db");
    if overwrite && !from_db.exists() && !from.join("evidence").exists() {
        return Err("source data does not exist".to_string());
    }
    if overwrite && to_db.exists() {
        fs::remove_file(&to_db).map_err(|err| err.to_string())?;
    }
    if from_db.exists() && !to_db.exists() {
        fs::copy(&from_db, &to_db).map_err(|err| err.to_string())?;
    } else if from_db.exists() && to_db.exists() {
        {
            let old_conn = Connection::open(&from_db).map_err(|err| err.to_string())?;
            init_local_db(&old_conn)?;
        }
        let conn = Connection::open(&to_db).map_err(|err| err.to_string())?;
        init_local_db(&conn)?;
        conn.execute(
            "attach database ? as olddb",
            params![from_db.to_string_lossy().to_string()],
        )
        .map_err(|err| err.to_string())?;
        for table in [
            "app_state",
            "app_meta",
            "dirty_queue",
            "boots",
            "activities",
            "events",
            "friends",
            "friend_requests",
            "friend_ratings",
        ] {
            conn.execute(
                &format!("insert or ignore into {table} select * from olddb.{table}"),
                [],
            )
            .map_err(|err| err.to_string())?;
        }
        conn.execute("detach database olddb", [])
            .map_err(|err| err.to_string())?;
    }
    copy_dir_missing_files(&from.join("evidence"), &to.join("evidence"), overwrite)?;
    if from_db.exists() {
        fs::remove_file(&from_db).map_err(|err| err.to_string())?;
    }
    let from_evidence = from.join("evidence");
    if from_evidence.exists() {
        fs::remove_dir_all(from_evidence).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_evidence_image(
    data_dir: String,
    image_id: String,
    file_name: String,
    data_url: String,
) -> Result<StoredImage, String> {
    let (header, body) = data_url
        .split_once(',')
        .ok_or_else(|| "invalid data url".to_string())?;
    let mime_type = header
        .strip_prefix("data:")
        .and_then(|value| value.split_once(';').map(|(mime, _)| mime.to_string()))
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let extension = match mime_type.as_str() {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "jpg",
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|err| err.to_string())?;
    let dir = resolve_data_dir(&data_dir)?.join("evidence");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let stem = PathBuf::from(file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".to_string())
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let path = dir.join(format!("{image_id}-{stem}.{extension}"));
    fs::write(&path, &bytes).map_err(|err| err.to_string())?;
    Ok(StoredImage {
        file_path: path.to_string_lossy().to_string(),
        mime_type,
        size: bytes.len(),
    })
}

#[tauri::command]
fn read_evidence_image_data_url(file_path: String, mime_type: String) -> Result<String, String> {
    let bytes = fs::read(&file_path).map_err(|err| err.to_string())?;
    let mime = if !mime_type.trim().is_empty() {
        mime_type
    } else {
        match PathBuf::from(&file_path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png".to_string(),
            "webp" => "image/webp".to_string(),
            "gif" => "image/gif".to_string(),
            _ => "image/jpeg".to_string(),
        }
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
fn delete_evidence_image(data_dir: String, file_path: String) -> Result<(), String> {
    if file_path.trim().is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Ok(());
    }
    let evidence_dir = resolve_data_dir(&data_dir)?.join("evidence");
    let evidence_root = evidence_dir.canonicalize().map_err(|err| err.to_string())?;
    let target = path.canonicalize().map_err(|err| err.to_string())?;
    if !target.starts_with(&evidence_root) {
        return Err("evidence image path is outside data evidence directory".to_string());
    }
    fs::remove_file(target).map_err(|err| err.to_string())
}

#[tauri::command]
fn get_default_data_dir() -> Result<String, String> {
    Ok(default_data_dir()?.to_string_lossy().to_string())
}

#[tauri::command]
fn get_system_username() -> Option<String> {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[tauri::command]
fn choose_data_dir(current_dir: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::{HRESULT, HSTRING};
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{
            FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName,
            FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
        };

        const ERROR_CANCELLED: HRESULT = HRESULT(0x800704C7u32 as i32);

        unsafe {
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let result = (|| -> windows::core::Result<Option<String>> {
                let dialog: IFileOpenDialog =
                    CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
                let options = dialog.GetOptions()?;
                dialog.SetOptions(
                    options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST,
                )?;
                dialog.SetTitle(&HSTRING::from("选择 DayNeko 数据目录"))?;

                let current_path = PathBuf::from(current_dir.trim());
                if current_path.exists() {
                    let current = HSTRING::from(current_path.to_string_lossy().as_ref());
                    let folder: windows::core::Result<IShellItem> =
                        SHCreateItemFromParsingName(&current, None);
                    if let Ok(folder) = folder {
                        let _ = dialog.SetFolder(&folder);
                    }
                }

                if let Err(err) = dialog.Show(None) {
                    if err.code() == ERROR_CANCELLED {
                        return Ok(None);
                    }
                    return Err(err);
                }

                let item = dialog.GetResult()?;
                let path = item.GetDisplayName(SIGDN_FILESYSPATH)?;
                let selected = path.to_string()?;
                CoTaskMemFree(Some(path.0 as _));
                Ok(Some(selected))
            })();
            if initialized {
                CoUninitialize();
            }
            return result.map_err(|err| err.to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = current_dir;
        Ok(None)
    }
}

#[tauri::command]
fn get_machine_key() -> String {
    let mut source = String::new();
    for key in [
        "COMPUTERNAME",
        "USERDOMAIN",
        "USERNAME",
        "PROCESSOR_IDENTIFIER",
    ] {
        if let Ok(value) = std::env::var(key) {
            source.push_str(&value);
            source.push('|');
        }
    }
    if source.is_empty() {
        source = "dayneko-local-device".to_string();
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut hasher);
    format!("dn-device-{:016x}", hasher.finish())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_foreground_activity() -> Result<ForegroundActivity, String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == std::ptr::null_mut() {
            return Ok(ForegroundActivity {
                title: String::new(),
                process: String::new(),
            });
        }

        let title_len = GetWindowTextLengthW(hwnd);
        let mut title_buffer = vec![0u16; title_len.saturating_add(1) as usize];
        let title_read = GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), title_buffer.len() as i32);
        let title = String::from_utf16_lossy(&title_buffer[..title_read.max(0) as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return Ok(ForegroundActivity {
                title,
                process: String::new(),
            });
        }

        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle == std::ptr::null_mut() {
            return Ok(ForegroundActivity {
                title,
                process: String::new(),
            });
        }

        let mut path_buffer = vec![0u16; 32768];
        let mut size = path_buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, path_buffer.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        let process_path = if ok == 0 {
            String::new()
        } else {
            String::from_utf16_lossy(&path_buffer[..size as usize])
        };
        let process = PathBuf::from(process_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();

        Ok(ForegroundActivity { title, process })
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_foreground_activity() -> Result<ForegroundActivity, String> {
    Ok(ForegroundActivity {
        title: String::new(),
        process: String::new(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(CloseToTray(AtomicBool::new(true)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--silent"]),
        ))
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            get_foreground_activity,
            get_machine_key,
            get_system_username,
            get_default_data_dir,
            choose_data_dir,
            save_local_state,
            load_local_state,
            load_local_records,
            load_local_home_data,
            load_local_schedule_data,
            load_local_schedule_month_data,
            ensure_local_daily_instances,
            load_local_time_data,
            load_local_time_dates,
            load_local_time_day_data,
            load_local_friend_rating_data,
            save_local_record,
            delete_local_record,
            data_dir_status,
            migrate_data_dir,
            save_evidence_image,
            read_evidence_image_data_url,
            delete_evidence_image
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示 DayNeko", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id("dayneko-tray")
                .tooltip("DayNeko")
                .icon(app.default_window_icon().expect("missing app icon").clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            if std::env::args().any(|arg| arg == "--silent") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window.state::<CloseToTray>().0.load(Ordering::Relaxed);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run DayNeko");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_generation_keeps_existing_database_event() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_local_db(&conn).unwrap();
        let template = json!({
            "id": "daily-1",
            "userId": "user-1",
            "title": "Read",
            "description": "",
            "date": "2026-06-01",
            "repeatDaily": true,
            "isTemplate": true,
            "completedDates": [],
            "evidence": [],
            "createdAt": "2026-06-01T00:00:00.000Z",
            "updatedAt": "2026-06-01T00:00:00.000Z"
        });
        conn.execute(
            "insert into daily_templates (id, user_id, payload, updated_at) values (?, ?, ?, ?)",
            params![
                "daily-1",
                "user-1",
                json_text(&template).unwrap(),
                "2026-06-01T00:00:00.000Z"
            ],
        )
        .unwrap();
        let existing = json!({
            "id": "daily-1:2026-06-20",
            "userId": "user-1",
            "title": "Read",
            "description": "",
            "date": "2026-06-20",
            "repeatDaily": false,
            "templateId": "daily-1",
            "completedDates": ["2026-06-20"],
            "evidence": [{"id": "photo-1", "dataUrl": "photo.jpg"}],
            "createdAt": "2026-06-20T01:00:00.000Z",
            "updatedAt": "2026-06-20T02:00:00.000Z"
        });
        conn.execute(
            "insert into events (id, user_id, payload, updated_at) values (?, ?, ?, ?)",
            params![
                "daily-1:2026-06-20",
                "user-1",
                json_text(&existing).unwrap(),
                "2026-06-20T02:00:00.000Z"
            ],
        )
        .unwrap();

        let created_today = ensure_daily_instances(&mut conn, "user-1", "2026-06-20").unwrap();
        assert_eq!(created_today, Value::Array(Vec::new()));
        let stored: String = conn
            .query_row(
                "select payload from events where id = ?",
                params!["daily-1:2026-06-20"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), existing);

        let created_next_day = ensure_daily_instances(&mut conn, "user-1", "2026-06-21").unwrap();
        assert_eq!(created_next_day.as_array().unwrap().len(), 1);
        let queued: i64 = conn
            .query_row(
                "select count(*) from dirty_queue where id = ?",
                params!["event:daily-1:2026-06-21"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(queued, 1);
    }
}
