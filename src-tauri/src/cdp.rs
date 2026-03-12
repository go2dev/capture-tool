use crate::events::EventState;
use crate::session::db::get_sessions_dir;
use crate::session::models::{CaptureEvent, DomHint, EventType};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};

// -------------------------------------------------------
// Helper to access the inner TcpStream from MaybeTlsStream
// -------------------------------------------------------

fn get_inner_tcp(stream: &MaybeTlsStream<TcpStream>) -> Option<&TcpStream> {
    match stream {
        MaybeTlsStream::Plain(s) => Some(s),
        // Other variants (NativeTls, Rustls) only exist behind feature flags.
        // CDP always uses plain ws:// so this covers our use case.
        #[allow(unreachable_patterns)]
        _ => None,
    }
}

fn set_socket_nonblocking(ws: &WebSocket<MaybeTlsStream<TcpStream>>, nonblocking: bool) {
    if let Some(tcp) = get_inner_tcp(ws.get_ref()) {
        let _ = tcp.set_nonblocking(nonblocking);
    }
}

fn set_socket_read_timeout(
    ws: &WebSocket<MaybeTlsStream<TcpStream>>,
    timeout: Option<std::time::Duration>,
) {
    if let Some(tcp) = get_inner_tcp(ws.get_ref()) {
        let _ = tcp.set_read_timeout(timeout);
    }
}

// -------------------------------------------------------
// CDP HTTP types (from /json/version and /json endpoints)
// -------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpVersionInfo {
    pub browser: Option<String>,
    #[serde(rename = "Protocol-Version")]
    pub protocol_version: Option<String>,
    #[serde(rename = "User-Agent")]
    pub user_agent: Option<String>,
    #[serde(rename = "V8-Version")]
    pub v8_version: Option<String>,
    #[serde(rename = "WebKit-Version")]
    pub webkit_version: Option<String>,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub web_socket_debugger_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpTabInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub tab_type: String,
    pub title: String,
    pub url: String,
    pub web_socket_debugger_url: Option<String>,
    pub dev_tools_frontend_url: Option<String>,
}

// -------------------------------------------------------
// CDP status returned to the frontend
// -------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpStatus {
    pub available: bool,
    pub browser: Option<String>,
    pub connected_tab: Option<CdpTabSummary>,
    pub event_count: u64,
    pub capturing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpTabSummary {
    pub id: String,
    pub title: String,
    pub url: String,
}

// -------------------------------------------------------
// CDP JSON-RPC message types
// -------------------------------------------------------

#[derive(Debug, Serialize)]
struct CdpRequest {
    id: u64,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct CdpResponse {
    id: Option<u64>,
    #[allow(dead_code)]
    method: Option<String>,
    #[allow(dead_code)]
    params: Option<serde_json::Value>,
    result: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
}

// -------------------------------------------------------
// CDP shared state managed by Tauri
// -------------------------------------------------------

pub struct CdpState {
    /// The WebSocket connection to the CDP target (browser tab).
    /// Used for on-demand operations like screenshots.
    ws: Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>,
    /// Next JSON-RPC request id
    next_id: AtomicU64,
    /// Whether we are actively capturing events via CDP
    capturing: AtomicBool,
    /// Number of CDP events captured in the current session
    event_count: AtomicU64,
    /// Info about the connected tab
    connected_tab: Mutex<Option<CdpTabSummary>>,
    /// PID of the Chrome process we launched (if any)
    chrome_pid: Mutex<Option<u32>>,
    /// Session id for the current capture
    session_id: Mutex<Option<String>>,
    /// Signal flag for the capture background thread
    capture_thread_running: Arc<AtomicBool>,
}

impl Default for CdpState {
    fn default() -> Self {
        Self {
            ws: Mutex::new(None),
            next_id: AtomicU64::new(1),
            capturing: AtomicBool::new(false),
            event_count: AtomicU64::new(0),
            connected_tab: Mutex::new(None),
            chrome_pid: Mutex::new(None),
            session_id: Mutex::new(None),
            capture_thread_running: Arc::new(AtomicBool::new(false)),
        }
    }
}

// -------------------------------------------------------
// CDP HTTP helpers
// -------------------------------------------------------

const CDP_PORT: u16 = 9222;

/// Check if Chrome is running with remote debugging by hitting /json/version.
fn find_chrome_debugger() -> Option<CdpVersionInfo> {
    let url = format!("http://localhost:{}/json/version", CDP_PORT);
    let mut resp = ureq::get(&url).call().ok()?;
    let body = resp.body_mut().read_to_string().ok()?;
    serde_json::from_str(&body).ok()
}

/// List all open tabs/targets via the CDP HTTP endpoint.
fn list_tabs() -> Result<Vec<CdpTabInfo>, String> {
    let url = format!("http://localhost:{}/json", CDP_PORT);
    let mut resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("Failed to list CDP tabs: {}", e))?;
    let body = resp
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("Failed to read CDP tab list: {}", e))?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse CDP tab list: {}", e))
}

/// Detect the Chrome/Edge executable path on the current platform.
fn find_chrome_path() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
        for p in &paths {
            if std::path::Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ];
        for p in &paths {
            if std::path::Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let paths = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
        ];
        for p in &paths {
            if std::path::Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
    }

    None
}

/// Launch Chrome/Edge with `--remote-debugging-port=9222`.
fn launch_chrome_with_cdp(url: Option<String>) -> Result<Child, String> {
    let chrome_path =
        find_chrome_path().ok_or_else(|| "Chrome/Edge not found on this system".to_string())?;

    let mut args = vec![
        format!("--remote-debugging-port={}", CDP_PORT),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
    ];
    if let Some(target_url) = url {
        args.push(target_url);
    }

    info!("[cdp] Launching browser: {} {:?}", chrome_path, args);

    Command::new(&chrome_path)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch Chrome: {}", e))
}

// -------------------------------------------------------
// CDP WebSocket helpers
// -------------------------------------------------------

fn connect_to_tab(
    tab: &CdpTabInfo,
) -> Result<WebSocket<MaybeTlsStream<TcpStream>>, String> {
    let ws_url = tab
        .web_socket_debugger_url
        .as_ref()
        .ok_or_else(|| "Tab has no WebSocket debugger URL".to_string())?;

    info!("[cdp] Connecting to tab: {} ({})", tab.title, ws_url);

    let (ws, _response) =
        connect(ws_url).map_err(|e| format!("WebSocket connect failed: {}", e))?;

    Ok(ws)
}

/// Send a CDP JSON-RPC command and return the result.
fn send_cdp_command(
    ws: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let req = CdpRequest {
        id,
        method: method.to_string(),
        params,
    };
    let json = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    ws.send(Message::Text(json.into()))
        .map_err(|e| format!("CDP send failed: {}", e))?;

    // Read messages until we get a response matching our request id
    loop {
        let msg = ws
            .read()
            .map_err(|e| format!("CDP read failed: {}", e))?;
        match msg {
            Message::Text(text) => {
                let resp: CdpResponse = serde_json::from_str(&text)
                    .map_err(|e| format!("CDP parse failed: {}", e))?;
                if resp.id == Some(id) {
                    if let Some(err) = resp.error {
                        return Err(format!("CDP error: {}", err));
                    }
                    return Ok(resp.result.unwrap_or(serde_json::Value::Null));
                }
                // Otherwise it is an asynchronous event; skip during sync command
            }
            Message::Ping(data) => {
                let _ = ws.send(Message::Pong(data));
            }
            Message::Close(_) => {
                return Err("CDP WebSocket closed unexpectedly".to_string());
            }
            _ => {}
        }
    }
}

/// Enable the CDP domains we need: Page, DOM, Runtime, Network.
fn enable_dom_capture(
    ws: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: &AtomicU64,
) -> Result<(), String> {
    let domains = [
        "Page.enable",
        "DOM.enable",
        "Runtime.enable",
        "Network.enable",
    ];
    for domain in &domains {
        let id = next_id.fetch_add(1, Ordering::SeqCst);
        send_cdp_command(ws, id, domain, serde_json::json!({}))?;
        info!("[cdp] Enabled {}", domain);
    }
    Ok(())
}

/// Inject a click listener into the page that stores click data for polling.
fn inject_click_listener(
    ws: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: &AtomicU64,
) -> Result<(), String> {
    let script = r#"
        (function() {
            if (window.__captureToolClickListener) return;
            window.__captureToolClickListener = true;
            window.__captureToolLastClick = null;
            document.addEventListener('click', function(e) {
                var el = e.target;
                var tag = el.tagName ? el.tagName.toLowerCase() : '';
                var text = (el.textContent || '').trim().substring(0, 200);
                var selector = '';
                try {
                    if (el.id) {
                        selector = '#' + el.id;
                    } else {
                        var parts = [];
                        var current = el;
                        for (var i = 0; i < 5 && current && current !== document.body; i++) {
                            var part = current.tagName.toLowerCase();
                            if (current.id) {
                                part = '#' + current.id;
                                parts.unshift(part);
                                break;
                            }
                            if (current.className && typeof current.className === 'string') {
                                var cls = current.className.trim().split(/\s+/).slice(0, 2).join('.');
                                if (cls) part += '.' + cls;
                            }
                            parts.unshift(part);
                            current = current.parentElement;
                        }
                        selector = parts.join(' > ');
                    }
                } catch(ex) {}

                var attrs = {};
                try {
                    var attrNames = ['href','type','role','aria-label','name','placeholder','value','data-testid'];
                    for (var j = 0; j < attrNames.length; j++) {
                        var val = el.getAttribute(attrNames[j]);
                        if (val) attrs[attrNames[j]] = val.substring(0, 200);
                    }
                } catch(ex) {}

                window.__captureToolLastClick = {
                    t: Date.now(),
                    tag: tag,
                    text: text,
                    selector: selector,
                    x: e.clientX,
                    y: e.clientY,
                    url: location.href,
                    title: document.title,
                    attrs: attrs
                };
            }, true);
        })();
    "#;

    let id = next_id.fetch_add(1, Ordering::SeqCst);
    send_cdp_command(
        ws,
        id,
        "Runtime.evaluate",
        serde_json::json!({
            "expression": script,
            "awaitPromise": false,
        }),
    )?;
    Ok(())
}

/// Poll for the latest click info from the injected listener.
fn poll_last_click(
    ws: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: &AtomicU64,
) -> Result<Option<serde_json::Value>, String> {
    let script = r#"
        (function() {
            var click = window.__captureToolLastClick;
            window.__captureToolLastClick = null;
            return click ? JSON.stringify(click) : null;
        })()
    "#;

    let id = next_id.fetch_add(1, Ordering::SeqCst);
    let result = send_cdp_command(
        ws,
        id,
        "Runtime.evaluate",
        serde_json::json!({
            "expression": script,
            "returnByValue": true,
        }),
    )?;

    if let Some(value) = result.get("result").and_then(|r| r.get("value")) {
        if let Some(json_str) = value.as_str() {
            let parsed: serde_json::Value =
                serde_json::from_str(json_str).map_err(|e| e.to_string())?;
            return Ok(Some(parsed));
        }
    }
    Ok(None)
}

/// Get the current page URL and title via Runtime.evaluate.
fn get_page_info(
    ws: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: &AtomicU64,
) -> Result<(String, String), String> {
    let script = r#"JSON.stringify({url: location.href, title: document.title})"#;
    let id = next_id.fetch_add(1, Ordering::SeqCst);
    let result = send_cdp_command(
        ws,
        id,
        "Runtime.evaluate",
        serde_json::json!({
            "expression": script,
            "returnByValue": true,
        }),
    )?;

    if let Some(json_str) = result
        .get("result")
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_str())
    {
        let parsed: serde_json::Value =
            serde_json::from_str(json_str).map_err(|e| e.to_string())?;
        let url = parsed
            .get("url")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string();
        let title = parsed
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        return Ok((url, title));
    }
    Ok(("".to_string(), "".to_string()))
}

/// Take a CDP screenshot. Returns raw PNG bytes.
fn take_screenshot_cdp(
    ws: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: &AtomicU64,
    selector: Option<&str>,
) -> Result<Vec<u8>, String> {
    let params = if let Some(sel) = selector {
        // Get the bounding box of the target element
        let script = format!(
            r#"
            (function() {{
                var el = document.querySelector({});
                if (!el) return null;
                var rect = el.getBoundingClientRect();
                return JSON.stringify({{x: rect.x, y: rect.y, width: rect.width, height: rect.height}});
            }})()
            "#,
            serde_json::to_string(sel).unwrap_or_else(|_| "\"\"".to_string())
        );
        let id = next_id.fetch_add(1, Ordering::SeqCst);
        let result = send_cdp_command(
            ws,
            id,
            "Runtime.evaluate",
            serde_json::json!({
                "expression": script,
                "returnByValue": true,
            }),
        )?;

        if let Some(json_str) = result
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
        {
            let clip: serde_json::Value =
                serde_json::from_str(json_str).map_err(|e| e.to_string())?;
            serde_json::json!({
                "format": "png",
                "clip": {
                    "x": clip["x"],
                    "y": clip["y"],
                    "width": clip["width"],
                    "height": clip["height"],
                    "scale": 1
                }
            })
        } else {
            serde_json::json!({"format": "png"})
        }
    } else {
        serde_json::json!({"format": "png"})
    };

    let id = next_id.fetch_add(1, Ordering::SeqCst);
    let result = send_cdp_command(ws, id, "Page.captureScreenshot", params)?;

    let data_b64 = result
        .get("data")
        .and_then(|d| d.as_str())
        .ok_or_else(|| "No screenshot data in CDP response".to_string())?;

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("Failed to decode screenshot base64: {}", e))?;

    Ok(bytes)
}

// -------------------------------------------------------
// Capture loop - runs on a background thread
// -------------------------------------------------------

fn run_capture_loop(
    ws_url: String,
    event_state: EventState,
    next_id: Arc<AtomicU64>,
    cdp_state: Arc<CdpState>,
    running: Arc<AtomicBool>,
) {
    info!("[cdp] Starting capture loop on {}", ws_url);

    let (mut ws, _) = match connect(&ws_url) {
        Ok(pair) => pair,
        Err(e) => {
            error!("[cdp] Capture loop connect failed: {}", e);
            running.store(false, Ordering::SeqCst);
            cdp_state.capturing.store(false, Ordering::SeqCst);
            return;
        }
    };

    // Enable domains on this dedicated capture connection
    if let Err(e) = enable_dom_capture(&mut ws, &next_id) {
        error!("[cdp] Failed to enable domains in capture loop: {}", e);
        running.store(false, Ordering::SeqCst);
        cdp_state.capturing.store(false, Ordering::SeqCst);
        return;
    }

    // Inject the click listener
    if let Err(e) = inject_click_listener(&mut ws, &next_id) {
        warn!("[cdp] Failed to inject click listener: {}", e);
    }

    let mut last_url = String::new();

    while running.load(Ordering::SeqCst) {
        let is_capturing = event_state
            .capturing
            .lock()
            .map(|c| *c)
            .unwrap_or(false);

        if !is_capturing {
            std::thread::sleep(std::time::Duration::from_millis(200));
            continue;
        }

        let t_ms = event_state
            .start_time
            .lock()
            .ok()
            .and_then(|s| s.map(|inst| inst.elapsed().as_millis() as u64))
            .unwrap_or(0);

        // Use blocking socket with a timeout for the polling commands
        set_socket_nonblocking(&ws, false);
        set_socket_read_timeout(&ws, Some(std::time::Duration::from_millis(500)));

        // Re-inject click listener (handles page navigations that wipe it)
        let _ = inject_click_listener(&mut ws, &next_id);

        // Poll for click events
        match poll_last_click(&mut ws, &next_id) {
            Ok(Some(click_data)) => {
                let tag = click_data
                    .get("tag")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());
                let text = click_data
                    .get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());
                let selector = click_data
                    .get("selector")
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string());
                let x = click_data.get("x").and_then(|v| v.as_f64());
                let y = click_data.get("y").and_then(|v| v.as_f64());
                let title = click_data
                    .get("title")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();

                let dom_hint = Some(DomHint {
                    tag,
                    text,
                    selector,
                });

                let evt = CaptureEvent {
                    t_ms,
                    event_type: EventType::Click,
                    x,
                    y,
                    button: Some("left".to_string()),
                    key: None,
                    window_title: Some(title),
                    app_name: Some("Chrome".to_string()),
                    dom_hint: dom_hint.clone(),
                };

                // Try to merge dom_hint onto a nearby rdev click event
                if let Ok(mut events) = event_state.events.lock() {
                    let mut merged = false;
                    for existing in events.iter_mut().rev() {
                        if matches!(existing.event_type, EventType::Click)
                            && existing.dom_hint.is_none()
                            && existing.t_ms.abs_diff(t_ms) < 500
                        {
                            existing.dom_hint.clone_from(&dom_hint);
                            merged = true;
                            break;
                        }
                    }
                    if !merged {
                        events.push(evt);
                    }
                }

                cdp_state.event_count.fetch_add(1, Ordering::SeqCst);
            }
            Ok(None) => {}
            Err(e) => {
                warn!("[cdp] poll_last_click error: {}", e);
            }
        }

        // Detect page navigation
        match get_page_info(&mut ws, &next_id) {
            Ok((url, title)) => {
                if !url.is_empty() && url != last_url {
                    info!("[cdp] Navigation: {} -> {}", last_url, url);

                    let evt = CaptureEvent {
                        t_ms,
                        event_type: EventType::WindowChange,
                        x: None,
                        y: None,
                        button: None,
                        key: None,
                        window_title: Some(title),
                        app_name: Some("Chrome".to_string()),
                        dom_hint: None,
                    };

                    if let Ok(mut events) = event_state.events.lock() {
                        events.push(evt);
                    }
                    cdp_state.event_count.fetch_add(1, Ordering::SeqCst);
                    last_url = url;
                }
            }
            Err(e) => {
                warn!("[cdp] get_page_info error: {}", e);
            }
        }

        set_socket_nonblocking(&ws, true);
        std::thread::sleep(std::time::Duration::from_millis(250));
    }

    info!("[cdp] Capture loop stopped");
    cdp_state.capturing.store(false, Ordering::SeqCst);
    let _ = ws.close(None);
}

// -------------------------------------------------------
// Tauri commands
// -------------------------------------------------------

#[tauri::command]
pub fn cdp_check_status(cdp_state: tauri::State<Arc<CdpState>>) -> Result<CdpStatus, String> {
    let version_info = find_chrome_debugger();
    let available = version_info.is_some();
    let browser = version_info.and_then(|v| v.browser);

    let connected_tab = cdp_state
        .connected_tab
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let event_count = cdp_state.event_count.load(Ordering::SeqCst);
    let capturing = cdp_state.capturing.load(Ordering::SeqCst);

    Ok(CdpStatus {
        available,
        browser,
        connected_tab,
        event_count,
        capturing,
    })
}

#[tauri::command]
pub fn cdp_launch_browser(
    url: Option<String>,
    cdp_state: tauri::State<Arc<CdpState>>,
) -> Result<(), String> {
    // Check if already available
    if find_chrome_debugger().is_some() {
        info!("[cdp] Chrome already running with CDP");
        return Ok(());
    }

    let child = launch_chrome_with_cdp(url)?;
    let pid = child.id();
    info!("[cdp] Chrome launched with PID {}", pid);

    *cdp_state.chrome_pid.lock().map_err(|e| e.to_string())? = Some(pid);

    // Wait for Chrome to start and open the debugging port
    std::thread::sleep(std::time::Duration::from_secs(2));

    let mut attempts = 0;
    while attempts < 10 {
        if find_chrome_debugger().is_some() {
            info!("[cdp] Chrome CDP endpoint is now available");
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        attempts += 1;
    }

    Err(
        "Chrome launched but CDP endpoint did not become available within 5 seconds".to_string(),
    )
}

#[tauri::command]
pub fn cdp_connect_tab(
    tab_id: Option<String>,
    cdp_state: tauri::State<Arc<CdpState>>,
) -> Result<CdpTabSummary, String> {
    let tabs = list_tabs()?;

    let tab = if let Some(ref id) = tab_id {
        tabs.iter()
            .find(|t| t.id == *id)
            .ok_or_else(|| format!("Tab with id {} not found", id))?
    } else {
        tabs.iter()
            .find(|t| t.tab_type == "page")
            .ok_or_else(|| "No page tabs found".to_string())?
    };

    let ws = connect_to_tab(tab)?;

    let summary = CdpTabSummary {
        id: tab.id.clone(),
        title: tab.title.clone(),
        url: tab.url.clone(),
    };

    *cdp_state.ws.lock().map_err(|e| e.to_string())? = Some(ws);
    *cdp_state
        .connected_tab
        .lock()
        .map_err(|e| e.to_string())? = Some(summary.clone());

    info!(
        "[cdp] Connected to tab: {} ({})",
        summary.title, summary.url
    );

    // Enable domains on the main (screenshot) connection
    {
        let mut ws_guard = cdp_state.ws.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut ws) = *ws_guard {
            enable_dom_capture(ws, &cdp_state.next_id)?;
        }
    }

    Ok(summary)
}

#[tauri::command]
pub fn cdp_list_tabs(
    _cdp_state: tauri::State<Arc<CdpState>>,
) -> Result<Vec<CdpTabSummary>, String> {
    let tabs = list_tabs()?;
    Ok(tabs
        .into_iter()
        .filter(|t| t.tab_type == "page")
        .map(|t| CdpTabSummary {
            id: t.id,
            title: t.title,
            url: t.url,
        })
        .collect())
}

#[tauri::command]
pub fn cdp_start_capture(
    session_id: String,
    cdp_state: tauri::State<Arc<CdpState>>,
    event_state: tauri::State<EventState>,
) -> Result<(), String> {
    if cdp_state.capturing.load(Ordering::SeqCst) {
        return Err("CDP capture already running".to_string());
    }

    let tab = cdp_state
        .connected_tab
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No tab connected. Call cdp_connect_tab first.".to_string())?;

    // Get the full WS debugger URL from the tab list
    let tabs = list_tabs()?;
    let ws_url = tabs
        .iter()
        .find(|t| t.id == tab.id)
        .and_then(|t| t.web_socket_debugger_url.clone())
        .ok_or_else(|| "Could not find WebSocket URL for connected tab".to_string())?;

    *cdp_state.session_id.lock().map_err(|e| e.to_string())? = Some(session_id);

    cdp_state.event_count.store(0, Ordering::SeqCst);
    cdp_state.capturing.store(true, Ordering::SeqCst);
    cdp_state
        .capture_thread_running
        .store(true, Ordering::SeqCst);

    let running = cdp_state.capture_thread_running.clone();
    let evt_state = event_state.inner().clone();
    // Use a separate id space for the capture thread to avoid collisions
    let next_id = Arc::new(AtomicU64::new(1000));
    let cdp_state_inner: Arc<CdpState> = cdp_state.inner().clone();

    std::thread::spawn(move || {
        run_capture_loop(ws_url, evt_state, next_id, cdp_state_inner, running);
    });

    info!("[cdp] Capture started");
    Ok(())
}

#[tauri::command]
pub fn cdp_stop_capture(cdp_state: tauri::State<Arc<CdpState>>) -> Result<u64, String> {
    if !cdp_state.capturing.load(Ordering::SeqCst) {
        return Err("CDP capture not running".to_string());
    }

    cdp_state
        .capture_thread_running
        .store(false, Ordering::SeqCst);
    cdp_state.capturing.store(false, Ordering::SeqCst);

    let count = cdp_state.event_count.load(Ordering::SeqCst);
    info!("[cdp] Capture stopped. {} events captured.", count);

    Ok(count)
}

#[tauri::command]
pub fn cdp_take_screenshot(
    session_id: String,
    step_index: u32,
    selector: Option<String>,
    cdp_state: tauri::State<Arc<CdpState>>,
) -> Result<String, String> {
    let mut ws_guard = cdp_state.ws.lock().map_err(|e| e.to_string())?;
    let ws = ws_guard
        .as_mut()
        .ok_or_else(|| "No CDP connection. Connect to a tab first.".to_string())?;

    let png_data = take_screenshot_cdp(ws, &cdp_state.next_id, selector.as_deref())?;

    // Save to session assets directory
    let session_dir = get_sessions_dir().join(&session_id);
    let assets_dir = session_dir.join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

    let filename = format!("step-{:02}-cdp.png", step_index);
    let output_path = assets_dir.join(&filename);
    std::fs::write(&output_path, &png_data).map_err(|e| e.to_string())?;

    let path_str = output_path.to_string_lossy().to_string();
    info!("[cdp] Screenshot saved: {}", path_str);

    Ok(path_str)
}
