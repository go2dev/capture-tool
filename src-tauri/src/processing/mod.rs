pub mod commands;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessingStage {
    Idle,
    ExtractingAudio,
    Transcribing,
    NormalizingEvents,
    SegmentingSteps,
    ExtractingFrames,
    GeneratingGifs,
    WritingDoc,
    Complete,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingProgress {
    pub stage: ProcessingStage,
    pub progress: f64,
    pub message: String,
}
