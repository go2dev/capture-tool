pub mod commands;

use crate::session::models::{CaptureEvent, EventType};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct EventState {
    pub events: Arc<Mutex<Vec<CaptureEvent>>>,
    pub capturing: Arc<Mutex<bool>>,
    pub session_id: Arc<Mutex<Option<String>>>,
    pub start_time: Arc<Mutex<Option<std::time::Instant>>>,
}

impl Default for EventState {
    fn default() -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
            capturing: Arc::new(Mutex::new(false)),
            session_id: Arc::new(Mutex::new(None)),
            start_time: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn start_event_listener(state: EventState) {
    let events = state.events.clone();
    let capturing = state.capturing.clone();

    // Set start time
    {
        let mut start = state.start_time.lock().unwrap();
        *start = Some(std::time::Instant::now());
    }

    let start_time_ref = state.start_time.clone();

    std::thread::spawn(move || {
        // Track last known mouse position
        let last_x: Arc<Mutex<f64>> = Arc::new(Mutex::new(0.0));
        let last_y: Arc<Mutex<f64>> = Arc::new(Mutex::new(0.0));

        let lx = last_x.clone();
        let ly = last_y.clone();

        let callback = move |event: rdev::Event| {
            let is_capturing = capturing.lock().map(|c| *c).unwrap_or(false);
            if !is_capturing {
                // Still track mouse position even when not capturing
                if let rdev::EventType::MouseMove { x, y } = event.event_type {
                    if let Ok(mut mx) = lx.lock() { *mx = x; }
                    if let Ok(mut my) = ly.lock() { *my = y; }
                }
                return;
            }

            let start = start_time_ref.lock().unwrap();
            let t_ms = start.map(|s| s.elapsed().as_millis() as u64).unwrap_or(0);
            drop(start);

            let capture_event = match event.event_type {
                rdev::EventType::MouseMove { x, y } => {
                    if let Ok(mut mx) = lx.lock() { *mx = x; }
                    if let Ok(mut my) = ly.lock() { *my = y; }
                    None // Don't log every mouse move
                }
                rdev::EventType::ButtonPress(button) => {
                    let btn_str = match button {
                        rdev::Button::Left => "left",
                        rdev::Button::Right => "right",
                        rdev::Button::Middle => "middle",
                        _ => "other",
                    };
                    let mx = lx.lock().map(|x| *x).unwrap_or(0.0);
                    let my = ly.lock().map(|y| *y).unwrap_or(0.0);
                    // Get active window info
                    let (window_title, app_name) = get_active_window_info();
                    Some(CaptureEvent {
                        t_ms,
                        event_type: EventType::Click,
                        x: Some(mx),
                        y: Some(my),
                        button: Some(btn_str.to_string()),
                        key: None,
                        window_title,
                        app_name,
                        dom_hint: None,
                    })
                }
                rdev::EventType::KeyPress(key) => {
                    let key_str = format!("{:?}", key);
                    Some(CaptureEvent {
                        t_ms,
                        event_type: EventType::KeyPress,
                        x: None,
                        y: None,
                        button: None,
                        key: Some(key_str),
                        window_title: None,
                        app_name: None,
                        dom_hint: None,
                    })
                }
                rdev::EventType::Wheel { delta_x, delta_y } => Some(CaptureEvent {
                    t_ms,
                    event_type: EventType::Scroll,
                    x: Some(delta_x as f64),
                    y: Some(delta_y as f64),
                    button: None,
                    key: None,
                    window_title: None,
                    app_name: None,
                    dom_hint: None,
                }),
                _ => None,
            };

            if let Some(evt) = capture_event {
                if let Ok(mut evts) = events.lock() {
                    evts.push(evt);
                }
            }
        };

        if let Err(error) = rdev::listen(callback) {
            log::error!("Event listener error: {:?}", error);
        }
    });
}

fn get_active_window_info() -> (Option<String>, Option<String>) {
    match active_win_pos_rs::get_active_window() {
        Ok(win) => (Some(win.title), Some(win.app_name)),
        Err(_) => (None, None),
    }
}
