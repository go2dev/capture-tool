mod recorder;
mod events;
mod session;
mod processing;
mod settings;
mod websocket;

use session::db;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let db_conn = db::initialize().expect("Failed to initialize database");

    let event_state = events::EventState::default();
    let recorder_state = Arc::new(recorder::RecorderState::default());

    // Start the WebSocket server for the browser extension.
    // Both Tauri and the WS server share the same Arc'd state.
    websocket::start_ws_server(
        event_state.clone(),
        Arc::clone(&recorder_state),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(session::SessionState::new(db_conn))
        .manage(recorder_state)
        .manage(event_state)
        .manage(settings::SettingsState::new())
        .invoke_handler(tauri::generate_handler![
            // Session commands
            session::commands::create_session,
            session::commands::get_session,
            session::commands::list_sessions,
            session::commands::delete_session,
            session::commands::set_output_dir,
            // Recorder commands
            recorder::commands::start_recording,
            recorder::commands::stop_recording,
            recorder::commands::get_recording_status,
            // Event commands
            events::commands::add_marker,
            events::commands::get_events,
            // Processing commands
            processing::commands::process_session,
            processing::commands::get_processing_status,
            processing::commands::extract_frames,
            processing::commands::generate_mdx,
            // Settings commands
            settings::get_settings,
            settings::save_settings,
            settings::get_setting,
            settings::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
