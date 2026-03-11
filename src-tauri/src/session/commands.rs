use super::models::{Session, SessionStatus, SourceMode};
use super::SessionState;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn create_session(
    title: String,
    source_mode: String,
    state: State<SessionState>,
) -> Result<Session, String> {
    let session_id = format!("sess_{}", Uuid::new_v4().to_string().replace("-", "")[..12].to_string());
    let started_at = Utc::now().to_rfc3339();
    let mode: SourceMode = source_mode.parse().map_err(|e: String| e)?;

    // Create session directory
    let session_dir = super::db::get_sessions_dir().join(&session_id);
    std::fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(session_dir.join("assets")).map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO sessions (session_id, title, started_at, source_mode, status) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![session_id, title, started_at, mode.to_string(), "created"],
    ).map_err(|e| e.to_string())?;

    Ok(Session {
        session_id,
        title,
        started_at,
        ended_at: None,
        source_mode: mode,
        video_path: None,
        audio_path: None,
        event_log_path: None,
        transcript_path: None,
        output_dir: None,
        status: SessionStatus::Created,
    })
}

#[tauri::command]
pub fn get_session(session_id: String, state: State<SessionState>) -> Result<Session, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT session_id, title, started_at, ended_at, source_mode, video_path, audio_path, event_log_path, transcript_path, output_dir, status FROM sessions WHERE session_id = ?1")
        .map_err(|e| e.to_string())?;

    let session = stmt
        .query_row(rusqlite::params![session_id], |row| {
            Ok(Session {
                session_id: row.get(0)?,
                title: row.get(1)?,
                started_at: row.get(2)?,
                ended_at: row.get(3)?,
                source_mode: row.get::<_, String>(4)?.parse().unwrap_or(SourceMode::ScreenOnly),
                video_path: row.get(5)?,
                audio_path: row.get(6)?,
                event_log_path: row.get(7)?,
                transcript_path: row.get(8)?,
                output_dir: row.get(9)?,
                status: row.get::<_, String>(10)?.parse().unwrap_or(SessionStatus::Created),
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(session)
}

#[tauri::command]
pub fn list_sessions(state: State<SessionState>) -> Result<Vec<Session>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT session_id, title, started_at, ended_at, source_mode, video_path, audio_path, event_log_path, transcript_path, output_dir, status FROM sessions ORDER BY started_at DESC")
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map([], |row| {
            Ok(Session {
                session_id: row.get(0)?,
                title: row.get(1)?,
                started_at: row.get(2)?,
                ended_at: row.get(3)?,
                source_mode: row.get::<_, String>(4)?.parse().unwrap_or(SourceMode::ScreenOnly),
                video_path: row.get(5)?,
                audio_path: row.get(6)?,
                event_log_path: row.get(7)?,
                transcript_path: row.get(8)?,
                output_dir: row.get(9)?,
                status: row.get::<_, String>(10)?.parse().unwrap_or(SessionStatus::Created),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(sessions)
}

#[tauri::command]
pub fn delete_session(session_id: String, state: State<SessionState>) -> Result<(), String> {
    // Delete session directory
    let session_dir = super::db::get_sessions_dir().join(&session_id);
    if session_dir.exists() {
        std::fs::remove_dir_all(&session_dir).map_err(|e| e.to_string())?;
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM events WHERE session_id = ?1", rusqlite::params![session_id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM steps WHERE session_id = ?1", rusqlite::params![session_id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM sessions WHERE session_id = ?1", rusqlite::params![session_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_output_dir(
    session_id: String,
    output_dir: String,
    state: State<SessionState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE sessions SET output_dir = ?1 WHERE session_id = ?2",
        rusqlite::params![output_dir, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
