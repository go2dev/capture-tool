use super::{ProcessingProgress, ProcessingStage};
use crate::session::db::get_sessions_dir;
use crate::session::models::SessionStatus;
use crate::session::SessionState;
use crate::settings::SettingsState;
use std::process::Command;
use tauri::State;

#[tauri::command]
pub async fn process_session(
    session_id: String,
    session_state: State<'_, SessionState>,
) -> Result<(), String> {
    let session_dir = get_sessions_dir().join(&session_id);
    let video_path = session_dir.join("recording.mp4");
    let audio_path = session_dir.join("audio.wav");
    let merged_audio_path = session_dir.join("merged_audio.wav");
    let voiceover_path = session_dir.join("voiceover.wav");

    // Update status to processing
    {
        let db = session_state.db.lock().map_err(|e| e.to_string())?;
        db.execute(
            "UPDATE sessions SET status = ?1 WHERE session_id = ?2",
            rusqlite::params![SessionStatus::Processing.to_string(), session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Step 1: Extract audio if not already separate
    if !audio_path.exists() && video_path.exists() {
        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                video_path.to_str().unwrap(),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                audio_path.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("FFmpeg audio extraction failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("FFmpeg audio extraction warning: {}", stderr);
        }
    }

    // Step 1b: Determine the best audio source for transcription.
    // Priority: merged_audio.wav > auto-merge voiceover.wav > audio.wav
    let transcription_audio = if merged_audio_path.exists() {
        // User already merged voiceover -- use it
        merged_audio_path.clone()
    } else if voiceover_path.exists() && audio_path.exists() {
        // Voiceover exists but hasn't been merged yet -- auto-merge now
        log::info!("Auto-merging voiceover with original audio for session {}", session_id);
        let merge_result = crate::voiceover::commands::merge_audio_internal(&session_dir);
        if merge_result.is_ok() && merged_audio_path.exists() {
            merged_audio_path.clone()
        } else {
            log::warn!("Auto-merge failed, falling back to original audio");
            audio_path.clone()
        }
    } else if voiceover_path.exists() {
        // Only voiceover exists (no original audio)
        voiceover_path.clone()
    } else {
        // No voiceover -- use original audio
        audio_path.clone()
    };

    // Step 2: Run Python transcription worker
    let transcript_path = session_dir.join("transcript.json");
    let workers_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("workers");

    if transcription_audio.exists() {
        let output = Command::new("python3")
            .arg(workers_dir.join("transcribe.py"))
            .arg(&transcription_audio)
            .arg(&transcript_path)
            .output()
            .map_err(|e| format!("Transcription worker failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("Transcription warning: {}", stderr);
        }
    }

    // Step 3: Run step segmentation
    let events_path = session_dir.join("events.json");
    let steps_path = session_dir.join("steps.json");

    let output = Command::new("python3")
        .arg(workers_dir.join("segment.py"))
        .arg(&session_dir)
        .output()
        .map_err(|e| format!("Segmentation worker failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("Segmentation warning: {}", stderr);
    }

    // Update status
    {
        let db = session_state.db.lock().map_err(|e| e.to_string())?;
        db.execute(
            "UPDATE sessions SET status = ?1, transcript_path = ?2 WHERE session_id = ?3",
            rusqlite::params![
                SessionStatus::Processed.to_string(),
                transcript_path.to_string_lossy().to_string(),
                session_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_processing_status(session_id: String) -> Result<ProcessingProgress, String> {
    let session_dir = get_sessions_dir().join(&session_id);
    let status_path = session_dir.join("processing_status.json");

    if status_path.exists() {
        let content = std::fs::read_to_string(&status_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(ProcessingProgress {
            stage: ProcessingStage::Idle,
            progress: 0.0,
            message: "Not started".into(),
        })
    }
}

#[tauri::command]
pub fn extract_frames(
    session_id: String,
    timestamps_ms: Vec<u64>,
) -> Result<Vec<String>, String> {
    let session_dir = get_sessions_dir().join(&session_id);
    let video_path = session_dir.join("recording.mp4");
    let assets_dir = session_dir.join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

    let mut frame_paths = Vec::new();

    for (i, ts) in timestamps_ms.iter().enumerate() {
        let seconds = *ts as f64 / 1000.0;
        let output_path = assets_dir.join(format!("step-{:02}.png", i + 1));

        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-ss",
                &format!("{:.3}", seconds),
                "-i",
                video_path.to_str().unwrap(),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                output_path.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("Frame extraction failed: {}", e))?;

        if output.status.success() {
            frame_paths.push(output_path.to_string_lossy().to_string());
        }
    }

    Ok(frame_paths)
}

#[tauri::command]
pub fn generate_mdx(
    session_id: String,
    settings_state: State<'_, SettingsState>,
) -> Result<String, String> {
    let session_dir = get_sessions_dir().join(&session_id);
    let workers_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("workers");

    // Read LLM settings
    let settings = settings_state
        .inner
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let provider_str = match &settings.llm_provider {
        crate::settings::LlmProvider::Anthropic => "anthropic",
        crate::settings::LlmProvider::Openai => "openai",
        crate::settings::LlmProvider::Ollama => "ollama",
        crate::settings::LlmProvider::None => "none",
    };

    let mut cmd = Command::new("python3");
    cmd.arg(workers_dir.join("generate_mdx.py"))
        .arg(&session_dir)
        .arg("--provider")
        .arg(provider_str)
        .arg("--model")
        .arg(&settings.llm_model);

    // Pass the appropriate API key or URL
    match &settings.llm_provider {
        crate::settings::LlmProvider::Anthropic => {
            if let Some(ref key) = settings.anthropic_api_key {
                if !key.is_empty() {
                    cmd.arg("--api-key").arg(key);
                }
            }
        }
        crate::settings::LlmProvider::Openai => {
            if let Some(ref key) = settings.openai_api_key {
                if !key.is_empty() {
                    cmd.arg("--api-key").arg(key);
                }
            }
        }
        crate::settings::LlmProvider::Ollama => {
            cmd.arg("--ollama-url").arg(&settings.ollama_url);
        }
        crate::settings::LlmProvider::None => {}
    }

    let output = cmd
        .output()
        .map_err(|e| format!("MDX generation failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("MDX generation failed: {}", stderr));
    }

    let mdx_path = session_dir.join("output.mdx");
    if mdx_path.exists() {
        std::fs::read_to_string(&mdx_path).map_err(|e| e.to_string())
    } else {
        Err("MDX file not generated".into())
    }
}
