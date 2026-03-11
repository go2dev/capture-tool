#!/usr/bin/env python3
"""MDX document generator.

Reads session data (steps.json, transcript.json, session.json) and
produces Docusaurus-compatible MDX output.
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from textwrap import dedent


def load_json(path: Path):
    if path.exists():
        return json.loads(path.read_text())
    return None


def rewrite_step_with_llm(step: dict, transcript_excerpt: str) -> dict:
    """Use Claude to rewrite a step into documentation prose.

    Falls back to rule-based rewriting if API unavailable.
    """
    try:
        import anthropic

        client = anthropic.Anthropic()

        prompt = f"""You are writing procedural documentation for an internal software tool.
Rewrite this step as a clear, concise instruction.

Step context:
- Title: {step.get('title', 'Untitled')}
- Detected actions: {json.dumps(step.get('detected_actions', []))}
- Transcript excerpt: {transcript_excerpt}
- Time range: {step.get('t_start_ms', 0)}ms - {step.get('t_end_ms', 0)}ms

Rules:
- Use imperative voice ("Click", "Enter", "Select")
- One concise instruction sentence
- Bold any UI labels: **Label**
- Do not mention timing or narration
- Prefer visible labels over inferred ones
- If confidence is low, mark the instruction with [REVIEW]

Return JSON with these fields:
- title: action-oriented title (short)
- instruction: one clear instruction sentence
- note: optional explanatory note (or null)
- expected_outcome: what the user should see after this step (or null)
- needs_gif: boolean, true only if motion is needed to understand the action"""

        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = message.content[0].text
        # Try to parse JSON from response
        if "```json" in response_text:
            json_str = response_text.split("```json")[1].split("```")[0]
        elif "```" in response_text:
            json_str = response_text.split("```")[1].split("```")[0]
        else:
            json_str = response_text

        return json.loads(json_str.strip())

    except Exception as e:
        print(f"LLM rewrite unavailable ({e}), using rule-based fallback", file=sys.stderr)
        return rule_based_rewrite(step, transcript_excerpt)


def rule_based_rewrite(step: dict, transcript_excerpt: str) -> dict:
    """Fallback rule-based step rewriting."""
    title = step.get("title", "Step")
    actions = step.get("detected_actions", [])

    # Try to build instruction from actions
    instruction_parts = []
    for action in actions[:3]:
        if action.get("type") == "click":
            ctx = action.get("context", "")
            if ctx:
                instruction_parts.append(f"Click in **{ctx}**")
            else:
                instruction_parts.append("Click the target element")
        elif action.get("type") == "keypress":
            key = action.get("key", "")
            if key:
                instruction_parts.append(f"Press `{key}`")

    instruction = ". ".join(instruction_parts) if instruction_parts else ""

    # Use transcript if no actions
    if not instruction and transcript_excerpt:
        instruction = transcript_excerpt[:200]

    return {
        "title": title,
        "instruction": instruction or f"Complete this step in the application.",
        "note": None,
        "expected_outcome": None,
        "needs_gif": False,
    }


def generate_frontmatter(session: dict, steps: list) -> str:
    """Generate MDX frontmatter."""
    title = session.get("title", "Untitled Guide")
    now = datetime.utcnow().strftime("%Y-%m-%d")

    return dedent(f"""\
    ---
    title: "{title}"
    description: "Step-by-step guide generated from screen capture"
    tags: [internal, generated]
    sidebar_position: 1
    last_generated: "{now}"
    source_session: "{session.get('session_id', '')}"
    ---
    """)


def generate_mdx(session_dir: str):
    """Main MDX generation."""
    session_path = Path(session_dir)

    # Load data
    steps = load_json(session_path / "steps.json") or []
    transcript = load_json(session_path / "transcript.json")
    session_manifest = load_json(session_path / "session.json")

    if not session_manifest:
        session_manifest = {
            "session_id": session_path.name,
            "title": session_path.name.replace("_", " ").title(),
        }

    # Rewrite each step
    rewritten_steps = []
    for step in steps:
        excerpt = step.get("transcript_excerpt", "")
        rewritten = rewrite_step_with_llm(step, excerpt)
        rewritten["step_id"] = step.get("step_id", "")
        rewritten["t_start_ms"] = step.get("t_start_ms", 0)
        rewritten["t_end_ms"] = step.get("t_end_ms", 0)
        rewritten["confidence"] = step.get("confidence", 0)
        rewritten["review_required"] = step.get("review_required", True)
        rewritten_steps.append(rewritten)

    # Build MDX
    mdx_parts = []

    # Frontmatter
    mdx_parts.append(generate_frontmatter(session_manifest, rewritten_steps))

    # Intro
    title = session_manifest.get("title", "Guide")
    mdx_parts.append(f"# {title}\n")
    mdx_parts.append("")

    # Prerequisites
    mdx_parts.append("## Before you begin\n")
    mdx_parts.append("Ensure you have access to the application and appropriate permissions.\n")
    mdx_parts.append("")

    # Steps
    mdx_parts.append("## Steps\n")

    for i, step in enumerate(rewritten_steps, 1):
        step_title = step.get("title", f"Step {i}")
        instruction = step.get("instruction", "")
        note = step.get("note")
        expected = step.get("expected_outcome")
        review = step.get("review_required", False)
        confidence = step.get("confidence", 0)

        # Step heading
        review_marker = " ⚠️" if review else ""
        mdx_parts.append(f"### {i}. {step_title}{review_marker}\n")
        mdx_parts.append(f"{instruction}\n")

        # Screenshot
        screenshot_file = f"step-{i:02d}.png"
        assets_dir = session_path / "assets"
        if (assets_dir / screenshot_file).exists():
            mdx_parts.append(f"![{step_title}](./assets/{screenshot_file})\n")

        # GIF if needed
        gif_file = f"step-{i:02d}.gif"
        if step.get("needs_gif") and (assets_dir / gif_file).exists():
            mdx_parts.append(f'<img src={{require("./assets/{gif_file}").default}} alt="{step_title}" />\n')

        # Note
        if note:
            mdx_parts.append(f":::note\n{note}\n:::\n")

        # Expected outcome
        if expected:
            mdx_parts.append(f"**Expected:** {expected}\n")

        mdx_parts.append("")

    # Troubleshooting
    mdx_parts.append("## Troubleshooting\n")
    mdx_parts.append("If you encounter issues:\n")
    mdx_parts.append("- Verify you have the required permissions")
    mdx_parts.append("- Check that you are using the correct application version")
    mdx_parts.append("- Contact your administrator for assistance\n")

    # Write MDX
    mdx_content = "\n".join(mdx_parts)
    output_path = session_path / "output.mdx"
    output_path.write_text(mdx_content)

    # Write sidecar JSON for re-editing
    sidecar = {
        "session_id": session_manifest.get("session_id", ""),
        "generated_at": datetime.utcnow().isoformat(),
        "steps": rewritten_steps,
        "source_files": {
            "events": "events.json",
            "transcript": "transcript.json",
            "steps": "steps.json",
        },
    }
    (session_path / "output.sidecar.json").write_text(json.dumps(sidecar, indent=2))

    print(f"MDX generated: {output_path}", file=sys.stderr)
    print(f"Steps: {len(rewritten_steps)}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: generate_mdx.py <session_dir>", file=sys.stderr)
        sys.exit(1)
    generate_mdx(sys.argv[1])
