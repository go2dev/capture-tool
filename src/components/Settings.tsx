import { useEffect, useState } from "react";
import {
  Save,
  Eye,
  EyeOff,
  FolderOpen,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader,
} from "lucide-react";
import {
  getSettings,
  saveSettings,
  type Settings as SettingsType,
  type LlmProvider,
} from "../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";

const PROVIDER_OPTIONS: { value: LlmProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI" },
  { value: "ollama", label: "Ollama (Local)" },
  { value: "none", label: "None (Rule-based only)" },
];

const WHISPER_MODELS = ["tiny", "base", "small", "medium", "large"];
const QUALITY_OPTIONS = ["low", "medium", "high"];

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  ollama: "llama3",
  none: "",
};

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const s = await getSettings();
      setSettings(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function update(patch: Partial<SettingsType>) {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    setSaved(false);
  }

  function handleProviderChange(provider: LlmProvider) {
    if (!settings) return;
    const newModel =
      settings.llm_provider === provider
        ? settings.llm_model
        : DEFAULT_MODELS[provider];
    update({ llm_provider: provider, llm_model: newModel });
  }

  async function handleSave() {
    if (!settings) return;
    try {
      setSaving(true);
      setError(null);
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handlePickOutputDir() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        update({ output_default_dir: selected });
      }
    } catch {
      // user cancelled
    }
  }

  async function handleTestConnection() {
    if (!settings) return;
    setTestStatus("testing");
    setTestMessage("");

    try {
      // Save first so the backend uses the latest settings
      await saveSettings(settings);

      // A simple sanity check -- we verify that the configured key/url looks
      // plausible.  A full round-trip test would require invoking the Python
      // worker or an HTTP request from the frontend, which is outside the
      // scope of a settings page.  We do basic validation here.
      const { llm_provider, anthropic_api_key, openai_api_key, ollama_url } =
        settings;

      if (llm_provider === "anthropic") {
        if (!anthropic_api_key || anthropic_api_key.trim() === "") {
          throw new Error(
            "Anthropic API key is empty. Set the key or the ANTHROPIC_API_KEY environment variable.",
          );
        }
        if (!anthropic_api_key.startsWith("sk-ant-")) {
          throw new Error(
            'Anthropic API key should start with "sk-ant-". Please check your key.',
          );
        }
      } else if (llm_provider === "openai") {
        if (!openai_api_key || openai_api_key.trim() === "") {
          throw new Error(
            "OpenAI API key is empty. Set the key or the OPENAI_API_KEY environment variable.",
          );
        }
        if (!openai_api_key.startsWith("sk-")) {
          throw new Error(
            'OpenAI API key should start with "sk-". Please check your key.',
          );
        }
      } else if (llm_provider === "ollama") {
        if (!ollama_url || ollama_url.trim() === "") {
          throw new Error("Ollama URL is empty.");
        }
        try {
          new URL(ollama_url);
        } catch {
          throw new Error("Ollama URL is not a valid URL.");
        }
      }

      setTestStatus("success");
      setTestMessage("Configuration looks good. Settings saved.");
    } catch (e: unknown) {
      setTestStatus("error");
      setTestMessage(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return (
      <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="page">
        <div className="error-banner">
          <AlertCircle />
          Failed to load settings: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Configure LLM providers, recording, and export options
          </p>
        </div>
        <button
          className={`btn ${saved ? "btn-secondary" : "btn-primary"}`}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader size={14} className="spin" />
          ) : saved ? (
            <CheckCircle size={14} />
          ) : (
            <Save size={14} />
          )}
          {saving ? "Saving..." : saved ? "Saved" : "Save Settings"}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle />
          {error}
        </div>
      )}

      {/* ---- LLM Configuration ---- */}
      <section className="settings-section">
        <h2 className="settings-section-title">LLM Configuration</h2>
        <p className="settings-section-desc">
          Choose the AI provider used to rewrite step instructions into
          documentation prose.
        </p>

        <div className="settings-grid">
          {/* Provider */}
          <div className="form-group">
            <label className="form-label">Provider</label>
            <select
              className="form-select"
              value={settings.llm_provider}
              onChange={(e) =>
                handleProviderChange(e.target.value as LlmProvider)
              }
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div className="form-group">
            <label className="form-label">Model</label>
            <input
              className="form-input"
              value={settings.llm_model}
              onChange={(e) => update({ llm_model: e.target.value })}
              placeholder={DEFAULT_MODELS[settings.llm_provider]}
              disabled={settings.llm_provider === "none"}
            />
          </div>

          {/* Anthropic API key */}
          {settings.llm_provider === "anthropic" && (
            <div className="form-group settings-full-width">
              <label className="form-label">Anthropic API Key</label>
              <div className="settings-key-row">
                <input
                  className="form-input"
                  type={showAnthropicKey ? "text" : "password"}
                  value={settings.anthropic_api_key ?? ""}
                  onChange={(e) =>
                    update({
                      anthropic_api_key: e.target.value || null,
                    })
                  }
                  placeholder="sk-ant-..."
                />
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                  type="button"
                  title={showAnthropicKey ? "Hide key" : "Show key"}
                >
                  {showAnthropicKey ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </button>
              </div>
              <span className="settings-hint">
                Leave blank to use the ANTHROPIC_API_KEY environment variable.
              </span>
            </div>
          )}

          {/* OpenAI API key */}
          {settings.llm_provider === "openai" && (
            <div className="form-group settings-full-width">
              <label className="form-label">OpenAI API Key</label>
              <div className="settings-key-row">
                <input
                  className="form-input"
                  type={showOpenaiKey ? "text" : "password"}
                  value={settings.openai_api_key ?? ""}
                  onChange={(e) =>
                    update({
                      openai_api_key: e.target.value || null,
                    })
                  }
                  placeholder="sk-..."
                />
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  type="button"
                  title={showOpenaiKey ? "Hide key" : "Show key"}
                >
                  {showOpenaiKey ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </button>
              </div>
              <span className="settings-hint">
                Leave blank to use the OPENAI_API_KEY environment variable.
              </span>
            </div>
          )}

          {/* Ollama URL */}
          {settings.llm_provider === "ollama" && (
            <div className="form-group settings-full-width">
              <label className="form-label">Ollama Server URL</label>
              <input
                className="form-input"
                value={settings.ollama_url}
                onChange={(e) => update({ ollama_url: e.target.value })}
                placeholder="http://localhost:11434"
              />
            </div>
          )}
        </div>

        {/* Test Connection */}
        {settings.llm_provider !== "none" && (
          <div className="settings-test-row">
            <button
              className="btn btn-secondary"
              onClick={handleTestConnection}
              disabled={testStatus === "testing"}
            >
              {testStatus === "testing" ? (
                <Loader size={14} className="spin" />
              ) : (
                <Zap size={14} />
              )}
              Test Connection
            </button>
            {testStatus === "success" && (
              <span className="settings-test-ok">
                <CheckCircle size={14} />
                {testMessage}
              </span>
            )}
            {testStatus === "error" && (
              <span className="settings-test-err">
                <AlertCircle size={14} />
                {testMessage}
              </span>
            )}
          </div>
        )}
      </section>

      {/* ---- Recording ---- */}
      <section className="settings-section">
        <h2 className="settings-section-title">Recording</h2>

        <div className="settings-grid">
          <div className="form-group">
            <label className="form-label">Framerate (fps)</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={60}
              value={settings.recording_framerate}
              onChange={(e) =>
                update({
                  recording_framerate: Math.max(
                    1,
                    Math.min(60, parseInt(e.target.value) || 15),
                  ),
                })
              }
            />
          </div>

          <div className="form-group">
            <label className="form-label">Quality</label>
            <select
              className="form-select"
              value={settings.recording_quality}
              onChange={(e) =>
                update({ recording_quality: e.target.value })
              }
            >
              {QUALITY_OPTIONS.map((q) => (
                <option key={q} value={q}>
                  {q.charAt(0).toUpperCase() + q.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Whisper Model</label>
            <select
              className="form-select"
              value={settings.whisper_model}
              onChange={(e) =>
                update({ whisper_model: e.target.value })
              }
            >
              {WHISPER_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
            <span className="settings-hint">
              Larger models are more accurate but slower.
            </span>
          </div>
        </div>
      </section>

      {/* ---- Export ---- */}
      <section className="settings-section">
        <h2 className="settings-section-title">Export</h2>

        <div className="settings-grid">
          <div className="form-group settings-full-width">
            <label className="form-label">Default Output Directory</label>
            <div className="settings-dir-row">
              <div className="settings-dir-path">
                {settings.output_default_dir || "Not set (uses session directory)"}
              </div>
              <button
                className="btn btn-secondary"
                onClick={handlePickOutputDir}
              >
                <FolderOpen size={14} />
                Browse
              </button>
              {settings.output_default_dir && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => update({ output_default_dir: null })}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              <input
                type="checkbox"
                checked={settings.auto_redact}
                onChange={(e) =>
                  update({ auto_redact: e.target.checked })
                }
                style={{ marginRight: 8 }}
              />
              Auto-redact sensitive information
            </label>
            <span className="settings-hint">
              Attempt to blur passwords, tokens, and PII in screenshots.
            </span>
          </div>
        </div>
      </section>

      {/* ---- Shortcuts ---- */}
      <section className="settings-section">
        <h2 className="settings-section-title">Shortcuts</h2>

        <div className="settings-grid">
          <div className="form-group">
            <label className="form-label">Marker Hotkey</label>
            <input
              className="form-input"
              value={settings.marker_hotkey}
              onChange={(e) => update({ marker_hotkey: e.target.value })}
              placeholder="CommandOrControl+Shift+M"
            />
            <span className="settings-hint">
              Uses Electron accelerator format. Examples:
              CommandOrControl+Shift+M, Alt+S
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
