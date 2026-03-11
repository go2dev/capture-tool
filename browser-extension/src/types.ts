// -------------------------------------------------------
// Types that mirror the Rust backend's event model
// (src-tauri/src/session/models.rs)
// -------------------------------------------------------

/** Matches EventType enum on the Rust side (snake_case serialisation). */
export type EventType =
  | "click"
  | "key_press"
  | "key_release"
  | "scroll"
  | "move"
  | "window_change"
  | "marker";

/** DOM metadata attached to a CaptureEvent. */
export interface DomHint {
  tag: string | null;
  text: string | null;
  selector: string | null;
}

/** A single capture event, matching CaptureEvent on the Rust side. */
export interface CaptureEvent {
  t_ms: number;
  type: EventType;
  x: number | null;
  y: number | null;
  button: string | null;
  key: string | null;
  window_title: string | null;
  app_name: string | null;
  dom_hint: DomHint | null;
}

// -------------------------------------------------------
// WebSocket protocol messages exchanged between the
// browser extension and the Tauri backend.
// -------------------------------------------------------

/** Messages sent FROM the Tauri backend TO the extension. */
export type ServerMessage =
  | { kind: "start_recording"; session_id: string }
  | { kind: "stop_recording" }
  | { kind: "ping" };

/** Messages sent FROM the extension TO the Tauri backend. */
export type ClientMessage =
  | { kind: "dom_event"; event: CaptureEvent }
  | { kind: "hello"; version: string }
  | { kind: "pong" };

// -------------------------------------------------------
// Internal messages passed between background ↔ content
// scripts via chrome.runtime / chrome.tabs messaging.
// -------------------------------------------------------

/** Messages from background → content script. */
export type BackgroundToContentMessage =
  | { action: "start_capture" }
  | { action: "stop_capture" };

/** Messages from content script → background. */
export interface ContentToBackgroundMessage {
  action: "dom_event";
  payload: DomEventPayload;
}

/** The payload the content script sends for every captured interaction. */
export interface DomEventPayload {
  type: EventType;
  x: number | null;
  y: number | null;
  button: string | null;
  tag: string;
  text: string;
  selector: string;
  dataTestId: string | null;
  url: string;
  pageTitle: string;
  fieldLabel: string | null;
  timestamp: number;
}

// -------------------------------------------------------
// Popup ↔ background messaging
// -------------------------------------------------------

export type PopupMessage =
  | { action: "get_status" }
  | { action: "connect" }
  | { action: "disconnect" };

export interface StatusResponse {
  connected: boolean;
  recording: boolean;
  eventCount: number;
}
