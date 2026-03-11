import type { PopupMessage, StatusResponse } from "./types";

// -------------------------------------------------------
// DOM elements
// -------------------------------------------------------

const connectionBadge = document.getElementById("connection-status")!;
const recordingBadge = document.getElementById("recording-status")!;
const eventCountEl = document.getElementById("event-count")!;
const toggleBtn = document.getElementById("toggle-btn")! as HTMLButtonElement;

// -------------------------------------------------------
// State
// -------------------------------------------------------

let isConnected = false;

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function updateUI(status: StatusResponse): void {
  isConnected = status.connected;

  // Connection badge
  connectionBadge.textContent = status.connected ? "Connected" : "Disconnected";
  connectionBadge.className = `badge ${status.connected ? "connected" : "disconnected"}`;

  // Recording badge
  recordingBadge.textContent = status.recording ? "Active" : "Inactive";
  recordingBadge.className = `badge ${status.recording ? "active" : "inactive"}`;

  // Event count
  eventCountEl.textContent = String(status.eventCount);

  // Button
  toggleBtn.textContent = status.connected ? "Disconnect" : "Connect";
  toggleBtn.className = status.connected ? "btn disconnect" : "btn";
}

function sendMessage(msg: PopupMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}

async function refreshStatus(): Promise<void> {
  try {
    const status = (await sendMessage({ action: "get_status" })) as StatusResponse;
    updateUI(status);
  } catch {
    updateUI({ connected: false, recording: false, eventCount: 0 });
  }
}

// -------------------------------------------------------
// Event handlers
// -------------------------------------------------------

toggleBtn.addEventListener("click", async () => {
  if (isConnected) {
    await sendMessage({ action: "disconnect" });
  } else {
    await sendMessage({ action: "connect" });
  }
  // Small delay to let the connection state settle
  setTimeout(refreshStatus, 300);
});

// -------------------------------------------------------
// Init
// -------------------------------------------------------

refreshStatus();

// Poll status while popup is open
setInterval(refreshStatus, 1000);
