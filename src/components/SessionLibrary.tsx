import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  FileText,
  Trash2,
  AlertCircle,
  FolderOpen,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import type { SourceMode } from "../lib/tauri";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function SessionLibrary() {
  const {
    sessions,
    loading,
    error,
    fetchSessions,
    createSession,
    selectSession,
    deleteSession,
    clearError,
  } = useSessionStore();

  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newMode, setNewMode] = useState<SourceMode>("screen_only");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const session = await createSession(newTitle.trim(), newMode);
      setShowCreate(false);
      setNewTitle("");
      navigate("/record");
      // Session is already set as current in the store
      void session;
    } catch {
      // Error is set in the store
    } finally {
      setCreating(false);
    }
  }, [newTitle, newMode, createSession, navigate]);

  const handleSelectSession = useCallback(
    async (sessionId: string, status: string) => {
      await selectSession(sessionId);
      switch (status) {
        case "created":
        case "recording":
          navigate("/record");
          break;
        case "recorded":
          navigate("/voiceover");
          break;
        case "processing":
          navigate("/processing");
          break;
        case "processed":
        case "reviewed":
          navigate("/review");
          break;
        case "exported":
          navigate("/export");
          break;
        default:
          break;
      }
    },
    [selectSession, navigate]
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      await deleteSession(sessionId);
    },
    [deleteSession]
  );

  return (
    <div className="session-library">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">
            Capture and document your workflows
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreate(true)}
        >
          <Plus />
          New Session
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle />
          <span>{error}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={clearError}
            style={{ marginLeft: "auto" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && sessions.length === 0 ? (
        <div className="empty-state">
          <div className="loading-spinner" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <FolderOpen />
          </div>
          <div className="empty-state-title">No sessions yet</div>
          <div className="empty-state-desc">
            Create a new session to start capturing your workflow.
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus />
            New Session
          </button>
        </div>
      ) : (
        <div className="session-list">
          {sessions.map((session) => (
            <div
              key={session.session_id}
              className="session-card"
              onClick={() =>
                handleSelectSession(session.session_id, session.status)
              }
            >
              <div className="session-card-icon">
                <FileText />
              </div>
              <div className="session-card-info">
                <div className="session-card-title">{session.title}</div>
                <div className="session-card-meta">
                  {formatDate(session.started_at)}
                </div>
              </div>
              <span className={`badge badge-${session.status}`}>
                <span className="badge-dot" />
                {session.status}
              </span>
              <div className="session-card-actions">
                <button
                  className="btn btn-icon btn-danger btn-sm"
                  onClick={(e) => handleDelete(e, session.session_id)}
                  title="Delete session"
                >
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Session Dialog */}
      {showCreate && (
        <div className="create-session-dialog">
          <div
            className="create-session-overlay"
            onClick={() => setShowCreate(false)}
          />
          <div className="create-session-modal">
            <h2>New Session</h2>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g., Setting up CI/CD pipeline"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Source Mode</label>
              <select
                className="form-select"
                value={newMode}
                onChange={(e) =>
                  setNewMode(e.target.value as SourceMode)
                }
              >
                <option value="screen_only">Screen Only</option>
                <option value="screen_browser">
                  Screen + Browser Events
                </option>
                <option value="screen_accessibility">
                  Screen + Accessibility
                </option>
              </select>
            </div>
            <div className="form-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!newTitle.trim() || creating}
              >
                {creating ? "Creating..." : "Create Session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
