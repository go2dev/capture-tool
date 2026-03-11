import { create } from "zustand";
import type { Session, SourceMode } from "../lib/tauri";
import * as tauri from "../lib/tauri";

interface SessionState {
  sessions: Session[];
  currentSession: Session | null;
  loading: boolean;
  error: string | null;

  fetchSessions: () => Promise<void>;
  createSession: (title: string, sourceMode: SourceMode) => Promise<Session>;
  selectSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  refreshCurrentSession: () => Promise<void>;
  setCurrentSession: (session: Session | null) => void;
  clearError: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSession: null,
  loading: false,
  error: null,

  fetchSessions: async () => {
    set({ loading: true, error: null });
    try {
      const sessions = await tauri.listSessions();
      set({ sessions, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  createSession: async (title, sourceMode) => {
    set({ loading: true, error: null });
    try {
      const session = await tauri.createSession(title, sourceMode);
      set((state) => ({
        sessions: [session, ...state.sessions],
        currentSession: session,
        loading: false,
      }));
      return session;
    } catch (err) {
      set({ error: String(err), loading: false });
      throw err;
    }
  },

  selectSession: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const session = await tauri.getSession(sessionId);
      set({ currentSession: session, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await tauri.deleteSession(sessionId);
      const { currentSession } = get();
      set((state) => ({
        sessions: state.sessions.filter((s) => s.session_id !== sessionId),
        currentSession:
          currentSession?.session_id === sessionId ? null : currentSession,
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  refreshCurrentSession: async () => {
    const { currentSession } = get();
    if (!currentSession) return;
    try {
      const session = await tauri.getSession(currentSession.session_id);
      set({ currentSession: session });
      // Also update in list
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.session_id === session.session_id ? session : s
        ),
      }));
    } catch (_err) {
      // Session may have been deleted
    }
  },

  setCurrentSession: (session) => set({ currentSession: session }),
  clearError: () => set({ error: null }),
}));
