use super::{RecorderState, RecordingStatus};
use crate::events::EventState;
use crate::session::models::SessionStatus;
use crate::session::SessionState;
use std::process::Command;
use tauri::State;

#[tauri::command]
pub fn start_recording(
    session_id: String,
    capture_window: Option<String>,
    recorder: State<RecorderState>,
    session_state: State<SessionState>,
    event_state: State<EventState>,
) -> Result<(), String> {
    let mut status = recorder.status.lock().map_err(|e| e.to_string())?;
    if *status == RecordingStatus::Recording {
        return Err("Already recording".into());
    }

    let session_dir = crate::session::db::get_sessions_dir().join(&session_id);
    let video_path = session_dir.join("recording.mp4");
    let audio_path = session_dir.join("audio.wav");

    // Build FFmpeg command for macOS screen + audio capture
    let mut ffmpeg_args = vec![
        "-y".to_string(),
        "-f".to_string(),
        "avfoundation".to_string(),
    ];

    // Capture screen (device 1) and mic (device 0) on macOS
    // Use "1:0" for screen:mic, adjust based on system
    ffmpeg_args.extend_from_slice(&[
        "-framerate".to_string(),
        "15".to_string(),
        "-i".to_string(),
        "1:0".to_string(),
        // Video output
        "-map".to_string(),
        "0:v".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "ultrafast".to_string(),
        "-crf".to_string(),
        "23".to_string(),
        video_path.to_string_lossy().to_string(),
        // Audio output
        "-map".to_string(),
        "0:a".to_string(),
        "-c:a".to_string(),
        "pcm_s16le".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        audio_path.to_string_lossy().to_string(),
    ]);

    let child = Command::new("ffmpeg")
        .args(&ffmpeg_args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    let pid = child.id();

    *recorder.ffmpeg_pid.lock().map_err(|e| e.to_string())? = Some(pid);
    *recorder.current_session_id.lock().map_err(|e| e.to_string())? = Some(session_id.clone());
    *recorder.start_time.lock().map_err(|e| e.to_string())? = Some(std::time::Instant::now());
    *status = RecordingStatus::Recording;

    // Update session status and paths
    {
        let db = session_state.db.lock().map_err(|e| e.to_string())?;
        db.execute(
            "UPDATE sessions SET status = ?1, video_path = ?2, audio_path = ?3 WHERE session_id = ?4",
            rusqlite::params![
                SessionStatus::Recording.to_string(),
                video_path.to_string_lossy().to_string(),
                audio_path.to_string_lossy().to_string(),
                session_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // Start event capture in background
    {
        let mut capturing = event_state.capturing.lock().map_err(|e| e.to_string())?;
        *capturing = true;
    }
    {
        let mut events_session = event_state.session_id.lock().map_err(|e| e.to_string())?;
        *events_session = Some(session_id);
    }

    // Start the event listener thread
    crate::events::start_event_listener(
        event_state.inner().clone(),
    );

    Ok(())
}

#[tauri::command]
pub fn stop_recording(
    recorder: State<RecorderState>,
    session_state: State<SessionState>,
    event_state: State<EventState>,
) -> Result<String, String> {
    let mut status = recorder.status.lock().map_err(|e| e.to_string())?;
    if *status != RecordingStatus::Recording {
        return Err("Not currently recording".into());
    }
    *status = RecordingStatus::Stopping;

    // Stop event capture
    {
        let mut capturing = event_state.capturing.lock().map_err(|e| e.to_string())?;
        *capturing = false;
    }

    // Kill FFmpeg process
    if let Some(pid) = *recorder.ffmpeg_pid.lock().map_err(|e| e.to_string())? {
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGINT);
            }
        }
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(&["/PID", &pid.to_string(), "/F"])
                .output();
        }
    }

    let session_id = recorder.current_session_id.lock().map_err(|e| e.to_string())?
        .clone()
        .ok_or("No active session")?;

    // Save events to file
    let session_dir = crate::session::db::get_sessions_dir().join(&session_id);
    let event_log_path = session_dir.join("events.json");
    {
        let events = event_state.events.lock().map_err(|e| e.to_string())?;
        let events_json = serde_json::to_string_pretty(&*events).map_err(|e| e.to_string())?;
        std::fs::write(&event_log_path, events_json).map_err(|e| e.to_string())?;
    }

    // Update session in DB
    {
        let db = session_state.db.lock().map_err(|e| e.to_string())?;
        db.execute(
            "UPDATE sessions SET status = ?1, ended_at = ?2, event_log_path = ?3 WHERE session_id = ?4",
            rusqlite::params![
                SessionStatus::Recorded.to_string(),
                chrono::Utc::now().to_rfc3339(),
                event_log_path.to_string_lossy().to_string(),
                session_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // Clear recorder state
    *recorder.ffmpeg_pid.lock().map_err(|e| e.to_string())? = None;
    *recorder.start_time.lock().map_err(|e| e.to_string())? = None;
    *status = RecordingStatus::Idle;

    // Clear events buffer
    event_state.events.lock().map_err(|e| e.to_string())?.clear();

    Ok(session_id)
}

#[tauri::command]
pub fn get_recording_status(recorder: State<RecorderState>) -> Result<serde_json::Value, String> {
    let status = recorder.status.lock().map_err(|e| e.to_string())?;
    let session_id = recorder.current_session_id.lock().map_err(|e| e.to_string())?;
    let elapsed = recorder.start_time.lock().map_err(|e| e.to_string())?
        .map(|t| t.elapsed().as_secs());

    Ok(serde_json::json!({
        "status": *status,
        "session_id": *session_id,
        "elapsed_seconds": elapsed,
    }))
}
