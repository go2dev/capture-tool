use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: String,
    pub title: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub source_mode: SourceMode,
    pub video_path: Option<String>,
    pub audio_path: Option<String>,
    pub event_log_path: Option<String>,
    pub transcript_path: Option<String>,
    pub output_dir: Option<String>,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceMode {
    ScreenOnly,
    ScreenBrowser,
    ScreenAccessibility,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Created,
    Recording,
    Recorded,
    Processing,
    Processed,
    Reviewed,
    Exported,
    Error,
}

impl std::fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Created => write!(f, "created"),
            Self::Recording => write!(f, "recording"),
            Self::Recorded => write!(f, "recorded"),
            Self::Processing => write!(f, "processing"),
            Self::Processed => write!(f, "processed"),
            Self::Reviewed => write!(f, "reviewed"),
            Self::Exported => write!(f, "exported"),
            Self::Error => write!(f, "error"),
        }
    }
}

impl std::str::FromStr for SessionStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "created" => Ok(Self::Created),
            "recording" => Ok(Self::Recording),
            "recorded" => Ok(Self::Recorded),
            "processing" => Ok(Self::Processing),
            "processed" => Ok(Self::Processed),
            "reviewed" => Ok(Self::Reviewed),
            "exported" => Ok(Self::Exported),
            "error" => Ok(Self::Error),
            _ => Err(format!("Unknown status: {}", s)),
        }
    }
}

impl std::fmt::Display for SourceMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ScreenOnly => write!(f, "screen_only"),
            Self::ScreenBrowser => write!(f, "screen_browser"),
            Self::ScreenAccessibility => write!(f, "screen_accessibility"),
        }
    }
}

impl std::str::FromStr for SourceMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "screen_only" => Ok(Self::ScreenOnly),
            "screen_browser" => Ok(Self::ScreenBrowser),
            "screen_accessibility" => Ok(Self::ScreenAccessibility),
            _ => Err(format!("Unknown source mode: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureEvent {
    pub t_ms: u64,
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub button: Option<String>,
    pub key: Option<String>,
    pub window_title: Option<String>,
    pub app_name: Option<String>,
    pub dom_hint: Option<DomHint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    Click,
    KeyPress,
    KeyRelease,
    Scroll,
    Move,
    WindowChange,
    Marker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomHint {
    pub tag: Option<String>,
    pub text: Option<String>,
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub step_id: String,
    pub t_start_ms: u64,
    pub t_end_ms: u64,
    pub title: String,
    pub instruction: String,
    pub screenshot: Option<String>,
    pub gif: Option<String>,
    pub confidence: f64,
    pub review_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSpec {
    pub doc_path: String,
    pub assets_dir: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionManifest {
    pub session: Session,
    pub steps: Vec<Step>,
    pub export: Option<ExportSpec>,
}
