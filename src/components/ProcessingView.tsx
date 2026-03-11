import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AudioLines,
  FileText,
  Layers,
  Image,
  Film,
  FileOutput,
  Check,
  Loader,
  AlertCircle,
  Play,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import type { ProcessingStage } from "../lib/tauri";
import * as tauri from "../lib/tauri";

interface StageInfo {
  key: ProcessingStage;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

const stages: StageInfo[] = [
  { key: "extracting_audio", label: "Extracting audio", icon: AudioLines },
  { key: "transcribing", label: "Transcribing speech", icon: FileText },
  { key: "normalizing_events", label: "Normalizing events", icon: Layers },
  { key: "segmenting_steps", label: "Segmenting steps", icon: Layers },
  { key: "extracting_frames", label: "Extracting frames", icon: Image },
  { key: "generating_gifs", label: "Generating GIFs", icon: Film },
  { key: "writing_doc", label: "Generating documentation", icon: FileOutput },
];

function stageIndex(stage: ProcessingStage): number {
  const idx = stages.findIndex((s) => s.key === stage);
  if (stage === "complete") return stages.length;
  if (stage === "idle") return -1;
  if (stage === "error") return -1;
  return idx;
}

export default function ProcessingView() {
  const navigate = useNavigate();
  const currentSession = useSessionStore((s) => s.currentSession);
  const refreshCurrentSession = useSessionStore(
    (s) => s.refreshCurrentSession
  );

  const [currentStage, setCurrentStage] = useState<ProcessingStage>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Ready to process");
  const [isProcessing, setIsProcessing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sessionId = currentSession?.session_id;

  const pollProcessing = useCallback(async () => {
    if (!sessionId) return;
    try {
      const status = await tauri.getProcessingStatus(sessionId);
      setCurrentStage(status.stage);
      setProgress(status.progress);
      setMessage(status.message);

      if (status.stage === "complete" || status.stage === "error") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setIsProcessing(false);
        await refreshCurrentSession();

        if (status.stage === "complete") {
          // Small delay before navigating to review
          setTimeout(() => navigate("/review"), 800);
        }
      }
    } catch {
      // Polling error, ignore
    }
  }, [sessionId, refreshCurrentSession, navigate]);

  const handleStartProcessing = useCallback(async () => {
    if (!sessionId) return;
    setIsProcessing(true);
    setCurrentStage("extracting_audio");
    setProgress(0);
    setMessage("Starting pipeline...");

    try {
      // Start processing (this is async on the backend)
      tauri.processSession(sessionId).catch(() => {
        setIsProcessing(false);
        setCurrentStage("error");
        setMessage("Processing failed");
      });

      // Start polling
      pollRef.current = setInterval(pollProcessing, 1500);
    } catch {
      setIsProcessing(false);
      setCurrentStage("error");
      setMessage("Failed to start processing");
    }
  }, [sessionId, pollProcessing]);

  // If we land here and session is already processing, start polling
  useEffect(() => {
    if (
      currentSession?.status === "processing" &&
      !pollRef.current
    ) {
      setIsProcessing(true);
      pollRef.current = setInterval(pollProcessing, 1500);
      pollProcessing();
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [currentSession?.status, pollProcessing]);

  if (!currentSession) {
    return (
      <div className="processing-view">
        <div className="empty-state">
          <div className="empty-state-icon">
            <AlertCircle />
          </div>
          <div className="empty-state-title">No session selected</div>
          <div className="empty-state-desc">
            Select a session from the library first.
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

  const currentIdx = stageIndex(currentStage);
  const isComplete = currentStage === "complete";
  const isError = currentStage === "error";
  const canStart =
    !isProcessing &&
    !isComplete &&
    (currentSession.status === "recorded" ||
      currentSession.status === "created");

  return (
    <div className="processing-view">
      <h2 className="processing-title">
        {isComplete
          ? "Processing Complete"
          : isError
            ? "Processing Error"
            : isProcessing
              ? "Processing..."
              : "Process Recording"}
      </h2>

      {/* Pipeline stages */}
      <div className="processing-pipeline">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const isActive = currentIdx === idx;
          const isDone = currentIdx > idx;

          return (
            <div
              key={stage.key}
              className={`processing-stage ${isActive ? "is-active" : ""} ${
                isDone ? "is-complete" : ""
              }`}
            >
              <div className="processing-stage-indicator">
                {isDone ? (
                  <Check size={14} />
                ) : isActive ? (
                  <Loader size={14} className="spin" />
                ) : (
                  <Icon size={14} />
                )}
              </div>
              <span className="processing-stage-label">{stage.label}</span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {isProcessing && (
        <div className="processing-progress-bar">
          <div
            className="processing-progress-fill"
            style={{ width: `${Math.max(progress * 100, 2)}%` }}
          />
        </div>
      )}

      {/* Message */}
      <div className="processing-message">{message}</div>

      {/* Start button */}
      {canStart && (
        <button
          className="btn btn-primary btn-lg"
          onClick={handleStartProcessing}
        >
          <Play />
          Start Processing
        </button>
      )}

      {isComplete && (
        <button
          className="btn btn-primary btn-lg"
          onClick={() => navigate("/review")}
        >
          Review Steps
        </button>
      )}

      {isError && (
        <button
          className="btn btn-secondary btn-lg"
          onClick={handleStartProcessing}
        >
          Retry
        </button>
      )}
    </div>
  );
}
