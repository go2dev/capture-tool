import { invoke } from "@tauri-apps/api/core";

// ---- Types matching Rust models ----

export type SourceMode = "screen_only" | "screen_browser" | "screen_accessibility";

export type SessionStatus =
  | "created"
  | "recording"
  | "recorded"
  | "processing"
  | "processed"
  | "reviewed"
  | "exported"
  | "error";

export interface Session {
  session_id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  source_mode: SourceMode;
  video_path: string | null;
  audio_path: string | null;
  event_log_path: string | null;
  transcript_path: string | null;
  output_dir: string | null;
  status: SessionStatus;
}

export type EventType =
  | "click"
  | "key_press"
  | "key_release"
  | "scroll"
  | "move"
  | "window_change"
  | "marker";

export interface DomHint {
  tag: string | null;
  text: string | null;
  selector: string | null;
}

export interface CaptureEvent {
  t_ms: number;
  type: EventType;
  x: number | null;
  y: number | null;
  button: string | null;
  key: string | null;
  window_title: string | null;
  app_name: string | null;
  dom_hint: DomHint | null;
}

export interface Step {
  step_id: string;
  t_start_ms: number;
  t_end_ms: number;
  title: string;
  instruction: string;
  screenshot: string | null;
  gif: string | null;
  confidence: number;
  review_required: boolean;
}

export interface ExportSpec {
  doc_path: string;
  assets_dir: string;
  slug: string;
}

export interface SessionManifest {
  session: Session;
  steps: Step[];
  export: ExportSpec | null;
}

export type ProcessingStage =
  | "idle"
  | "extracting_audio"
  | "transcribing"
  | "normalizing_events"
  | "segmenting_steps"
  | "extracting_frames"
  | "generating_gifs"
  | "writing_doc"
  | "complete"
  | "error";

export interface ProcessingProgress {
  stage: ProcessingStage;
  progress: number;
  message: string;
}

export type RecordingStatusValue = "idle" | "recording" | "stopping" | "error";

export interface RecordingStatusResponse {
  status: RecordingStatusValue;
  session_id: string | null;
  elapsed_seconds: number | null;
}

// ---- Tauri command wrappers ----

export async function createSession(
  title: string,
  sourceMode: SourceMode
): Promise<Session> {
  return invoke<Session>("create_session", {
    title,
    sourceMode: sourceMode,
  });
}

export async function getSession(sessionId: string): Promise<Session> {
  return invoke<Session>("get_session", { sessionId });
}

export async function listSessions(): Promise<Session[]> {
  return invoke<Session[]>("list_sessions");
}

export async function deleteSession(sessionId: string): Promise<void> {
  return invoke<void>("delete_session", { sessionId });
}

export async function setOutputDir(
  sessionId: string,
  outputDir: string
): Promise<void> {
  return invoke<void>("set_output_dir", { sessionId, outputDir });
}

export async function startRecording(
  sessionId: string,
  captureWindow?: string
): Promise<void> {
  return invoke<void>("start_recording", { sessionId, captureWindow });
}

export async function stopRecording(): Promise<string> {
  return invoke<string>("stop_recording");
}

export async function getRecordingStatus(): Promise<RecordingStatusResponse> {
  return invoke<RecordingStatusResponse>("get_recording_status");
}

export async function addMarker(label?: string): Promise<void> {
  return invoke<void>("add_marker", { label });
}

export async function getEvents(
  sessionId: string
): Promise<CaptureEvent[]> {
  return invoke<CaptureEvent[]>("get_events", { sessionId });
}

export async function processSession(sessionId: string): Promise<void> {
  return invoke<void>("process_session", { sessionId });
}

export async function getProcessingStatus(
  sessionId: string
): Promise<ProcessingProgress> {
  return invoke<ProcessingProgress>("get_processing_status", { sessionId });
}

export async function extractFrames(
  sessionId: string,
  timestampsMs: number[]
): Promise<string[]> {
  return invoke<string[]>("extract_frames", { sessionId, timestampsMs });
}

export async function generateMdx(sessionId: string): Promise<string> {
  return invoke<string>("generate_mdx", { sessionId });
}

// ---- Settings types ----

export type LlmProvider = "anthropic" | "openai" | "ollama" | "none";

export interface Settings {
  llm_provider: LlmProvider;
  llm_model: string;
  anthropic_api_key: string | null;
  openai_api_key: string | null;
  ollama_url: string;
  whisper_model: string;
  output_default_dir: string | null;
  recording_framerate: number;
  recording_quality: string;
  marker_hotkey: string;
  auto_redact: boolean;
}

// ---- Settings command wrappers ----

export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function saveSettings(settings: Settings): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

export async function getSetting(key: string): Promise<unknown> {
  return invoke<unknown>("get_setting", { key });
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  return invoke<void>("set_setting", { key, value });
}
