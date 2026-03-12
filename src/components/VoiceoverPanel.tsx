import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Mic,
  Square,
  Play,
  RotateCcw,
  Trash2,
  AlertCircle,
  Loader,
  ArrowRight,
  Clock,
  Volume2,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/sessionStore";
import type { CaptureEvent, VoiceoverStatus } from "../lib/tauri";
import * as tauri from "../lib/tauri";

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type PanelPhase = "idle" | "recording" | "recorded" | "merging" | "done";

export default function VoiceoverPanel() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const sessionIdFromParams = params.id;

  const currentSession = useSessionStore((s) => s.currentSession);
  const selectSession = useSessionStore((s) => s.selectSession);
  const refreshCurrentSession = useSessionStore(
    (s) => s.refreshCurrentSession
  );

  const sessionId = sessionIdFromParams ?? currentSession?.session_id;

  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<PanelPhase>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [voiceoverStatus, setVoiceoverStatus] =
    useState<VoiceoverStatus | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [markers, setMarkers] = useState<CaptureEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the session if we came from a URL parameter
  useEffect(() => {
    if (sessionIdFromParams && !currentSession) {
      selectSession(sessionIdFromParams);
    }
  }, [sessionIdFromParams, currentSession, selectSession]);

  // Load video URL and voiceover status on mount
  useEffect(() => {
    if (!sessionId) return;

    setLoading(true);
    Promise.all([
      tauri.getVideoPath(sessionId).catch(() => null),
      tauri.getVoiceoverStatus(sessionId).catch(() => null),
      tauri.getEvents(sessionId).catch(() => []),
    ])
      .then(([videoPath, status, events]) => {
        if (videoPath) {
          setVideoUrl(convertFileSrc(videoPath));
        }
        if (status) {
          setVoiceoverStatus(status);
          if (status.is_recording) {
            setPhase("recording");
          } else if (status.has_merged) {
            setPhase("done");
          } else if (status.has_voiceover) {
            setPhase("recorded");
          }
        }
        // Filter only marker events for the timeline
        const markerEvents = events.filter(
          (e: CaptureEvent) => e.type === "marker"
        );
        setMarkers(markerEvents);
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Polling for voiceover status during recording
  useEffect(() => {
    if (phase !== "recording" || !sessionId) return;

    const interval = setInterval(async () => {
      try {
        const status = await tauri.getVoiceoverStatus(sessionId);
        setVoiceoverStatus(status);
        if (status.recording_elapsed_secs != null) {
          setElapsedSeconds(Math.floor(status.recording_elapsed_secs));
        }
      } catch {
        // Ignore polling errors
      }
    }, 500);

    return () => clearInterval(interval);
  }, [phase, sessionId]);

  // Local timer for smoother elapsed time display
  useEffect(() => {
    if (phase === "recording") {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase]);

  const handleStartRecording = useCallback(async () => {
    if (!sessionId) return;
    setError(null);

    try {
      // Start video playback
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        await videoRef.current.play();
      }

      // Start voiceover recording
      await tauri.startVoiceover(sessionId);
      setElapsedSeconds(0);
      setPhase("recording");
    } catch (err) {
      setError(String(err));
      // Pause video if recording failed
      if (videoRef.current) {
        videoRef.current.pause();
      }
    }
  }, [sessionId]);

  const handleStopRecording = useCallback(async () => {
    if (!sessionId) return;
    setError(null);

    try {
      // Pause video
      if (videoRef.current) {
        videoRef.current.pause();
      }

      // Stop voiceover recording
      await tauri.stopVoiceover(sessionId);

      // Refresh status
      const status = await tauri.getVoiceoverStatus(sessionId);
      setVoiceoverStatus(status);
      setPhase("recorded");
    } catch (err) {
      setError(String(err));
    }
  }, [sessionId]);

  const handleDeleteVoiceover = useCallback(async () => {
    if (!sessionId) return;
    setError(null);

    try {
      await tauri.deleteVoiceover(sessionId);
      const status = await tauri.getVoiceoverStatus(sessionId);
      setVoiceoverStatus(status);
      setPhase("idle");
      setElapsedSeconds(0);
    } catch (err) {
      setError(String(err));
    }
  }, [sessionId]);

  const handlePreview = useCallback(() => {
    // Play the video from the start -- the voiceover isn't mixed in yet
    // but this lets the user see the video. We'll play the voiceover
    // separately if the browser API supports it.
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play();
    }
  }, []);

  const handleMergeAndContinue = useCallback(async () => {
    if (!sessionId) return;
    setError(null);
    setPhase("merging");

    try {
      await tauri.mergeAudio(sessionId);
      const status = await tauri.getVoiceoverStatus(sessionId);
      setVoiceoverStatus(status);
      setPhase("done");

      // Navigate to processing after a short delay
      await refreshCurrentSession();
      setTimeout(() => navigate("/processing"), 500);
    } catch (err) {
      setError(String(err));
      setPhase("recorded");
    }
  }, [sessionId, refreshCurrentSession, navigate]);

  const handleSkipToProcessing = useCallback(async () => {
    await refreshCurrentSession();
    navigate("/processing");
  }, [refreshCurrentSession, navigate]);

  if (!sessionId) {
    return (
      <div className="voiceover-panel">
        <div className="empty-state">
          <div className="empty-state-icon">
            <AlertCircle />
          </div>
          <div className="empty-state-title">No session selected</div>
          <div className="empty-state-desc">
            Select a recorded session from the library first.
          </div>
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            Go to Sessions
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="voiceover-panel">
        <div className="empty-state">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="voiceover-panel">
      <div className="voiceover-header">
        <div>
          <h2 className="voiceover-title">Add Voiceover</h2>
          <p className="voiceover-subtitle">
            Play back the recording and narrate over it. Your voiceover will be
            merged with the original audio before transcription.
          </p>
        </div>
        <button
          className="btn btn-ghost"
          onClick={handleSkipToProcessing}
        >
          Skip to Processing
          <ArrowRight size={14} />
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle />
          <span>{error}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setError(null)}
            style={{ marginLeft: "auto" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Video player */}
      <div className="voiceover-video-container">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="voiceover-video"
            controls={phase !== "recording"}
            playsInline
          />
        ) : (
          <div className="voiceover-video-placeholder">
            <span>No video available for this session</span>
          </div>
        )}

        {/* Recording overlay */}
        {phase === "recording" && (
          <div className="voiceover-recording-overlay">
            <div className="voiceover-recording-indicator">
              <span className="voiceover-recording-dot" />
              <span className="voiceover-recording-label">
                Recording Voiceover
              </span>
              <span className="voiceover-recording-time">
                {formatTime(elapsedSeconds)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Marker timeline */}
      {markers.length > 0 && (
        <div className="voiceover-markers">
          <div className="voiceover-markers-label">
            <Clock size={12} />
            Markers from original recording
          </div>
          <div className="voiceover-markers-list">
            {markers.map((marker, i) => (
              <button
                key={`${marker.t_ms}-${i}`}
                className="voiceover-marker-chip"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = marker.t_ms / 1000;
                  }
                }}
                title={`Jump to ${formatMs(marker.t_ms)}`}
              >
                <span className="voiceover-marker-time">
                  {formatMs(marker.t_ms)}
                </span>
                {marker.key && (
                  <span className="voiceover-marker-label">{marker.key}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Controls area */}
      <div className="voiceover-controls">
        {phase === "idle" && (
          <div className="voiceover-controls-group">
            <button
              className="btn btn-primary btn-lg"
              onClick={handleStartRecording}
              disabled={!videoUrl}
            >
              <Mic />
              Record Voiceover
            </button>
            <p className="voiceover-hint">
              Press to start video playback and mic recording simultaneously.
              Speak your narration while watching the video.
            </p>
          </div>
        )}

        {phase === "recording" && (
          <div className="voiceover-controls-group">
            <button
              className="btn btn-secondary btn-lg voiceover-stop-btn"
              onClick={handleStopRecording}
            >
              <Square />
              Stop Recording
            </button>
          </div>
        )}

        {phase === "recorded" && voiceoverStatus && (
          <div className="voiceover-recorded-info">
            <div className="voiceover-recorded-card">
              <div className="voiceover-recorded-icon">
                <Volume2 size={20} />
              </div>
              <div className="voiceover-recorded-details">
                <span className="voiceover-recorded-title">
                  Voiceover Recorded
                </span>
                <span className="voiceover-recorded-duration">
                  Duration:{" "}
                  {voiceoverStatus.voiceover_duration_secs != null
                    ? formatTime(
                        Math.round(voiceoverStatus.voiceover_duration_secs)
                      )
                    : "Unknown"}
                </span>
              </div>
            </div>

            <div className="voiceover-recorded-actions">
              <button
                className="btn btn-secondary"
                onClick={handleDeleteVoiceover}
              >
                <RotateCcw size={14} />
                Re-record
              </button>
              <button className="btn btn-secondary" onClick={handlePreview}>
                <Play size={14} />
                Preview Video
              </button>
              <button
                className="btn btn-primary"
                onClick={handleMergeAndContinue}
              >
                <ArrowRight size={14} />
                Merge & Continue
              </button>
            </div>
          </div>
        )}

        {phase === "merging" && (
          <div className="voiceover-controls-group">
            <Loader size={20} className="spin" />
            <span className="voiceover-merging-text">
              Merging audio tracks...
            </span>
          </div>
        )}

        {phase === "done" && (
          <div className="voiceover-controls-group">
            <div className="voiceover-done-message">
              Audio merged successfully. Proceeding to processing...
            </div>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => navigate("/processing")}
            >
              Go to Processing
              <ArrowRight size={14} />
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleDeleteVoiceover}
            >
              <Trash2 size={14} />
              Delete Voiceover & Start Over
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
