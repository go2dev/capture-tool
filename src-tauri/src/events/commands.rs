use super::EventState;
use crate::session::models::{CaptureEvent, EventType};
use tauri::State;

#[tauri::command]
pub fn add_marker(label: Option<String>, event_state: State<EventState>) -> Result<(), String> {
    let is_capturing = event_state.capturing.lock().map_err(|e| e.to_string())?;
    if !*is_capturing {
        return Err("Not currently recording".into());
    }

    let t_ms = event_state
        .start_time
        .lock()
        .map_err(|e| e.to_string())?
        .map(|s| s.elapsed().as_millis() as u64)
        .unwrap_or(0);

    let marker = CaptureEvent {
        t_ms,
        event_type: EventType::Marker,
        x: None,
        y: None,
        button: None,
        key: label,
        window_title: None,
        app_name: None,
        dom_hint: None,
    };

    event_state
        .events
        .lock()
        .map_err(|e| e.to_string())?
        .push(marker);

    Ok(())
}

#[tauri::command]
pub fn get_events(session_id: String) -> Result<Vec<CaptureEvent>, String> {
    let session_dir = crate::session::db::get_sessions_dir().join(&session_id);
    let event_log_path = session_dir.join("events.json");

    if !event_log_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&event_log_path).map_err(|e| e.to_string())?;
    let events: Vec<CaptureEvent> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(events)
}
