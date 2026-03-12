use super::VoiceoverState;
use crate::session::db::get_sessions_dir;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceoverStatus {
    pub has_voiceover: bool,
    pub has_merged: bool,
    pub voiceover_duration_secs: Option<f64>,
    pub is_recording: bool,
    pub recording_elapsed_secs: Option<f64>,
}

/// Start recording mic audio to `voiceover.wav` in the session directory.
#[tauri::command]
pub fn start_voiceover(
    session_id: String,
    state: State<VoiceoverState>,
) -> Result<(), String> {
    // Check we aren't already recording a voiceover
    {
        let pid = state.ffmpeg_pid.lock().map_err(|e| e.to_string())?;
        if pid.is_some() {
            return Err("Voiceover recording already in progress".into());
        }
    }

    let session_dir = get_sessions_dir().join(&session_id);
    if !session_dir.exists() {
        return Err(format!("Session directory not found: {}", session_id));
    }

    let voiceover_path = session_dir.join("voiceover.wav");

    // Record mic audio via FFmpeg using avfoundation on macOS.
    // Device ":0" = default audio input (mic only, no video).
    let child = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "avfoundation",
            "-i",
            ":0",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            voiceover_path.to_str().unwrap(),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start FFmpeg voiceover recording: {}", e))?;

    let pid = child.id();

    *state.ffmpeg_pid.lock().map_err(|e| e.to_string())? = Some(pid);
    *state.recording_session_id.lock().map_err(|e| e.to_string())? = Some(session_id);
    *state.start_time.lock().map_err(|e| e.to_string())? = Some(std::time::Instant::now());

    Ok(())
}

/// Stop the active voiceover recording by sending SIGINT to FFmpeg.
#[tauri::command]
pub fn stop_voiceover(
    session_id: String,
    state: State<VoiceoverState>,
) -> Result<(), String> {
    let pid = {
        let pid_lock = state.ffmpeg_pid.lock().map_err(|e| e.to_string())?;
        pid_lock.ok_or("No voiceover recording in progress")?
    };

    // Verify the recording belongs to this session
    {
        let rec_session = state.recording_session_id.lock().map_err(|e| e.to_string())?;
        if rec_session.as_deref() != Some(&session_id) {
            return Err("Voiceover recording belongs to a different session".into());
        }
    }

    // Send SIGINT to FFmpeg so it finalises the file properly
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

    // Give FFmpeg a moment to flush buffers
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Clear state
    *state.ffmpeg_pid.lock().map_err(|e| e.to_string())? = None;
    *state.recording_session_id.lock().map_err(|e| e.to_string())? = None;
    *state.start_time.lock().map_err(|e| e.to_string())? = None;

    Ok(())
}

/// Merge original `audio.wav` and `voiceover.wav` into `merged_audio.wav`.
///
/// Strategy:
/// - If the original audio has meaningful speech (RMS above a threshold),
///   mix both tracks with the voiceover at a higher volume.
/// - If the original audio is silent or near-silent, use the voiceover only.
#[tauri::command]
pub fn merge_audio(session_id: String) -> Result<(), String> {
    let session_dir = get_sessions_dir().join(&session_id);
    let audio_path = session_dir.join("audio.wav");
    let voiceover_path = session_dir.join("voiceover.wav");
    let merged_path = session_dir.join("merged_audio.wav");

    if !voiceover_path.exists() {
        return Err("No voiceover file found".into());
    }

    // If there is no original audio, just copy the voiceover as merged
    if !audio_path.exists() {
        std::fs::copy(&voiceover_path, &merged_path).map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Detect whether the original audio has meaningful content by checking
    // its mean volume using ffmpeg's volumedetect filter.
    let has_speech = detect_audio_has_speech(&audio_path)?;

    if has_speech {
        // Mix both tracks: original at normal volume, voiceover boosted by 6dB
        // The amix filter mixes them together; we boost the voiceover input first.
        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                audio_path.to_str().unwrap(),
                "-i",
                voiceover_path.to_str().unwrap(),
                "-filter_complex",
                "[0:a]volume=0.5[orig];[1:a]volume=1.5[vo];[orig][vo]amix=inputs=2:duration=longest:dropout_transition=2[out]",
                "-map",
                "[out]",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                merged_path.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("FFmpeg merge failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg merge failed: {}", stderr));
        }
    } else {
        // Original audio is silent/minimal -- just use the voiceover
        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                voiceover_path.to_str().unwrap(),
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                merged_path.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("FFmpeg copy failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg copy failed: {}", stderr));
        }
    }

    Ok(())
}

/// Returns status information about voiceover files for this session.
#[tauri::command]
pub fn get_voiceover_status(
    session_id: String,
    state: State<VoiceoverState>,
) -> Result<VoiceoverStatus, String> {
    let session_dir = get_sessions_dir().join(&session_id);
    let voiceover_path = session_dir.join("voiceover.wav");
    let merged_path = session_dir.join("merged_audio.wav");

    let has_voiceover = voiceover_path.exists();
    let has_merged = merged_path.exists();

    // Get voiceover duration if it exists
    let voiceover_duration_secs = if has_voiceover {
        get_audio_duration(&voiceover_path).ok()
    } else {
        None
    };

    // Check if we are currently recording for this session
    let is_recording = {
        let rec_session = state.recording_session_id.lock().map_err(|e| e.to_string())?;
        rec_session.as_deref() == Some(session_id.as_str())
    };

    let recording_elapsed_secs = if is_recording {
        let start = state.start_time.lock().map_err(|e| e.to_string())?;
        start.map(|t| t.elapsed().as_secs_f64())
    } else {
        None
    };

    Ok(VoiceoverStatus {
        has_voiceover,
        has_merged,
        voiceover_duration_secs,
        is_recording,
        recording_elapsed_secs,
    })
}

/// Delete the voiceover file so the user can re-record.
/// Also removes merged_audio.wav if it exists.
#[tauri::command]
pub fn delete_voiceover(session_id: String) -> Result<(), String> {
    let session_dir = get_sessions_dir().join(&session_id);

    let voiceover_path = session_dir.join("voiceover.wav");
    if voiceover_path.exists() {
        std::fs::remove_file(&voiceover_path).map_err(|e| e.to_string())?;
    }

    let merged_path = session_dir.join("merged_audio.wav");
    if merged_path.exists() {
        std::fs::remove_file(&merged_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Returns the path to the session's video file for playback via `convertFileSrc`.
#[tauri::command]
pub fn get_video_path(session_id: String) -> Result<String, String> {
    let session_dir = get_sessions_dir().join(&session_id);
    let video_path = session_dir.join("recording.mp4");

    if !video_path.exists() {
        return Err("Video file not found".into());
    }

    Ok(video_path.to_string_lossy().to_string())
}

// -------------------------------------------------------
// Internal merge function (callable from other modules without Tauri State)
// -------------------------------------------------------

/// Internal merge logic that takes a session directory path directly.
/// Used by `process_session` for auto-merging when voiceover exists but
/// the user didn't explicitly merge.
pub fn merge_audio_internal(session_dir: &std::path::Path) -> Result<(), String> {
    let audio_path = session_dir.join("audio.wav");
    let voiceover_path = session_dir.join("voiceover.wav");
    let merged_path = session_dir.join("merged_audio.wav");

    if !voiceover_path.exists() {
        return Err("No voiceover file found".into());
    }

    if !audio_path.exists() {
        std::fs::copy(&voiceover_path, &merged_path).map_err(|e| e.to_string())?;
        return Ok(());
    }

    let has_speech = detect_audio_has_speech(&audio_path)?;

    if has_speech {
        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                audio_path.to_str().unwrap(),
                "-i",
                voiceover_path.to_str().unwrap(),
                "-filter_complex",
                "[0:a]volume=0.5[orig];[1:a]volume=1.5[vo];[orig][vo]amix=inputs=2:duration=longest:dropout_transition=2[out]",
                "-map",
                "[out]",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                merged_path.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("FFmpeg merge failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg merge failed: {}", stderr));
        }
    } else {
        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                voiceover_path.to_str().unwrap(),
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                merged_path.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("FFmpeg copy failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg copy failed: {}", stderr));
        }
    }

    Ok(())
}

// -------------------------------------------------------
// Helper functions
// -------------------------------------------------------

/// Uses ffmpeg's volumedetect to determine if the audio has meaningful content.
/// Returns true if mean_volume is above -40 dB (i.e. not silence).
fn detect_audio_has_speech(audio_path: &std::path::Path) -> Result<bool, String> {
    let output = Command::new("ffmpeg")
        .args([
            "-i",
            audio_path.to_str().unwrap(),
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
        ])
        .output()
        .map_err(|e| format!("FFmpeg volumedetect failed: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);

    // Parse mean_volume from FFmpeg output: "mean_volume: -30.2 dB"
    for line in stderr.lines() {
        if let Some(pos) = line.find("mean_volume:") {
            let vol_str = &line[pos + "mean_volume:".len()..];
            let vol_str = vol_str.trim().trim_end_matches("dB").trim();
            if let Ok(vol) = vol_str.parse::<f64>() {
                // If mean volume is above -40 dB, consider it as having speech
                return Ok(vol > -40.0);
            }
        }
    }

    // If we can't determine volume, assume there is speech (safe default)
    Ok(true)
}

/// Get the duration of an audio file in seconds using ffprobe.
fn get_audio_duration(path: &std::path::Path) -> Result<f64, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    if !output.status.success() {
        return Err("ffprobe failed".into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse duration: {}", e))
}
