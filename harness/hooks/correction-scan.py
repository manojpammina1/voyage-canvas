#!/usr/bin/env python3
"""
Titan — Refusal + self-correction scan (Stop hook).

Fires when Claude finishes a turn. Reads the transcript (the ONLY hook besides
stop-usage-capture.py that inspects assistant OUTPUT) to detect two signals that
are only visible in what Claude actually said:

  1. REFUSAL (avoided side). Claude declined to guess and said "I cannot confirm
     this" (the org accuracy directive). That is the framework catching a potential
     hallucination BEFORE it shipped → emit `_hook_block{category:"refusal-unverified"}`
     so it flows into the existing avoided-count tiles (S2dRisk) for free.

  2. SELF-CORRECTION (incurred side, low confidence). Claude corrected its own
     earlier answer in-session ("I was wrong", "correction:"). The user asked for
     this to be counted, but automatic detection is FP-prone, so it is emitted as
     a low-confidence `_correction{signal:"self_correction"}` — the dashboard shows
     it as an annotated spike, never in the fact headline or the alert.

────────────────────────────────────────────────────────────────────────────
SECURITY CONTRACT — METADATA ONLY (do not weaken):
  The transcript contains full prompts, responses, file contents, secrets/PII.
  This hook builds a lowercase probe of assistant TEXT for substring matching
  ONLY, and emits ONLY: a signal label, a confidence label, a hashed user id, a
  session id, and a message-id set in the cursor. It NEVER stores, logs, or emits
  any message content. Modeled on stop-usage-capture.py's field-scoped extraction.
────────────────────────────────────────────────────────────────────────────

Dedup: byte-offset cursor + per-session message.id set (Claude Code writes
multiple records per assistant message). Separate cursor file from the usage hook
so the two never clobber each other. Fail-silent; never blocks.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def workspace_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


def hashed_user(workspace: Path) -> str:
    if titan_config:
        try:
            return titan_config.hashed_user(workspace)
        except Exception:
            pass
    salt = "TITAN-DEFAULT-SALT"
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "anon"
    return hashlib.sha256(f"{salt}:{user}".encode()).hexdigest()[:16]


def is_disabled(workspace: Path) -> bool:
    if (workspace / ".no-telemetry").exists():
        return True
    if os.environ.get("CLAUDE_TELEMETRY", "").lower() in ("off", "0", "false", "disabled"):
        return True
    try:
        sj = workspace / ".claude" / "settings.local.json"
        if sj.exists():
            cfg = json.loads(sj.read_text(encoding="utf-8"))
            if str((cfg.get("env") or {}).get("CLAUDE_TELEMETRY", "")).lower() in ("off", "0", "false", "disabled"):
                return True
    except Exception:
        pass
    return False


# ── Detection phrase sets — matched against a local probe, never stored ─────
_REFUSAL_MARKERS = (
    "i cannot confirm this",
    "i cannot confirm",
    "i can't confirm this",
    "cannot verify that",
    "i am not able to verify",
    "i'm not able to verify",
    "unable to verify this",
)
_SELF_CORRECTION_MARKERS = (
    "i was wrong",
    "i made a mistake",
    "i made an error",
    "correction:",
    "let me correct",
    "that was incorrect",
    "my previous answer was wrong",
    "i gave you incorrect",
    "apologies, that was wrong",
)


def _assistant_text(msg: dict) -> str:
    """Concatenate assistant text blocks for MATCHING ONLY. Return lowercased.
    Caller discards the return value after substring checks — never persisted."""
    out: list[str] = []
    content = msg.get("content")
    if isinstance(content, str):
        out.append(content)
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text")
                if isinstance(t, str):
                    out.append(t)
    return " ".join(out).lower()


# ── Cursor (byte offset + seen message ids) — separate file from usage hook ──
def _load_cursor(tel: Path, sid: str) -> tuple[dict, Path, int, set]:
    cf = tel / ".correction-scan-cursor.json"
    data: dict = {}
    try:
        if cf.exists():
            data = json.loads(cf.read_text(encoding="utf-8")) or {}
    except Exception:
        data = {}
    ent = data.get(sid)
    if isinstance(ent, dict):
        return data, cf, int(ent.get("o", 0) or 0), set(ent.get("ids", []) or [])
    return data, cf, 0, set()


def _save_cursor(cf: Path, data: dict, sid: str, offset: int, seen: set) -> None:
    try:
        ids = list(seen)
        if len(ids) > 20000:
            ids = ids[-20000:]
        data[sid] = {"o": offset, "ids": ids}
        cf.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    except Exception:
        pass


def write_event(workspace: Path, event: dict) -> None:
    try:
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, separators=(",", ":")) + "\n")
    except Exception:
        pass


def main() -> int:
    workspace = workspace_root()
    if is_disabled(workspace):
        return 0

    payload: dict = {}
    try:
        if not sys.stdin.isatty():
            raw = sys.stdin.read()
            if raw.strip():
                payload = json.loads(raw)
    except Exception:
        return 0

    tp = payload.get("transcript_path")
    if not tp:
        return 0
    tpath = Path(tp)
    if not tpath.is_file():
        return 0

    sid = (str(payload.get("session_id", "")) or "noop")[:32]
    tel = workspace / ".claude" / "telemetry"
    try:
        tel.mkdir(parents=True, exist_ok=True)
    except Exception:
        return 0

    data, cf, offset, seen = _load_cursor(tel, sid)

    try:
        size = tpath.stat().st_size
        if offset > size:          # transcript rotated/truncated → restart
            offset = 0
        with tpath.open("rb") as fh:
            fh.seek(offset)
            chunk = fh.read()
            new_offset = fh.tell()
    except Exception:
        return 0

    role = os.environ.get("CLAUDE_ROLE", "unknown")
    user = hashed_user(workspace)

    for line in chunk.split(b"\n"):
        if not line.strip():
            continue
        try:
            rec = json.loads(line.decode("utf-8", "ignore"))
        except Exception:
            continue
        if rec.get("type") != "assistant":
            continue
        msg = rec.get("message") or {}
        mid = str(msg.get("id") or "")
        if mid and mid in seen:
            continue

        probe = _assistant_text(msg)   # local only — discarded after the checks below
        if not probe:
            if mid:
                seen.add(mid)
            continue

        if any(m in probe for m in _REFUSAL_MARKERS):
            # Avoided side — reuse the _hook_block shape so S2dRisk counts it.
            write_event(workspace, {
                "v": 1, "ts": _now(), "user": user, "role": role,
                "tool": "_hook_block", "session": sid,
                "meta": {"category": "refusal-unverified", "action": "refused"},
            })
        if any(m in probe for m in _SELF_CORRECTION_MARKERS):
            write_event(workspace, {
                "v": 1, "ts": _now(), "user": user, "role": role,
                "tool": "_correction", "session": sid,
                "meta": {"signal": "self_correction", "confidence": "low",
                         "detect_method": "transcript_selfcorrect"},
            })

        if mid:
            seen.add(mid)

    _save_cursor(cf, data, sid, new_offset, seen)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
