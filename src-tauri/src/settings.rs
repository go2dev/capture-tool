use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Supported LLM providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LlmProvider {
    Anthropic,
    Openai,
    Ollama,
    None,
}

impl Default for LlmProvider {
    fn default() -> Self {
        LlmProvider::Anthropic
    }
}

impl LlmProvider {
    pub fn default_model(&self) -> &str {
        match self {
            LlmProvider::Anthropic => "claude-sonnet-4-20250514",
            LlmProvider::Openai => "gpt-4o",
            LlmProvider::Ollama => "llama3",
            LlmProvider::None => "",
        }
    }
}

/// Application settings persisted to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub llm_provider: LlmProvider,

    #[serde(default = "default_llm_model")]
    pub llm_model: String,

    #[serde(default)]
    pub anthropic_api_key: Option<String>,

    #[serde(default)]
    pub openai_api_key: Option<String>,

    #[serde(default = "default_ollama_url")]
    pub ollama_url: String,

    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,

    #[serde(default)]
    pub output_default_dir: Option<String>,

    #[serde(default = "default_recording_framerate")]
    pub recording_framerate: u32,

    #[serde(default = "default_recording_quality")]
    pub recording_quality: String,

    #[serde(default = "default_marker_hotkey")]
    pub marker_hotkey: String,

    #[serde(default)]
    pub auto_redact: bool,
}

fn default_llm_model() -> String {
    "claude-sonnet-4-20250514".into()
}

fn default_ollama_url() -> String {
    "http://localhost:11434".into()
}

fn default_whisper_model() -> String {
    "base".into()
}

fn default_recording_framerate() -> u32 {
    15
}

fn default_recording_quality() -> String {
    "medium".into()
}

fn default_marker_hotkey() -> String {
    "CommandOrControl+Shift+M".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            llm_provider: LlmProvider::default(),
            llm_model: default_llm_model(),
            anthropic_api_key: None,
            openai_api_key: None,
            ollama_url: default_ollama_url(),
            whisper_model: default_whisper_model(),
            output_default_dir: None,
            recording_framerate: default_recording_framerate(),
            recording_quality: default_recording_quality(),
            marker_hotkey: default_marker_hotkey(),
            auto_redact: false,
        }
    }
}

/// Returns the path to `~/.capture-tool/settings.json`.
fn settings_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = home.join(".capture-tool");
    fs::create_dir_all(&dir).ok();
    dir.join("settings.json")
}

impl Settings {
    /// Load settings from disk, falling back to defaults.
    pub fn load() -> Self {
        let path = settings_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<Settings>(&content) {
                    Ok(settings) => {
                        log::info!("Settings loaded from {}", path.display());
                        return settings;
                    }
                    Err(e) => {
                        log::warn!("Failed to parse settings, using defaults: {}", e);
                    }
                },
                Err(e) => {
                    log::warn!("Failed to read settings file, using defaults: {}", e);
                }
            }
        }
        Settings::default()
    }

    /// Persist settings to disk.
    pub fn save(&self) -> Result<(), String> {
        let path = settings_path();
        let json =
            serde_json::to_string_pretty(self).map_err(|e| format!("Serialize error: {}", e))?;
        fs::write(&path, json).map_err(|e| format!("Write error: {}", e))?;
        log::info!("Settings saved to {}", path.display());
        Ok(())
    }
}

/// Thread-safe wrapper managed by Tauri.
pub struct SettingsState {
    pub inner: Mutex<Settings>,
}

impl SettingsState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Settings::load()),
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Result<Settings, String> {
    let settings = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
pub fn save_settings(
    settings: Settings,
    state: State<'_, SettingsState>,
) -> Result<(), String> {
    settings.save()?;
    let mut current = state.inner.lock().map_err(|e| e.to_string())?;
    *current = settings;
    Ok(())
}

#[tauri::command]
pub fn get_setting(key: String, state: State<'_, SettingsState>) -> Result<serde_json::Value, String> {
    let settings = state.inner.lock().map_err(|e| e.to_string())?;
    let full =
        serde_json::to_value(&*settings).map_err(|e| format!("Serialize error: {}", e))?;
    match full.get(&key) {
        Some(val) => Ok(val.clone()),
        None => Err(format!("Unknown setting key: {}", key)),
    }
}

#[tauri::command]
pub fn set_setting(
    key: String,
    value: serde_json::Value,
    state: State<'_, SettingsState>,
) -> Result<(), String> {
    let mut settings = state.inner.lock().map_err(|e| e.to_string())?;

    // Serialize current settings to a JSON map, patch the key, then deserialize back.
    let mut map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_value(serde_json::to_value(&*settings).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

    if !map.contains_key(&key) {
        return Err(format!("Unknown setting key: {}", key));
    }

    map.insert(key, value);

    let updated: Settings =
        serde_json::from_value(serde_json::Value::Object(map)).map_err(|e| e.to_string())?;

    updated.save()?;
    *settings = updated;
    Ok(())
}
