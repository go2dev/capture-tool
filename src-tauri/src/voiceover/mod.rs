pub mod commands;

use std::sync::Mutex;

/// Tracks the state of an active voiceover recording (FFmpeg mic capture).
pub struct VoiceoverState {
    pub ffmpeg_pid: Mutex<Option<u32>>,
    pub recording_session_id: Mutex<Option<String>>,
    pub start_time: Mutex<Option<std::time::Instant>>,
}

impl Default for VoiceoverState {
    fn default() -> Self {
        Self {
            ffmpeg_pid: Mutex::new(None),
            recording_session_id: Mutex::new(None),
            start_time: Mutex::new(None),
        }
    }
}
