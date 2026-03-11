use crate::events::EventState;
use crate::recorder::{RecorderState, RecordingStatus};
use crate::session::models::{CaptureEvent, DomHint, EventType};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use tungstenite::accept;
use tungstenite::Message;

const WS_PORT: u16 = 9876;

// -------------------------------------------------------
// Protocol messages
// -------------------------------------------------------

/// Messages sent from the Tauri backend to the extension.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
enum ServerMessage {
    #[serde(rename = "start_recording")]
    StartRecording { session_id: String },
    #[serde(rename = "stop_recording")]
    StopRecording,
    #[serde(rename = "ping")]
    Ping,
}

/// Messages received from the extension.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
enum ClientMessage {
    #[serde(rename = "dom_event")]
    DomEvent { event: IncomingCaptureEvent },
    #[serde(rename = "hello")]
    Hello { version: String },
    #[serde(rename = "pong")]
    Pong,
}

/// Wire-format capture event from the extension (matches the JSON produced
/// by the browser extension's `CaptureEvent` type).
#[derive(Debug, Clone, Deserialize)]
struct IncomingCaptureEvent {
    t_ms: u64,
    #[serde(rename = "type")]
    event_type: String,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<String>,
    key: Option<String>,
    window_title: Option<String>,
    app_name: Option<String>,
    dom_hint: Option<IncomingDomHint>,
}

#[derive(Debug, Clone, Deserialize)]
struct IncomingDomHint {
    tag: Option<String>,
    text: Option<String>,
    selector: Option<String>,
}

// -------------------------------------------------------
// Shared state for connected extension clients
// -------------------------------------------------------

/// Keeps track of active WebSocket connections so we can broadcast
/// recording signals to them.
#[derive(Clone)]
pub struct WsBroadcast {
    /// Serialised JSON messages queued for each connection thread to pick up.
    outbound: Arc<Mutex<Vec<String>>>,
}

impl WsBroadcast {
    fn new() -> Self {
        Self {
            outbound: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn enqueue(&self, msg: &ServerMessage) {
        if let Ok(json) = serde_json::to_string(msg) {
            if let Ok(mut queue) = self.outbound.lock() {
                queue.push(json);
            }
        }
    }

    fn drain(&self) -> Vec<String> {
        if let Ok(mut queue) = self.outbound.lock() {
            queue.drain(..).collect()
        } else {
            Vec::new()
        }
    }
}

// -------------------------------------------------------
// Recording-state watcher
// -------------------------------------------------------

/// Spawns a background thread that watches the recorder state and sends
/// start/stop messages to connected extensions when transitions occur.
fn spawn_recording_watcher(
    recorder: Arc<RecorderState>,
    broadcast: WsBroadcast,
) {
    thread::spawn(move || {
        let mut prev_recording = false;

        loop {
            thread::sleep(std::time::Duration::from_millis(250));

            let currently_recording = recorder
                .status
                .lock()
                .map(|s| *s == RecordingStatus::Recording)
                .unwrap_or(false);

            if currently_recording && !prev_recording {
                let session_id = recorder
                    .current_session_id
                    .lock()
                    .ok()
                    .and_then(|s| s.clone())
                    .unwrap_or_default();
                info!("[ws] Recording started — notifying extensions (session {})", session_id);
                broadcast.enqueue(&ServerMessage::StartRecording { session_id });
            } else if !currently_recording && prev_recording {
                info!("[ws] Recording stopped — notifying extensions");
                broadcast.enqueue(&ServerMessage::StopRecording);
            }

            prev_recording = currently_recording;
        }
    });
}

// -------------------------------------------------------
// Per-connection handler
// -------------------------------------------------------

fn handle_connection(
    stream: std::net::TcpStream,
    event_state: EventState,
    broadcast: WsBroadcast,
) {
    let peer = stream
        .peer_addr()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "unknown".into());

    let mut websocket = match accept(stream) {
        Ok(ws) => ws,
        Err(e) => {
            warn!("[ws] Failed to accept connection from {}: {}", peer, e);
            return;
        }
    };

    info!("[ws] Extension connected from {}", peer);

    // Set socket to non-blocking so we can check outbound messages
    if let Err(e) = websocket.get_ref().set_nonblocking(true) {
        warn!("[ws] Could not set non-blocking: {}", e);
    }

    loop {
        // 1. Check for inbound messages from the extension
        match websocket.read() {
            Ok(msg) => match msg {
                Message::Text(text) => {
                    handle_client_text(&text, &event_state);
                }
                Message::Close(_) => {
                    info!("[ws] Extension {} disconnected", peer);
                    break;
                }
                Message::Ping(data) => {
                    let _ = websocket.send(Message::Pong(data));
                }
                _ => {}
            },
            Err(tungstenite::Error::Io(ref e))
                if e.kind() == std::io::ErrorKind::WouldBlock =>
            {
                // No data available yet, that's fine
            }
            Err(e) => {
                warn!("[ws] Read error from {}: {}", peer, e);
                break;
            }
        }

        // 2. Flush any outbound messages
        for json in broadcast.drain() {
            if let Err(e) = websocket.send(Message::Text(json.into())) {
                warn!("[ws] Write error to {}: {}", peer, e);
                break;
            }
        }

        // Avoid busy-looping
        thread::sleep(std::time::Duration::from_millis(50));
    }

    let _ = websocket.close(None);
}

fn handle_client_text(text: &str, event_state: &EventState) {
    let msg: ClientMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            warn!("[ws] Malformed message from extension: {}", e);
            return;
        }
    };

    match msg {
        ClientMessage::DomEvent { event } => {
            merge_dom_event(event, event_state);
        }
        ClientMessage::Hello { version } => {
            info!("[ws] Extension hello — version {}", version);
        }
        ClientMessage::Pong => {}
    }
}

// -------------------------------------------------------
// Merge a DOM event from the extension into the event stream
// -------------------------------------------------------

fn merge_dom_event(incoming: IncomingCaptureEvent, event_state: &EventState) {
    let is_capturing = event_state
        .capturing
        .lock()
        .map(|c| *c)
        .unwrap_or(false);

    if !is_capturing {
        return; // Ignore events when not recording
    }

    let event_type = match incoming.event_type.as_str() {
        "click" => EventType::Click,
        "key_press" => EventType::KeyPress,
        "key_release" => EventType::KeyRelease,
        "scroll" => EventType::Scroll,
        "move" => EventType::Move,
        "window_change" => EventType::WindowChange,
        "marker" => EventType::Marker,
        _ => {
            warn!("[ws] Unknown event type: {}", incoming.event_type);
            return;
        }
    };

    let dom_hint = incoming.dom_hint.map(|dh| DomHint {
        tag: dh.tag,
        text: dh.text,
        selector: dh.selector,
    });

    let is_click = event_type == EventType::Click;
    let t_ms = incoming.t_ms;
    let window_title = incoming.window_title.clone();

    let capture_event = CaptureEvent {
        t_ms,
        event_type,
        x: incoming.x,
        y: incoming.y,
        button: incoming.button,
        key: incoming.key,
        window_title: incoming.window_title,
        app_name: incoming.app_name,
        dom_hint: dom_hint.clone(),
    };

    // Merge into the shared event list. We try to insert the DOM-hint
    // event close to the matching rdev click event (by t_ms) so the
    // event stream stays chronologically sorted. A simple approach:
    // find the last event whose t_ms is <= incoming.t_ms and, if it is
    // a click without a dom_hint, attach the hint to it. Otherwise
    // push a new event.
    if let Ok(mut events) = event_state.events.lock() {
        let merged = if is_click {
            // Try to attach dom_hint to a nearby rdev click (within 500 ms)
            let mut found = false;
            for evt in events.iter_mut().rev() {
                if matches!(evt.event_type, EventType::Click)
                    && evt.dom_hint.is_none()
                    && evt.t_ms.abs_diff(t_ms) < 500
                {
                    evt.dom_hint.clone_from(&dom_hint);
                    // Also fill in window_title from the extension if rdev didn't have it
                    if evt.window_title.is_none() {
                        evt.window_title.clone_from(&window_title);
                    }
                    found = true;
                    break;
                }
            }
            found
        } else {
            false
        };

        if !merged {
            events.push(capture_event);
        }
    }
}

// -------------------------------------------------------
// Public entry point — called from lib.rs
// -------------------------------------------------------

/// Starts the WebSocket server on a background thread.
///
/// This should be called once during app initialisation. The server
/// listens on `ws://localhost:9876` and accepts connections from the
/// Capture Tool browser extension.
pub fn start_ws_server(
    event_state: EventState,
    recorder: Arc<RecorderState>,
) {
    let broadcast = WsBroadcast::new();
    let broadcast_watcher = broadcast.clone();

    // Spawn the recording-state watcher
    spawn_recording_watcher(recorder, broadcast_watcher);

    thread::spawn(move || {
        let listener = match TcpListener::bind(format!("127.0.0.1:{}", WS_PORT)) {
            Ok(l) => {
                info!("[ws] WebSocket server listening on ws://localhost:{}", WS_PORT);
                l
            }
            Err(e) => {
                error!("[ws] Failed to bind to port {}: {}", WS_PORT, e);
                return;
            }
        };

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let es = event_state.clone();
                    let bc = broadcast.clone();
                    thread::spawn(move || {
                        handle_connection(stream, es, bc);
                    });
                }
                Err(e) => {
                    error!("[ws] Accept error: {}", e);
                }
            }
        }
    });
}
