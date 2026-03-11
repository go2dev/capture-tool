import { useState, useEffect } from "react";

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptOverlayProps {
  sessionId: string;
  transcriptPath: string | null;
  activeTimeMs: number | null;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TranscriptOverlay({
  transcriptPath,
  activeTimeMs,
}: TranscriptOverlayProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!transcriptPath) {
      setSegments([]);
      return;
    }

    setLoading(true);

    // Load transcript file
    import("@tauri-apps/plugin-fs")
      .then(({ readTextFile }) => readTextFile(transcriptPath))
      .then((content) => {
        try {
          const parsed = JSON.parse(content);
          // Expected format: { segments: [{ start, end, text }] }
          // or an array of segments directly
          const segs = Array.isArray(parsed)
            ? parsed
            : parsed.segments ?? [];
          setSegments(
            segs.map((s: { start: number; end: number; text: string }) => ({
              start: Math.floor(s.start * 1000),
              end: Math.floor(s.end * 1000),
              text: s.text.trim(),
            }))
          );
        } catch {
          setSegments([]);
        }
      })
      .catch(() => setSegments([]))
      .finally(() => setLoading(false));
  }, [transcriptPath]);

  if (loading) {
    return (
      <div className="transcript-overlay">
        <div className="transcript-overlay-header">Transcript</div>
        <div
          style={{
            padding: "12px",
            color: "var(--text-tertiary)",
            fontSize: 12,
          }}
        >
          Loading transcript...
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="transcript-overlay">
        <div className="transcript-overlay-header">Transcript</div>
        <div
          style={{
            padding: "12px",
            color: "var(--text-tertiary)",
            fontSize: 12,
          }}
        >
          {transcriptPath
            ? "No transcript segments found"
            : "No transcript available"}
        </div>
      </div>
    );
  }

  return (
    <div className="transcript-overlay">
      <div className="transcript-overlay-header">Transcript</div>
      {segments.map((seg, i) => {
        const isActive =
          activeTimeMs !== null &&
          activeTimeMs >= seg.start &&
          activeTimeMs <= seg.end;
        return (
          <div
            key={i}
            className={`transcript-segment ${isActive ? "active" : ""}`}
          >
            <span className="transcript-time">
              {formatMs(seg.start)}
            </span>
            <span className="transcript-text">{seg.text}</span>
          </div>
        );
      })}
    </div>
  );
}
