#!/usr/bin/env python3
"""Step segmentation worker.

Reads events.json and transcript.json from a session directory,
produces steps.json with candidate step boundaries.
"""
import json
import sys
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional


@dataclass
class Step:
    step_id: str
    t_start_ms: int
    t_end_ms: int
    title: str
    instruction: str
    screenshot_ts_ms: int
    gif_range: Optional[tuple] = None
    confidence: float = 0.5
    review_required: bool = True
    transcript_excerpt: str = ""
    detected_actions: list = None

    def __post_init__(self):
        if self.detected_actions is None:
            self.detected_actions = []


# Narration boundary phrases
BOUNDARY_PHRASES = {"now", "next", "then", "after that", "first", "finally", "step"}

# Minimum gap (ms) between actions to consider a boundary
MIN_PAUSE_MS = 2000

# Minimum step duration
MIN_STEP_MS = 1500

# Maximum step duration before forced split
MAX_STEP_MS = 30000


def load_json(path: Path):
    if path.exists():
        return json.loads(path.read_text())
    return None


def find_click_clusters(events: list, gap_ms: int = 1500) -> list:
    """Group clicks that happen close together into clusters."""
    clicks = [e for e in events if e.get("type") == "click"]
    if not clicks:
        return []

    clusters = []
    current_cluster = [clicks[0]]

    for click in clicks[1:]:
        if click["t_ms"] - current_cluster[-1]["t_ms"] < gap_ms:
            current_cluster.append(click)
        else:
            clusters.append(current_cluster)
            current_cluster = [click]
    clusters.append(current_cluster)

    return clusters


def find_window_changes(events: list) -> list:
    """Find timestamps where the active window changed."""
    changes = []
    last_window = None
    for e in events:
        wt = e.get("window_title")
        if wt and wt != last_window:
            changes.append({"t_ms": e["t_ms"], "window_title": wt, "app_name": e.get("app_name")})
            last_window = wt
    return changes


def find_markers(events: list) -> list:
    """Find manual markers."""
    return [e for e in events if e.get("type") == "marker"]


def find_transcript_boundaries(transcript: dict) -> list:
    """Find step boundaries from narration phrases."""
    boundaries = []
    if not transcript:
        return boundaries

    for seg in transcript.get("segments", []):
        text_lower = seg.get("text", "").lower().strip()
        for phrase in BOUNDARY_PHRASES:
            if text_lower.startswith(phrase):
                boundaries.append({
                    "t_ms": int(seg["start"] * 1000),
                    "text": seg["text"],
                    "source": "narration",
                })
                break
    return boundaries


def find_pauses(events: list) -> list:
    """Find significant pauses in activity."""
    pauses = []
    all_events = sorted(events, key=lambda e: e["t_ms"])
    for i in range(1, len(all_events)):
        gap = all_events[i]["t_ms"] - all_events[i - 1]["t_ms"]
        if gap >= MIN_PAUSE_MS:
            pauses.append({
                "t_ms": all_events[i - 1]["t_ms"],
                "gap_ms": gap,
            })
    return pauses


def get_transcript_for_range(transcript: dict, start_ms: int, end_ms: int) -> str:
    """Extract transcript text for a time range."""
    if not transcript:
        return ""
    texts = []
    for seg in transcript.get("segments", []):
        seg_start = int(seg["start"] * 1000)
        seg_end = int(seg["end"] * 1000)
        if seg_start >= start_ms and seg_end <= end_ms:
            texts.append(seg["text"].strip())
        elif seg_start < end_ms and seg_end > start_ms:
            texts.append(seg["text"].strip())
    return " ".join(texts)


def segment_session(session_dir: str):
    """Main segmentation logic."""
    session_path = Path(session_dir)
    events = load_json(session_path / "events.json") or []
    transcript = load_json(session_path / "transcript.json")

    if not events:
        # No events - create a single step for the whole recording
        steps = [asdict(Step(
            step_id="step_01",
            t_start_ms=0,
            t_end_ms=60000,
            title="Step 1",
            instruction="",
            screenshot_ts_ms=5000,
        ))]
        (session_path / "steps.json").write_text(json.dumps(steps, indent=2))
        return

    # Collect all boundary candidates with scores
    boundaries = []

    # Manual markers are strongest boundaries
    for m in find_markers(events):
        boundaries.append({"t_ms": m["t_ms"], "weight": 10, "source": "marker", "label": m.get("key")})

    # Window changes are strong boundaries
    for wc in find_window_changes(events):
        boundaries.append({"t_ms": wc["t_ms"], "weight": 7, "source": "window_change", "label": wc.get("window_title")})

    # Narration boundaries
    for nb in find_transcript_boundaries(transcript):
        boundaries.append({"t_ms": nb["t_ms"], "weight": 5, "source": "narration", "label": nb.get("text")})

    # Pauses
    for p in find_pauses(events):
        weight = min(5, p["gap_ms"] / 1000)
        boundaries.append({"t_ms": p["t_ms"], "weight": weight, "source": "pause", "label": None})

    # Click cluster boundaries
    clusters = find_click_clusters(events)
    for cluster in clusters:
        boundaries.append({"t_ms": cluster[0]["t_ms"], "weight": 3, "source": "click_cluster", "label": None})

    # Sort boundaries by time
    boundaries.sort(key=lambda b: b["t_ms"])

    # Merge nearby boundaries (within 1s)
    merged = []
    for b in boundaries:
        if merged and b["t_ms"] - merged[-1]["t_ms"] < 1000:
            if b["weight"] > merged[-1]["weight"]:
                merged[-1] = b
        else:
            merged.append(b)

    # Determine session time range
    all_times = [e["t_ms"] for e in events]
    session_start = min(all_times)
    session_end = max(all_times) + 2000  # add 2s buffer

    # Build steps from boundaries
    step_boundaries = [session_start] + [b["t_ms"] for b in merged] + [session_end]
    # Remove duplicates and sort
    step_boundaries = sorted(set(step_boundaries))

    steps = []
    step_num = 0
    for i in range(len(step_boundaries) - 1):
        t_start = step_boundaries[i]
        t_end = step_boundaries[i + 1]

        # Skip very short steps
        if t_end - t_start < MIN_STEP_MS:
            continue

        step_num += 1

        # Find the main action in this step
        step_events = [e for e in events if t_start <= e["t_ms"] < t_end]
        clicks = [e for e in step_events if e.get("type") == "click"]
        keys = [e for e in step_events if e.get("type") in ("key_press", "key_release")]

        # Default title from window or action
        title = f"Step {step_num}"
        if clicks and clicks[0].get("window_title"):
            title = clicks[0]["window_title"]
        elif step_events and step_events[0].get("window_title"):
            title = step_events[0]["window_title"]

        # Pick screenshot timestamp: 300ms after first click, or middle of step
        if clicks:
            screenshot_ts = clicks[0]["t_ms"] + 300
        else:
            screenshot_ts = t_start + (t_end - t_start) // 2

        # Get transcript for this range
        excerpt = get_transcript_for_range(transcript, t_start, t_end)

        # Determine confidence based on available signals
        confidence = 0.3
        boundary = next((b for b in merged if abs(b["t_ms"] - t_start) < 1000), None)
        if boundary:
            if boundary["source"] == "marker":
                confidence = 0.95
            elif boundary["source"] == "window_change":
                confidence = 0.85
            elif boundary["source"] == "narration":
                confidence = 0.75
            elif boundary["source"] == "pause":
                confidence = 0.6
            elif boundary["source"] == "click_cluster":
                confidence = 0.5

        detected_actions = []
        for c in clicks:
            action = {"type": "click", "t_ms": c["t_ms"]}
            if c.get("window_title"):
                action["context"] = c["window_title"]
            detected_actions.append(action)
        for k in keys[:5]:  # limit key events
            detected_actions.append({"type": "keypress", "t_ms": k["t_ms"], "key": k.get("key")})

        step = Step(
            step_id=f"step_{step_num:02d}",
            t_start_ms=t_start,
            t_end_ms=t_end,
            title=title,
            instruction="",
            screenshot_ts_ms=min(screenshot_ts, t_end - 100),
            confidence=round(confidence, 2),
            review_required=confidence < 0.7,
            transcript_excerpt=excerpt,
            detected_actions=detected_actions,
        )
        steps.append(asdict(step))

    (session_path / "steps.json").write_text(json.dumps(steps, indent=2))
    print(f"Segmentation complete: {len(steps)} steps", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: segment.py <session_dir>", file=sys.stderr)
        sys.exit(1)
    segment_session(sys.argv[1])
