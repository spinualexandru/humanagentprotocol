use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ticket {
    pub id: String,
    pub from: String,
    pub to: String,
    pub intent: serde_json::Value,
    pub artifact: Option<serde_json::Value>,
    pub lease: serde_json::Value,
    pub risk: f64,
    pub priority: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

struct DbState(Mutex<Connection>);

fn get_db_path() -> PathBuf {
    if let Ok(path) = std::env::var("HAP_DB_PATH") {
        PathBuf::from(path)
    } else {
        let home = dirs::home_dir().expect("Could not find home directory");
        home.join(".hap").join("hap.db")
    }
}

fn query_tickets(conn: &Connection, state_filter: &[&str]) -> Vec<Ticket> {
    let placeholders: Vec<String> = state_filter.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT id, \"from\", \"to\", intent, artifact, lease, risk, priority, state, created_at, updated_at FROM tickets WHERE state IN ({}) ORDER BY created_at DESC",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).unwrap();
    let params: Vec<&dyn rusqlite::types::ToSql> = state_filter
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt
        .query_map(params.as_slice(), |row| {
            let intent_str: String = row.get(3)?;
            let artifact_str: Option<String> = row.get(4)?;
            let lease_str: String = row.get(5)?;

            Ok(Ticket {
                id: row.get(0)?,
                from: row.get(1)?,
                to: row.get(2)?,
                intent: serde_json::from_str(&intent_str).unwrap_or(serde_json::Value::Null),
                artifact: artifact_str
                    .map(|s| serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)),
                lease: serde_json::from_str(&lease_str).unwrap_or(serde_json::Value::Null),
                risk: row.get(6)?,
                priority: row.get(7)?,
                state: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .unwrap();

    rows.filter_map(|r| r.ok()).collect()
}

#[tauri::command]
fn list_pending(db: State<'_, DbState>) -> Vec<Ticket> {
    let conn = db.0.lock().unwrap();
    query_tickets(&conn, &["PENDING", "DELIVERED", "ACKED"])
}

#[tauri::command]
fn list_all(db: State<'_, DbState>) -> Vec<Ticket> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, \"from\", \"to\", intent, artifact, lease, risk, priority, state, created_at, updated_at FROM tickets ORDER BY created_at DESC LIMIT 50")
        .unwrap();

    let rows = stmt
        .query_map([], |row| {
            let intent_str: String = row.get(3)?;
            let artifact_str: Option<String> = row.get(4)?;
            let lease_str: String = row.get(5)?;

            Ok(Ticket {
                id: row.get(0)?,
                from: row.get(1)?,
                to: row.get(2)?,
                intent: serde_json::from_str(&intent_str).unwrap_or(serde_json::Value::Null),
                artifact: artifact_str
                    .map(|s| serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)),
                lease: serde_json::from_str(&lease_str).unwrap_or(serde_json::Value::Null),
                risk: row.get(6)?,
                priority: row.get(7)?,
                state: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .unwrap();

    rows.filter_map(|r| r.ok()).collect()
}

#[tauri::command]
fn get_ticket(db: State<'_, DbState>, ticket_id: String) -> Option<Ticket> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, \"from\", \"to\", intent, artifact, lease, risk, priority, state, created_at, updated_at FROM tickets WHERE id = ?")
        .unwrap();

    stmt.query_row([&ticket_id], |row| {
        let intent_str: String = row.get(3)?;
        let artifact_str: Option<String> = row.get(4)?;
        let lease_str: String = row.get(5)?;

        Ok(Ticket {
            id: row.get(0)?,
            from: row.get(1)?,
            to: row.get(2)?,
            intent: serde_json::from_str(&intent_str).unwrap_or(serde_json::Value::Null),
            artifact: artifact_str
                .map(|s| serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)),
            lease: serde_json::from_str(&lease_str).unwrap_or(serde_json::Value::Null),
            risk: row.get(6)?,
            priority: row.get(7)?,
            state: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })
    .ok()
}

#[tauri::command]
fn approve_ticket(
    db: State<'_, DbState>,
    ticket_id: String,
    comment: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().unwrap();

    // Check current state
    let state: String = conn
        .query_row(
            "SELECT state FROM tickets WHERE id = ?",
            [&ticket_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("Ticket {} not found", ticket_id))?;

    if state == "APPROVED" || state == "REJECTED" || state == "EXPIRED" || state == "CANCELED" {
        return Err(format!(
            "Ticket {} is already in terminal state: {}",
            ticket_id, state
        ));
    }

    conn.execute(
        "UPDATE tickets SET state = 'APPROVED', updated_at = datetime('now') WHERE id = ?",
        [&ticket_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = comment; // comment logged but not stored in this simplified version
    Ok(format!("Ticket {} approved", ticket_id))
}

#[tauri::command]
fn reject_ticket(
    db: State<'_, DbState>,
    ticket_id: String,
    comment: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().unwrap();

    let state: String = conn
        .query_row(
            "SELECT state FROM tickets WHERE id = ?",
            [&ticket_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("Ticket {} not found", ticket_id))?;

    if state == "APPROVED" || state == "REJECTED" || state == "EXPIRED" || state == "CANCELED" {
        return Err(format!(
            "Ticket {} is already in terminal state: {}",
            ticket_id, state
        ));
    }

    conn.execute(
        "UPDATE tickets SET state = 'REJECTED', updated_at = datetime('now') WHERE id = ?",
        [&ticket_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = comment;
    Ok(format!("Ticket {} rejected", ticket_id))
}

pub fn run() {
    let db_path = get_db_path();

    // Ensure directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let conn = Connection::open(&db_path).expect("Failed to open HAP database");
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .expect("Failed to enable WAL mode");

    // Create tables if they don't exist (in case app runs before MCP server)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            \"from\" TEXT NOT NULL,
            \"to\" TEXT NOT NULL,
            intent TEXT NOT NULL,
            artifact TEXT,
            lease TEXT NOT NULL,
            risk REAL NOT NULL,
            priority TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'PENDING',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            list_pending,
            list_all,
            get_ticket,
            approve_ticket,
            reject_ticket,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
