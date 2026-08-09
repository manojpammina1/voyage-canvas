"""
Shared helper for emitting telemetry events from security hooks.
Import and call emit_hook_block() when a hook blocks or warns.

Usage in any hook:
    from telemetry_emit import emit_hook_block
    emit_hook_block(workspace_path, category, action, role)
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None


def _hashed_user(workspace: Path) -> str:
    if titan_config:
        try:
            return titan_config.hashed_user(workspace)
        except Exception:
            pass
    salt = "TITAN-DEFAULT-SALT"
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "anon"
    return hashlib.sha256(f"{salt}:{user}".encode()).hexdigest()[:16]


def emit_hook_block(
    workspace: Path,
    category: str,      # "protected-path" | "credential" | "phi" | "skill-lock" | "mcp-unapproved"
    action: str,        # "blocked" | "warned"
    role: str = "",
    session: str = "",
) -> None:
    """
    Emit a _hook_block telemetry event.
    Captures WHAT category of rule fired and whether it blocked or warned.
    Never captures the content that triggered it.
    """
    workspace = Path(workspace)
    if (workspace / ".no-telemetry").exists(): return
    if os.environ.get("CLAUDE_TELEMETRY", "").lower() in ("off", "0", "false"): return

    event = {
        "v": 1,
        "ts": _dt.datetime.utcnow().isoformat() + "Z",
        "user": _hashed_user(workspace),
        "role": role or os.environ.get("CLAUDE_ROLE", "unknown"),
        "tool": "_hook_block",
        "session": session or os.environ.get("CLAUDE_SESSION_ID", "")[:32],
        "meta": {
            "category": category,   # what rule fired
            "action":   action,     # blocked | warned
        },
    }
    try:
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, separators=(",", ":")) + "\n")
    except Exception:
        pass
