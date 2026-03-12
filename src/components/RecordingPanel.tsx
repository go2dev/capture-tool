import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, AlertCircle, Mic, ArrowRight } from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { useRecordingStore } from "../stores/recordingStore";
import BrowserCapture from "./BrowserCapture";
import type { SourceMode } from "../lib/tauri";

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const sourceModes: { value: SourceMode; label: string }[] = [
  { value: "screen_only", label: "Screen" },
  { value: "screen_browser", label: "Screen + Browser" },
  { value: "screen_accessibility", label: "Screen + A11y" },
];

export default function RecordingPanel() {
  const navigate = useNavigate();
  const currentSession = useSessionStore((s) => s.currentSession);
  const refreshCurrentSession = useSessionStore(
    (s) => s.refreshCurrentSession
  );

  const {
    status,
    elapsedSeconds,
    markerCount,
    startRecording,
    stopRecording,
    addMarker,
  } = useRecordingStore();

  const isRecording = status === "recording";
  const isStopping = status === "stopping";
  const [showPostRecordOptions, setShowPostRecordOptions] = useState(false);

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      try {
        await stopRecording();
        await refreshCurrentSession();
        setShowPostRecordOptions(true);
      } catch {
        // Error handled in store
      }
    } else {
      if (!currentSession) return;
      setShowPostRecordOptions(false);
      try {
        await startRecording(currentSession.session_id);
      } catch {
        // Error handled in store
      }
    }
  }, [
    isRecording,
    currentSession,
    startRecording,
    stopRecording,
    refreshCurrentSession,
  ]);

  const handleAddMarker = useCallback(async () => {
    try {
      await addMarker();
    } catch {
      // Marker add failed
    }
  }, [addMarker]);

  if (!currentSession) {
    return (
      <div className="recording-panel">
        <div className="empty-state">
          <div className="empty-state-icon">
            <AlertCircle />
          </div>
          <div className="empty-state-title">No session selected</div>
          <div className="empty-state-desc">
            Go to Sessions and create or select a session first.
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

  return (
    <div className="recording-panel">
      {/* Source mode selector */}
      <div className="recording-source-selector">
        {sourceModes.map((mode) => (
          <button
            key={mode.value}
            className={`recording-source-option ${
              currentSession.source_mode === mode.value ? "active" : ""
            }`}
            disabled={isRecording}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Timer */}
      <div
        className={`recording-timer ${isRecording ? "is-recording" : ""}`}
      >
        {formatTime(elapsedSeconds)}
      </div>

      {/* Record button */}
      <button
        className={`record-button ${isRecording ? "is-recording" : ""}`}
        onClick={handleToggleRecording}
        disabled={isStopping}
        title={isRecording ? "Stop recording" : "Start recording"}
      >
        <div className="record-button-inner" />
      </button>

      {/* Controls */}
      <div className="recording-controls">
        <button
          className="btn btn-secondary"
          onClick={handleAddMarker}
          disabled={!isRecording}
        >
          <Flag />
          Add Marker
        </button>
      </div>

      {/* Browser Capture - shown when source mode is screen_browser */}
      {currentSession.source_mode === "screen_browser" && (
        <BrowserCapture
          sessionId={currentSession.session_id}
          isRecording={isRecording}
        />
      )}

      {/* Stats */}
      <div className="recording-stats">
        <div className="recording-stat">
          <span className="recording-stat-value">{markerCount}</span>
          <span className="recording-stat-label">Markers</span>
        </div>
        <div className="recording-stat">
          <span className="recording-stat-value">
            {formatTime(elapsedSeconds)}
          </span>
          <span className="recording-stat-label">Duration</span>
        </div>
      </div>

      {/* Post-recording options */}
      {showPostRecordOptions && !isRecording && (
        <div className="recording-post-options">
          <div className="recording-post-title">Recording Complete</div>
          <div className="recording-post-desc">
            Would you like to add a voiceover narration before processing?
          </div>
          <div className="recording-post-buttons">
            <button
              className="btn btn-secondary btn-lg"
              onClick={() => navigate("/voiceover")}
            >
              <Mic />
              Add Voiceover
            </button>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => navigate("/processing")}
            >
              Skip to Processing
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Hints */}
      {!showPostRecordOptions && (
        <div className="recording-hint">
          {isRecording
            ? "Recording in progress. Use markers to indicate important steps. Press Stop when done."
            : "Press the record button to begin capturing. Your screen and audio will be recorded."}
        </div>
      )}
    </div>
  );
}
