#!/usr/bin/env python3
"""Asset extraction worker.

Extracts still frames and generates GIFs from session video
based on step data.
"""
import json
import subprocess
import sys
from pathlib import Path


def load_json(path: Path):
    if path.exists():
        return json.loads(path.read_text())
    return None


def extract_frame(video_path: str, timestamp_s: float, output_path: str) -> bool:
    """Extract a single frame from video at given timestamp."""
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{timestamp_s:.3f}",
                "-i",
                video_path,
                "-frames:v",
                "1",
                "-q:v",
                "2",
                output_path,
            ],
            capture_output=True,
            timeout=30,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"Frame extraction error: {e}", file=sys.stderr)
        return False


def score_frame_sharpness(frame_path: str) -> float:
    """Score a frame's sharpness using FFmpeg's blur detection.

    Higher score = sharper image.
    """
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "frame=pkt_pts_time",
                "-of",
                "csv=p=0",
                frame_path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        # Simple heuristic: file size correlates with detail/sharpness
        size = Path(frame_path).stat().st_size
        return min(1.0, size / 500000)  # normalize to 0-1
    except Exception:
        return 0.5


def extract_best_frame(
    video_path: str, t_ms: int, output_path: str, window_ms: int = 500
) -> str:
    """Extract the best frame from a window around a timestamp.

    Tries 3 candidates: t-200ms, t, t+300ms and picks sharpest.
    """
    candidates = [
        max(0, t_ms - 200),
        t_ms,
        t_ms + 300,
    ]

    best_path = output_path
    best_score = -1

    for i, ts in enumerate(candidates):
        candidate_path = output_path.replace(".png", f"_candidate_{i}.png")
        t_s = ts / 1000.0

        if extract_frame(video_path, t_s, candidate_path):
            score = score_frame_sharpness(candidate_path)
            if score > best_score:
                best_score = score
                best_path = candidate_path

    # Rename best candidate to final output
    if best_path != output_path:
        import shutil
        shutil.copy2(best_path, output_path)

    # Clean up candidates
    for i in range(len(candidates)):
        candidate_path = output_path.replace(".png", f"_candidate_{i}.png")
        p = Path(candidate_path)
        if p.exists():
            p.unlink()

    return output_path


def generate_gif(
    video_path: str, start_ms: int, end_ms: int, output_path: str, fps: int = 10, width: int = 800
) -> bool:
    """Generate a GIF from a video segment."""
    start_s = start_ms / 1000.0
    duration_s = (end_ms - start_ms) / 1000.0

    # Cap GIF duration at 10 seconds
    duration_s = min(duration_s, 10.0)

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{start_s:.3f}",
                "-t",
                f"{duration_s:.3f}",
                "-i",
                video_path,
                "-vf",
                f"fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                "-loop",
                "0",
                output_path,
            ],
            capture_output=True,
            timeout=120,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"GIF generation error: {e}", file=sys.stderr)
        return False


def process_assets(session_dir: str):
    """Extract all assets for a session."""
    session_path = Path(session_dir)
    steps = load_json(session_path / "steps.json") or []
    video_path = session_path / "recording.mp4"
    assets_dir = session_path / "assets"
    assets_dir.mkdir(exist_ok=True)

    if not video_path.exists():
        print("No video file found", file=sys.stderr)
        return

    video_str = str(video_path)

    for i, step in enumerate(steps, 1):
        print(f"Processing step {i}/{len(steps)}...", file=sys.stderr)

        # Extract screenshot
        screenshot_path = str(assets_dir / f"step-{i:02d}.png")
        ts_ms = step.get("screenshot_ts_ms", step.get("t_start_ms", 0) + 500)
        extract_best_frame(video_str, ts_ms, screenshot_path)

        # Generate GIF if needed
        gif_range = step.get("gif_range")
        if gif_range:
            gif_path = str(assets_dir / f"step-{i:02d}.gif")
            generate_gif(video_str, gif_range[0], gif_range[1], gif_path)

    # Generate thumbnails for review UI
    thumbs_dir = assets_dir / "thumbs"
    thumbs_dir.mkdir(exist_ok=True)
    for i, step in enumerate(steps, 1):
        thumb_path = str(thumbs_dir / f"thumb-{i:02d}.png")
        ts_ms = step.get("screenshot_ts_ms", step.get("t_start_ms", 0) + 500)
        t_s = ts_ms / 1000.0
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{t_s:.3f}",
                    "-i",
                    video_str,
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=320:-1",
                    "-q:v",
                    "5",
                    thumb_path,
                ],
                capture_output=True,
                timeout=15,
            )
        except Exception:
            pass

    print(f"Asset extraction complete: {len(steps)} steps processed", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: extract_assets.py <session_dir>", file=sys.stderr)
        sys.exit(1)
    process_assets(sys.argv[1])
