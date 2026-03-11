import type {
  CaptureEvent,
  ClientMessage,
  ContentToBackgroundMessage,
  DomEventPayload,
  PopupMessage,
  ServerMessage,
  StatusResponse,
} from "./types";

// -------------------------------------------------------
// State
// -------------------------------------------------------
let ws: WebSocket | null = null;
let connected = false;
let recording = false;
let sessionId: string | null = null;
let eventCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const WS_URL = "ws://localhost:9876";
const RECONNECT_DELAY_MS = 3000;
const EXTENSION_VERSION = "0.1.0";

// -------------------------------------------------------
// WebSocket management
// -------------------------------------------------------

function connectWebSocket(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    clearReconnectTimer();

    // Announce ourselves
    const hello: ClientMessage = { kind: "hello", version: EXTENSION_VERSION };
    ws!.send(JSON.stringify(hello));
    console.log("[Capture Tool] Connected to Tauri backend");
  };

  ws.onmessage = (evt: MessageEvent) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(evt.data as string) as ServerMessage;
    } catch {
      console.warn("[Capture Tool] Failed to parse server message", evt.data);
      return;
    }
    handleServerMessage(msg);
  };

  ws.onerror = () => {
    console.warn("[Capture Tool] WebSocket error");
  };

  ws.onclose = () => {
    connected = false;
    ws = null;
    if (recording) {
      stopCapture();
    }
    console.log("[Capture Tool] Disconnected from Tauri backend");
    scheduleReconnect();
  };
}

function disconnectWebSocket(): void {
  clearReconnectTimer();
  if (ws) {
    ws.onclose = null; // prevent auto-reconnect
    ws.close();
    ws = null;
  }
  connected = false;
  if (recording) {
    stopCapture();
  }
}

function scheduleReconnect(): void {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, RECONNECT_DELAY_MS);
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// -------------------------------------------------------
// Server message handling
// -------------------------------------------------------

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.kind) {
    case "start_recording":
      sessionId = msg.session_id;
      eventCount = 0;
      startCapture();
      break;
    case "stop_recording":
      stopCapture();
      break;
    case "ping": {
      const pong: ClientMessage = { kind: "pong" };
      ws?.send(JSON.stringify(pong));
      break;
    }
  }
}

// -------------------------------------------------------
// Content-script injection / capture orchestration
// -------------------------------------------------------

async function startCapture(): Promise<void> {
  recording = true;

  // Inject content script into all existing tabs
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && isInjectableTab(tab)) {
      injectContentScript(tab.id);
    }
  }
}

function stopCapture(): void {
  recording = false;
  sessionId = null;

  // Tell all tabs to stop
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "stop_capture" }).catch(() => {
          /* tab may not have content script */
        });
      }
    }
  });
}

function isInjectableTab(tab: chrome.tabs.Tab): boolean {
  const url = tab.url ?? "";
  return (
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

async function injectContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/content.js"],
    });
    // Tell the content script to start capturing
    await chrome.tabs.sendMessage(tabId, { action: "start_capture" });
  } catch (err) {
    console.warn(`[Capture Tool] Could not inject into tab ${tabId}:`, err);
  }
}

// -------------------------------------------------------
// Listen for new tab navigations while recording
// -------------------------------------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (recording && changeInfo.status === "complete" && isInjectableTab(tab)) {
    injectContentScript(tabId);
  }
});

// -------------------------------------------------------
// Messages from content scripts
// -------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: ContentToBackgroundMessage | PopupMessage, sender, sendResponse) => {
    // Content script dom_event
    if ("action" in message && message.action === "dom_event" && "payload" in message) {
      const payload = (message as ContentToBackgroundMessage).payload;
      handleDomEvent(payload);
      return;
    }

    // Popup messages
    if ("action" in message) {
      switch (message.action) {
        case "get_status": {
          const status: StatusResponse = { connected, recording, eventCount };
          sendResponse(status);
          return true; // keep channel open for sendResponse
        }
        case "connect":
          connectWebSocket();
          sendResponse({ ok: true });
          return true;
        case "disconnect":
          disconnectWebSocket();
          sendResponse({ ok: true });
          return true;
      }
    }
  }
);

// -------------------------------------------------------
// Forward DOM events to Tauri over WebSocket
// -------------------------------------------------------

function handleDomEvent(payload: DomEventPayload): void {
  eventCount++;

  const captureEvent: CaptureEvent = {
    t_ms: payload.timestamp,
    type: payload.type,
    x: payload.x,
    y: payload.y,
    button: payload.button,
    key: null,
    window_title: payload.pageTitle,
    app_name: "Google Chrome",
    dom_hint: {
      tag: payload.tag,
      text: payload.text,
      selector: payload.selector,
    },
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg: ClientMessage = { kind: "dom_event", event: captureEvent };
    ws.send(JSON.stringify(msg));
  }
}

// -------------------------------------------------------
// Auto-connect on service worker startup
// -------------------------------------------------------
connectWebSocket();
