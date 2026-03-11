import type { CaptureEvent } from "../lib/tauri";
import type { EditableStep } from "../stores/reviewStore";

interface TimelineProps {
  steps: EditableStep[];
  events: CaptureEvent[];
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function eventTypeClass(type: string): string {
  switch (type) {
    case "click":
      return "is-click";
    case "marker":
      return "is-marker";
    case "key_press":
    case "key_release":
      return "is-key";
    default:
      return "";
  }
}

function eventLabel(event: CaptureEvent): string {
  switch (event.type) {
    case "click":
      return `Click${event.button ? ` (${event.button})` : ""}${
        event.window_title ? ` in ${event.window_title}` : ""
      }`;
    case "key_press":
      return `Key: ${event.key ?? "unknown"}`;
    case "marker":
      return event.key ? `Marker: ${event.key}` : "Marker";
    case "scroll":
      return "Scroll";
    case "window_change":
      return `Window: ${event.window_title ?? "unknown"}`;
    default:
      return event.type;
  }
}

export default function Timeline({
  steps,
  events,
  selectedStepId,
  onSelectStep,
}: TimelineProps) {
  // Group events by step
  const stepsWithEvents = steps.map((step) => {
    const stepEvents = events.filter(
      (e) => e.t_ms >= step.t_start_ms && e.t_ms <= step.t_end_ms
    );
    // Limit visible events per step to prevent overload
    const visibleEvents = stepEvents
      .filter(
        (e) =>
          e.type === "click" ||
          e.type === "marker" ||
          e.type === "key_press" ||
          e.type === "window_change"
      )
      .slice(0, 20);
    return { step, events: visibleEvents };
  });

  return (
    <div className="timeline">
      {stepsWithEvents.map(({ step, events: stepEvents }) => (
        <div
          key={step.step_id}
          className={`timeline-step-region ${
            step.step_id === selectedStepId ? "active" : ""
          }`}
          onClick={() => onSelectStep(step.step_id)}
        >
          <div className="timeline-step-region-header">
            <span className="timeline-step-region-title">
              {step.title}
            </span>
            <span className="timeline-step-region-time">
              {formatMs(step.t_start_ms)}
            </span>
          </div>

          {stepEvents.length > 0 && (
            <div className="timeline-track">
              {stepEvents.map((event, i) => (
                <div
                  key={`${event.t_ms}-${i}`}
                  className={`timeline-event ${eventTypeClass(event.type)}`}
                >
                  <span className="timeline-event-time">
                    {formatMs(event.t_ms)}
                  </span>
                  <span className="timeline-event-content">
                    {eventLabel(event)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {steps.length === 0 && (
        <div
          style={{
            padding: "24px 12px",
            textAlign: "center",
            color: "var(--text-tertiary)",
            fontSize: 13,
          }}
        >
          No steps to display
        </div>
      )}
    </div>
  );
}
