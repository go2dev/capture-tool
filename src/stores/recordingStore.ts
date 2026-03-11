import { create } from "zustand";
import type { RecordingStatusValue } from "../lib/tauri";
import * as tauri from "../lib/tauri";

interface RecordingState {
  status: RecordingStatusValue;
  sessionId: string | null;
  elapsedSeconds: number;
  eventCount: number;
  markerCount: number;
  pollInterval: ReturnType<typeof setInterval> | null;
  timerInterval: ReturnType<typeof setInterval> | null;

  startRecording: (sessionId: string, captureWindow?: string) => Promise<void>;
  stopRecording: () => Promise<string>;
  addMarker: (label?: string) => Promise<void>;
  pollStatus: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  reset: () => void;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  status: "idle",
  sessionId: null,
  elapsedSeconds: 0,
  eventCount: 0,
  markerCount: 0,
  pollInterval: null,
  timerInterval: null,

  startRecording: async (sessionId, captureWindow) => {
    await tauri.startRecording(sessionId, captureWindow);
    set({
      status: "recording",
      sessionId,
      elapsedSeconds: 0,
      eventCount: 0,
      markerCount: 0,
    });
    get().startPolling();
  },

  stopRecording: async () => {
    set({ status: "stopping" });
    get().stopPolling();
    const sessionId = await tauri.stopRecording();
    set({ status: "idle", sessionId: null, elapsedSeconds: 0 });
    return sessionId;
  },

  addMarker: async (label) => {
    await tauri.addMarker(label);
    set((state) => ({ markerCount: state.markerCount + 1 }));
  },

  pollStatus: async () => {
    try {
      const resp = await tauri.getRecordingStatus();
      set({
        status: resp.status,
        elapsedSeconds: resp.elapsed_seconds ?? 0,
      });
    } catch (_err) {
      // Ignore polling errors
    }
  },

  startPolling: () => {
    const { pollInterval, timerInterval } = get();
    if (pollInterval) clearInterval(pollInterval);
    if (timerInterval) clearInterval(timerInterval);

    const newPoll = setInterval(() => {
      get().pollStatus();
    }, 2000);

    const newTimer = setInterval(() => {
      set((state) => {
        if (state.status === "recording") {
          return { elapsedSeconds: state.elapsedSeconds + 1 };
        }
        return {};
      });
    }, 1000);

    set({ pollInterval: newPoll, timerInterval: newTimer });
  },

  stopPolling: () => {
    const { pollInterval, timerInterval } = get();
    if (pollInterval) {
      clearInterval(pollInterval);
      set({ pollInterval: null });
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      set({ timerInterval: null });
    }
  },

  reset: () => {
    get().stopPolling();
    set({
      status: "idle",
      sessionId: null,
      elapsedSeconds: 0,
      eventCount: 0,
      markerCount: 0,
    });
  },
}));
