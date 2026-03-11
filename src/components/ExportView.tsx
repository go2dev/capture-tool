import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen,
  Download,
  FileText,
  AlertCircle,
  Check,
  Copy,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import * as tauri from "../lib/tauri";

export default function ExportView() {
  const navigate = useNavigate();
  const currentSession = useSessionStore((s) => s.currentSession);
  const refreshCurrentSession = useSessionStore(
    (s) => s.refreshCurrentSession
  );

  const [outputDir, setOutputDir] = useState(
    currentSession?.output_dir ?? ""
  );
  const [mdxContent, setMdxContent] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sessionId = currentSession?.session_id;

  // Generate MDX preview on load
  useEffect(() => {
    if (!sessionId) return;
    setGenerating(true);
    tauri
      .generateMdx(sessionId)
      .then((mdx) => {
        setMdxContent(mdx);
        setGenerating(false);
      })
      .catch((err) => {
        setError(String(err));
        setGenerating(false);
      });
  }, [sessionId]);

  const handleBrowseDir = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        title: "Choose output directory",
      });
      if (selected && typeof selected === "string") {
        setOutputDir(selected);
        if (sessionId) {
          await tauri.setOutputDir(sessionId, selected);
        }
      }
    } catch (err) {
      setError(String(err));
    }
  }, [sessionId]);

  const handleExport = useCallback(async () => {
    if (!sessionId || !outputDir) return;
    setExporting(true);
    setError(null);
    try {
      await tauri.setOutputDir(sessionId, outputDir);

      // Generate MDX if not already generated
      const mdx = mdxContent ?? (await tauri.generateMdx(sessionId));

      // Write the MDX to the output directory
      const { writeTextFile, mkdir } = await import(
        "@tauri-apps/plugin-fs"
      );

      // Ensure directory exists
      try {
        await mkdir(outputDir, { recursive: true });
      } catch {
        // Directory may already exist
      }

      const slug = currentSession?.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const filename = `${slug || "document"}.mdx`;
      const filePath = `${outputDir}/${filename}`;

      await writeTextFile(filePath, mdx);

      setExported(true);
      await refreshCurrentSession();
    } catch (err) {
      setError(String(err));
    } finally {
      setExporting(false);
    }
  }, [
    sessionId,
    outputDir,
    mdxContent,
    currentSession?.title,
    refreshCurrentSession,
  ]);

  const handleCopy = useCallback(async () => {
    if (!mdxContent) return;
    try {
      await navigator.clipboard.writeText(mdxContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available
    }
  }, [mdxContent]);

  if (!currentSession) {
    return (
      <div className="export-view" style={{ paddingTop: 64 }}>
        <div className="empty-state">
          <div className="empty-state-icon">
            <AlertCircle />
          </div>
          <div className="empty-state-title">No session selected</div>
          <div className="empty-state-desc">
            Select a session to export.
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
    <div className="export-view">
      <div className="page-header">
        <div>
          <h1 className="page-title">Export</h1>
          <p className="page-subtitle">
            Export documentation for "{currentSession.title}"
          </p>
        </div>
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

      {exported && (
        <div
          className="error-banner"
          style={{
            background: "var(--green-900)",
            borderColor: "rgba(34, 197, 94, 0.3)",
            color: "var(--green-400)",
          }}
        >
          <Check />
          <span>
            Document exported successfully to {outputDir}
          </span>
        </div>
      )}

      {/* Output directory */}
      <div className="export-section">
        <h3 className="export-section-title">Output Directory</h3>
        <div className="export-dir-selector">
          <div className="export-dir-path">
            {outputDir || "No directory selected"}
          </div>
          <button className="btn btn-secondary" onClick={handleBrowseDir}>
            <FolderOpen size={14} />
            Browse
          </button>
        </div>
      </div>

      {/* MDX Preview */}
      <div className="export-section">
        <h3 className="export-section-title">Preview</h3>
        <div className="export-preview">
          <div className="export-preview-header">
            <span className="export-preview-filename">
              <FileText
                size={14}
                style={{ marginRight: 6, verticalAlign: "middle" }}
              />
              {currentSession.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || "document"}
              .mdx
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleCopy}
              disabled={!mdxContent}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="export-preview-content">
            {generating ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--text-tertiary)",
                }}
              >
                <div className="loading-spinner" />
                Generating MDX preview...
              </div>
            ) : mdxContent ? (
              mdxContent
            ) : (
              <span style={{ color: "var(--text-tertiary)" }}>
                No content to preview. Process the recording first.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Export actions */}
      <div className="export-actions">
        <button
          className="btn btn-primary btn-lg"
          onClick={handleExport}
          disabled={!outputDir || exporting || !mdxContent}
        >
          <Download />
          {exporting ? "Exporting..." : "Export MDX"}
        </button>
      </div>
    </div>
  );
}
