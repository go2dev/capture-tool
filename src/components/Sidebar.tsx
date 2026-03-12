import { NavLink, useLocation } from "react-router-dom";
import {
  Library,
  Circle,
  Mic,
  Cog,
  FileText,
  Download,
  Video,
  Settings,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { useRecordingStore } from "../stores/recordingStore";

const baseNavItems = [
  { to: "/", icon: Library, label: "Sessions" },
  { to: "/record", icon: Circle, label: "Record" },
];

const postNavItems = [
  { to: "/processing", icon: Cog, label: "Processing" },
  { to: "/review", icon: FileText, label: "Review" },
  { to: "/export", icon: Download, label: "Export" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const location = useLocation();
  const currentSession = useSessionStore((s) => s.currentSession);
  const recStatus = useRecordingStore((s) => s.status);

  // Show voiceover nav item when session is in "recorded" state
  const showVoiceover = currentSession?.status === "recorded";

  const navItems = [
    ...baseNavItems,
    ...(showVoiceover
      ? [{ to: "/voiceover", icon: Mic, label: "Voiceover" }]
      : []),
    ...postNavItems,
  ];

  return (
    <aside className="sidebar no-select">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Video size={14} />
          </div>
          <span className="sidebar-logo-text">Capture Tool</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Workspace</div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`sidebar-nav-item ${isActive ? "active" : ""}`}
            >
              <Icon />
              <span>{item.label}</span>
              {item.to === "/record" && recStatus === "recording" && (
                <span
                  className="badge-dot"
                  style={{
                    background: "var(--red-400)",
                    marginLeft: "auto",
                    animation: "pulse-dot 1.5s ease infinite",
                  }}
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      {currentSession && (
        <div className="sidebar-footer">
          <div className="sidebar-session-info">
            <span className="sidebar-session-title">
              {currentSession.title}
            </span>
            <span
              className={`badge badge-${currentSession.status}`}
              style={{ alignSelf: "flex-start", marginTop: 4 }}
            >
              <span className="badge-dot" />
              {currentSession.status}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
