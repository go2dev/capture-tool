import { useState, useEffect, useCallback } from "react";
import {
  Globe,
  Monitor,
  RefreshCw,
  Camera,
  Wifi,
  WifiOff,
  ExternalLink,
  Loader2,
} from "lucide-react";
import * as tauri from "../lib/tauri";
import type { CdpStatus, CdpTabSummary } from "../lib/tauri";

interface BrowserCaptureProps {
  sessionId: string | null;
  isRecording: boolean;
}

export default function BrowserCapture({
  sessionId,
  isRecording,
}: BrowserCaptureProps) {
  const [status, setStatus] = useState<CdpStatus | null>(null);
  const [tabs, setTabs] = useState<CdpTabSummary[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);

  // Poll CDP status
  const refreshStatus = useCallback(async () => {
    try {
      const s = await tauri.cdpCheckStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setStatus(null);
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 3000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  const handleLaunchChrome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await tauri.cdpLaunchBrowser(targetUrl || undefined);
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [targetUrl, refreshStatus]);

  const handleRefreshTabs = useCallback(async () => {
    try {
      const t = await tauri.cdpListTabs();
      setTabs(t);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const handleConnectTab = useCallback(
    async (tabId?: string) => {
      setLoading(true);
      setError(null);
      try {
        await tauri.cdpConnectTab(tabId);
        await refreshStatus();
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [refreshStatus]
  );

  const handleStartCapture = useCallback(async () => {
    if (!sessionId) return;
    setError(null);
    try {
      await tauri.cdpStartCapture(sessionId);
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    }
  }, [sessionId, refreshStatus]);

  const handleStopCapture = useCallback(async () => {
    setError(null);
    try {
      await tauri.cdpStopCapture();
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    }
  }, [refreshStatus]);

  const handleTakeScreenshot = useCallback(async () => {
    if (!sessionId) return;
    setScreenshotLoading(true);
    setError(null);
    try {
      const path = await tauri.cdpTakeScreenshot(sessionId, 0);
      setError(null);
      console.log("CDP screenshot saved:", path);
    } catch (err) {
      setError(String(err));
    } finally {
      setScreenshotLoading(false);
    }
  }, [sessionId]);

  const isAvailable = status?.available ?? false;
  const isConnected = status?.connected_tab != null;
  const isCapturing = status?.capturing ?? false;

  return (
    <div className="browser-capture">
      <div className="browser-capture-header">
        <Globe size={16} />
        <span className="browser-capture-title">Browser Capture (CDP)</span>
        <span
          className={`browser-capture-status-dot ${isAvailable ? "available" : "unavailable"}`}
        />
      </div>

      {error && <div className="browser-capture-error">{error}</div>}

      {/* CDP availability status */}
      <div className="browser-capture-row">
        <div className="browser-capture-indicator">
          {isAvailable ? (
            <Wifi size={14} className="indicator-on" />
          ) : (
            <WifiOff size={14} className="indicator-off" />
          )}
          <span>
            {isAvailable
              ? `Connected: ${status?.browser ?? "Chrome"}`
              : "Chrome not running with CDP"}
          </span>
        </div>
      </div>

      {/* Launch Chrome if not available */}
      {!isAvailable && (
        <div className="browser-capture-section">
          <div className="browser-capture-url-row">
            <input
              type="text"
              className="browser-capture-url-input"
              placeholder="https://example.com (optional)"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={loading}
            />
          </div>
          <button
            className="btn btn-primary btn-sm browser-capture-btn"
            onClick={handleLaunchChrome}
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={14} className="spinner" />
            ) : (
              <ExternalLink size={14} />
            )}
            Launch Chrome with CDP
          </button>
        </div>
      )}

      {/* Tab connection */}
      {isAvailable && !isConnected && (
        <div className="browser-capture-section">
          <div className="browser-capture-tabs-header">
            <span>Select a browser tab:</span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={handleRefreshTabs}
            >
              <RefreshCw size={12} />
            </button>
          </div>
          {tabs.length === 0 ? (
            <button
              className="btn btn-secondary btn-sm browser-capture-btn"
              onClick={async () => {
                await handleRefreshTabs();
                if (tabs.length === 0) {
                  // Auto-connect to first tab
                  handleConnectTab();
                }
              }}
              disabled={loading}
            >
              <Monitor size={14} />
              {loading ? "Connecting..." : "Auto-connect to active tab"}
            </button>
          ) : (
            <div className="browser-capture-tab-list">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className="browser-capture-tab-item"
                  onClick={() => handleConnectTab(tab.id)}
                  disabled={loading}
                  title={tab.url}
                >
                  <span className="browser-capture-tab-title">
                    {tab.title || "Untitled"}
                  </span>
                  <span className="browser-capture-tab-url">
                    {tab.url.length > 50
                      ? tab.url.substring(0, 50) + "..."
                      : tab.url}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Connected tab info */}
      {isConnected && status?.connected_tab && (
        <div className="browser-capture-section">
          <div className="browser-capture-connected-tab">
            <Monitor size={14} />
            <div className="browser-capture-tab-info">
              <span className="browser-capture-tab-title">
                {status.connected_tab.title}
              </span>
              <span className="browser-capture-tab-url">
                {status.connected_tab.url}
              </span>
            </div>
          </div>

          {/* Capture controls */}
          <div className="browser-capture-controls">
            {!isCapturing && isRecording && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleStartCapture}
              >
                Start CDP Capture
              </button>
            )}
            {isCapturing && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleStopCapture}
              >
                Stop CDP Capture
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleTakeScreenshot}
              disabled={screenshotLoading || !sessionId}
              title="Take a clean browser screenshot"
            >
              {screenshotLoading ? (
                <Loader2 size={14} className="spinner" />
              ) : (
                <Camera size={14} />
              )}
              Screenshot
            </button>
          </div>

          {/* Event counter */}
          {isCapturing && (
            <div className="browser-capture-stats">
              <div className="browser-capture-stat">
                <span className="browser-capture-stat-value">
                  {status.event_count}
                </span>
                <span className="browser-capture-stat-label">CDP Events</span>
              </div>
              <div className="browser-capture-stat">
                <span className="browser-capture-stat-badge capturing">
                  Capturing
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
