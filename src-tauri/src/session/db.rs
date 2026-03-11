use anyhow::Result;
use rusqlite::Connection;

pub fn get_db_path() -> std::path::PathBuf {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("capture-tool");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("sessions.db")
}

pub fn get_sessions_dir() -> std::path::PathBuf {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("capture-tool")
        .join("sessions");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir
}

pub fn initialize() -> Result<Connection> {
    let db_path = get_db_path();
    let conn = Connection::open(db_path)?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            source_mode TEXT NOT NULL DEFAULT 'screen_only',
            video_path TEXT,
            audio_path TEXT,
            event_log_path TEXT,
            transcript_path TEXT,
            output_dir TEXT,
            status TEXT NOT NULL DEFAULT 'created'
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            t_ms INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            x REAL,
            y REAL,
            button TEXT,
            key TEXT,
            window_title TEXT,
            app_name TEXT,
            dom_hint_json TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id)
        );

        CREATE TABLE IF NOT EXISTS steps (
            step_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            t_start_ms INTEGER NOT NULL,
            t_end_ms INTEGER NOT NULL,
            title TEXT NOT NULL,
            instruction TEXT NOT NULL DEFAULT '',
            screenshot TEXT,
            gif TEXT,
            confidence REAL NOT NULL DEFAULT 0.0,
            review_required INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id)
        );

        CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
        CREATE INDEX IF NOT EXISTS idx_events_time ON events(session_id, t_ms);
        CREATE INDEX IF NOT EXISTS idx_steps_session ON steps(session_id);
        ",
    )?;

    Ok(conn)
}
