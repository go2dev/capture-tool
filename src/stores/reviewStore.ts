import { create } from "zustand";
import type { Step, CaptureEvent } from "../lib/tauri";
import * as tauri from "../lib/tauri";

export interface EditableStep extends Step {
  mediaMode: "still" | "gif";
  approved: boolean;
}

interface ReviewState {
  sessionId: string | null;
  steps: EditableStep[];
  events: CaptureEvent[];
  selectedStepId: string | null;
  mdxPreview: string | null;
  loading: boolean;
  error: string | null;

  loadSession: (sessionId: string) => Promise<void>;
  selectStep: (stepId: string) => void;
  updateStep: (stepId: string, updates: Partial<EditableStep>) => void;
  reorderSteps: (fromIndex: number, toIndex: number) => void;
  mergeSteps: (stepIdA: string, stepIdB: string) => void;
  splitStep: (stepId: string, splitAtMs: number) => void;
  deleteStep: (stepId: string) => void;
  approveAll: () => void;
  toggleMediaMode: (stepId: string) => void;
  generatePreview: () => Promise<void>;
  clearReview: () => void;
}

let nextStepCounter = 0;

function generateStepId(): string {
  nextStepCounter += 1;
  return `step_new_${Date.now()}_${nextStepCounter}`;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  sessionId: null,
  steps: [],
  events: [],
  selectedStepId: null,
  mdxPreview: null,
  loading: false,
  error: null,

  loadSession: async (sessionId) => {
    set({ loading: true, error: null, sessionId });
    try {
      const [eventsResult, session] = await Promise.all([
        tauri.getEvents(sessionId),
        tauri.getSession(sessionId),
      ]);

      // Try to load steps from the session directory
      let steps: Step[] = [];
      try {
        // Steps are stored as JSON in the session dir after processing
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const sessionDir = session.video_path
          ? session.video_path.replace(/\/recording\.mp4$/, "")
          : "";
        if (sessionDir) {
          const stepsJson = await readTextFile(`${sessionDir}/steps.json`);
          steps = JSON.parse(stepsJson);
        }
      } catch (_e) {
        // Steps file may not exist yet
        steps = [];
      }

      const editableSteps: EditableStep[] = steps.map((s) => ({
        ...s,
        mediaMode: s.gif ? "gif" : "still",
        approved: !s.review_required,
      }));

      set({
        steps: editableSteps,
        events: eventsResult,
        selectedStepId: editableSteps.length > 0 ? editableSteps[0].step_id : null,
        loading: false,
      });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  selectStep: (stepId) => set({ selectedStepId: stepId }),

  updateStep: (stepId, updates) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.step_id === stepId ? { ...s, ...updates } : s
      ),
    })),

  reorderSteps: (fromIndex, toIndex) =>
    set((state) => {
      const newSteps = [...state.steps];
      const [moved] = newSteps.splice(fromIndex, 1);
      newSteps.splice(toIndex, 0, moved);
      return { steps: newSteps };
    }),

  mergeSteps: (stepIdA, stepIdB) =>
    set((state) => {
      const idxA = state.steps.findIndex((s) => s.step_id === stepIdA);
      const idxB = state.steps.findIndex((s) => s.step_id === stepIdB);
      if (idxA === -1 || idxB === -1) return {};

      const [first, second] =
        idxA < idxB
          ? [state.steps[idxA], state.steps[idxB]]
          : [state.steps[idxB], state.steps[idxA]];

      const merged: EditableStep = {
        ...first,
        t_end_ms: second.t_end_ms,
        title: first.title,
        instruction: `${first.instruction}\n\n${second.instruction}`,
        confidence: Math.min(first.confidence, second.confidence),
        review_required: true,
        approved: false,
        mediaMode: first.mediaMode,
      };

      const removeId = idxA < idxB ? stepIdB : stepIdA;
      const keepId = idxA < idxB ? stepIdA : stepIdB;

      return {
        steps: state.steps
          .map((s) => (s.step_id === keepId ? merged : s))
          .filter((s) => s.step_id !== removeId),
        selectedStepId: keepId,
      };
    }),

  splitStep: (stepId, splitAtMs) =>
    set((state) => {
      const idx = state.steps.findIndex((s) => s.step_id === stepId);
      if (idx === -1) return {};
      const original = state.steps[idx];

      if (splitAtMs <= original.t_start_ms || splitAtMs >= original.t_end_ms) {
        return {};
      }

      const stepA: EditableStep = {
        ...original,
        t_end_ms: splitAtMs,
        review_required: true,
        approved: false,
      };

      const stepB: EditableStep = {
        step_id: generateStepId(),
        t_start_ms: splitAtMs,
        t_end_ms: original.t_end_ms,
        title: `${original.title} (continued)`,
        instruction: "",
        screenshot: null,
        gif: null,
        confidence: original.confidence,
        review_required: true,
        approved: false,
        mediaMode: "still",
      };

      const newSteps = [...state.steps];
      newSteps.splice(idx, 1, stepA, stepB);
      return { steps: newSteps };
    }),

  deleteStep: (stepId) =>
    set((state) => {
      const newSteps = state.steps.filter((s) => s.step_id !== stepId);
      return {
        steps: newSteps,
        selectedStepId:
          state.selectedStepId === stepId
            ? newSteps.length > 0
              ? newSteps[0].step_id
              : null
            : state.selectedStepId,
      };
    }),

  approveAll: () =>
    set((state) => ({
      steps: state.steps.map((s) => ({ ...s, approved: true })),
    })),

  toggleMediaMode: (stepId) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.step_id === stepId
          ? { ...s, mediaMode: s.mediaMode === "still" ? "gif" : "still" }
          : s
      ),
    })),

  generatePreview: async () => {
    const { sessionId } = get();
    if (!sessionId) return;
    set({ loading: true });
    try {
      const mdx = await tauri.generateMdx(sessionId);
      set({ mdxPreview: mdx, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  clearReview: () =>
    set({
      sessionId: null,
      steps: [],
      events: [],
      selectedStepId: null,
      mdxPreview: null,
      error: null,
    }),
}));
