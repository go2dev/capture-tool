#!/usr/bin/env python3
"""Audio transcription worker using Whisper."""
import json
import sys
from pathlib import Path


def transcribe_audio(audio_path: str, output_path: str):
    """Transcribe audio file and output timestamped transcript."""
    try:
        import whisper
    except ImportError:
        # Fallback: generate placeholder transcript for development
        print("Whisper not installed, generating placeholder transcript", file=sys.stderr)
        transcript = {
            "text": "",
            "segments": [],
            "language": "en",
        }
        Path(output_path).write_text(json.dumps(transcript, indent=2))
        return

    model = whisper.load_model("base")
    result = model.transcribe(
        audio_path,
        language="en",
        word_timestamps=True,
        verbose=False,
    )

    segments = []
    for seg in result.get("segments", []):
        segment = {
            "id": seg["id"],
            "start": seg["start"],
            "end": seg["end"],
            "text": seg["text"].strip(),
            "words": [],
        }
        for word in seg.get("words", []):
            segment["words"].append(
                {
                    "word": word["word"].strip(),
                    "start": word["start"],
                    "end": word["end"],
                    "probability": word.get("probability", 0),
                }
            )
        segments.append(segment)

    transcript = {
        "text": result.get("text", "").strip(),
        "segments": segments,
        "language": result.get("language", "en"),
    }

    Path(output_path).write_text(json.dumps(transcript, indent=2))
    print(f"Transcription complete: {len(segments)} segments", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: transcribe.py <audio_path> <output_path>", file=sys.stderr)
        sys.exit(1)
    transcribe_audio(sys.argv[1], sys.argv[2])
