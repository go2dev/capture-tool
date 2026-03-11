pub mod commands;

use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingStatus {
    Idle,
    Recording,
    Stopping,
    Error,
}

pub struct RecorderState {
    pub status: Mutex<RecordingStatus>,
    pub ffmpeg_pid: Mutex<Option<u32>>,
    pub current_session_id: Mutex<Option<String>>,
    pub start_time: Mutex<Option<std::time::Instant>>,
}

impl Default for RecorderState {
    fn default() -> Self {
        Self {
            status: Mutex::new(RecordingStatus::Idle),
            ffmpeg_pid: Mutex::new(None),
            current_session_id: Mutex::new(None),
            start_time: Mutex::new(None),
        }
    }
}
