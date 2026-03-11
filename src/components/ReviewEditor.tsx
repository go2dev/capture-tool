import { useEffect, useCallback, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCheck,
  Download,
  Image,
  Film,
  AlertCircle,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { useReviewStore } from "../stores/reviewStore";
import StepCard from "./StepCard";
import Timeline from "./Timeline";
import TranscriptOverlay from "./TranscriptOverlay";

export default function ReviewEditor() {
  const navigate = useNavigate();
  const currentSession = useSessionStore((s) => s.currentSession);

  const {
    steps,
    events,
    selectedStepId,
    loading,
    loadSession,
    selectStep,
    updateStep,
    reorderSteps,
    mergeSteps,
    splitStep,
    deleteStep,
    approveAll,
    toggleMediaMode,
  } = useReviewStore();

  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);

  const sessionId = currentSession?.session_id;

  useEffect(() => {
    if (sessionId) {
      loadSession(sessionId);
    }
  }, [sessionId, loadSession]);

  const selectedStep = useMemo(
    () => steps.find((s) => s.step_id === selectedStepId) ?? null,
    [steps, selectedStepId]
  );

  const activeTimeMs = useMemo(
    () => (selectedStep ? selectedStep.t_start_ms : null),
    [selectedStep]
  );

  const handleMergeWithNext = useCallback(
    (stepId: string, index: number) => {
      if (index < steps.length - 1) {
        mergeSteps(stepId, steps[index + 1].step_id);
      }
    },
    [steps, mergeSteps]
  );

  const handleSplit = useCallback(
    (stepId: string) => {
      const step = steps.find((s) => s.step_id === stepId);
      if (!step) return;
      const midpoint = Math.floor(
        (step.t_start_ms + step.t_end_ms) / 2
      );
      splitStep(stepId, midpoint);
    },
    [steps, splitStep]
  );

  const handleDragStart = useCallback((index: number) => {
    setDragFromIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (toIndex: number) => {
      if (dragFromIndex === null || dragFromIndex === toIndex) return;
      reorderSteps(dragFromIndex, toIndex);
      setDragFromIndex(toIndex);
    },
    [dragFromIndex, reorderSteps]
  );

  const handleDragEnd = useCallback(() => {
    setDragFromIndex(null);
  }, []);

  if (!currentSession) {
    return (
      <div
        className="review-editor"
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <div className="empty-state">
          <div className="empty-state-icon">
            <AlertCircle />
          </div>
          <div className="empty-state-title">No session selected</div>
          <div className="empty-state-desc">
            Select a processed session from the library.
          </div>
          <button
            className="btn btn-primary"
            onClick={() => navigate("/")}
          >
            Go to Sessions
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="review-editor"
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="review-editor" style={{ flexDirection: "column" }}>
      {/* Toolbar */}
      <div className="review-toolbar">
        <div className="review-toolbar-group">
          <span className="review-toolbar-title">
            {currentSession.title}
          </span>
          <span
            className={`badge badge-${currentSession.status}`}
            style={{ marginLeft: 8 }}
          >
            <span className="badge-dot" />
            {currentSession.status}
          </span>
        </div>
        <div className="review-toolbar-group">
          <button className="btn btn-secondary btn-sm" onClick={approveAll}>
            <CheckCheck size={14} />
            Approve All
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => navigate("/export")}
          >
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* Three-panel layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left panel - Step list */}
        <div className="review-left-panel">
          <div className="review-left-header">
            <span className="review-left-header-title">
              Steps ({steps.length})
            </span>
          </div>
          <div className="review-step-list">
            {steps.map((step, idx) => (
              <StepCard
                key={step.step_id}
                index={idx}
                stepId={step.step_id}
                title={step.title}
                tStartMs={step.t_start_ms}
                tEndMs={step.t_end_ms}
                screenshot={step.screenshot}
                approved={step.approved}
                selected={step.step_id === selectedStepId}
                isLast={idx === steps.length - 1}
                onClick={() => selectStep(step.step_id)}
                onMergeWithNext={() => handleMergeWithNext(step.step_id, idx)}
                onSplit={() => handleSplit(step.step_id)}
                onDelete={() => deleteStep(step.step_id)}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              />
            ))}
            {steps.length === 0 && (
              <div
                style={{
                  padding: "24px 12px",
                  textAlign: "center",
                  color: "var(--text-tertiary)",
                  fontSize: 13,
                }}
              >
                No steps generated yet.
                <br />
                Process the recording first.
              </div>
            )}
          </div>
        </div>

        {/* Center panel - Step detail */}
        <div className="review-center-panel">
          <div className="review-center-content">
            {selectedStep ? (
              <div className="review-step-detail">
                {/* Screenshot */}
                <div className="review-step-screenshot">
                  {selectedStep.mediaMode === "gif" &&
                  selectedStep.gif ? (
                    <img src={selectedStep.gif} alt={selectedStep.title} />
                  ) : selectedStep.screenshot ? (
                    <img
                      src={selectedStep.screenshot}
                      alt={selectedStep.title}
                    />
                  ) : (
                    <span>No screenshot available</span>
                  )}
                  <div className="review-media-toggle">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        toggleMediaMode(selectedStep.step_id)
                      }
                      title={
                        selectedStep.mediaMode === "still"
                          ? "Switch to GIF"
                          : "Switch to Still"
                      }
                    >
                      {selectedStep.mediaMode === "still" ? (
                        <>
                          <Film size={12} />
                          GIF
                        </>
                      ) : (
                        <>
                          <Image size={12} />
                          Still
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Title */}
                <div className="review-step-fields">
                  <input
                    className="review-step-title-input"
                    type="text"
                    value={selectedStep.title}
                    onChange={(e) =>
                      updateStep(selectedStep.step_id, {
                        title: e.target.value,
                      })
                    }
                    placeholder="Step title"
                  />

                  {/* Instruction */}
                  <textarea
                    className="review-step-textarea"
                    value={selectedStep.instruction}
                    onChange={(e) =>
                      updateStep(selectedStep.step_id, {
                        instruction: e.target.value,
                      })
                    }
                    placeholder="Step instruction text..."
                  />

                  {/* Meta */}
                  <div className="review-step-meta">
                    <div className="review-step-confidence">
                      <span>Confidence:</span>
                      <div className="confidence-bar">
                        <div
                          className={`confidence-fill ${
                            selectedStep.confidence >= 0.8
                              ? "high"
                              : selectedStep.confidence >= 0.5
                                ? "medium"
                                : "low"
                          }`}
                          style={{
                            width: `${selectedStep.confidence * 100}%`,
                          }}
                        />
                      </div>
                      <span>
                        {Math.round(selectedStep.confidence * 100)}%
                      </span>
                    </div>

                    <button
                      className={`btn btn-sm ${
                        selectedStep.approved
                          ? "btn-primary"
                          : "btn-secondary"
                      }`}
                      onClick={() =>
                        updateStep(selectedStep.step_id, {
                          approved: !selectedStep.approved,
                        })
                      }
                    >
                      <CheckCheck size={12} />
                      {selectedStep.approved ? "Approved" : "Approve"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="review-center-empty">
                Select a step to edit
              </div>
            )}
          </div>
        </div>

        {/* Right panel - Timeline + Transcript */}
        <div className="review-right-panel">
          <div className="review-right-header">
            <span className="review-right-header-title">Timeline</span>
          </div>
          <div className="review-right-content">
            <Timeline
              steps={steps}
              events={events}
              selectedStepId={selectedStepId}
              onSelectStep={selectStep}
            />
            <TranscriptOverlay
              sessionId={currentSession.session_id}
              transcriptPath={currentSession.transcript_path}
              activeTimeMs={activeTimeMs}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
