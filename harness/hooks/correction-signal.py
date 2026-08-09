#!/usr/bin/env python3
"""
Titan — Correction signal + hallucination-spiral circuit-breaker
(UserPromptSubmit hook).

Two jobs, both fired the moment the developer submits a prompt (BEFORE Claude
responds):

  1. DETECTION (telemetry). Classify whether this prompt is a "correction" — the
     developer telling Claude its last answer was wrong. Emit a `_correction`
     event with the signal TYPE and a coarse category. NEVER stores prompt text
     (mirrors cost-estimate.py: reads the prompt, stores only a label).

  2. CONTAINMENT (circuit-breaker). Count consecutive corrections in the session.
     Left unchecked a hallucination loop worsens — the failed attempts accumulate
     in-context and anchor Claude on the wrong path ("context poisoning"). This
     hook breaks the loop live:
       - warn_count  consecutive → a visible notice to the developer (stderr)
       - break_count consecutive, OR episode cost ≥ episode_cost_break_usd
                     → inject a directive Claude sees THIS turn (stdout JSON
                       additionalContext) forcing it to stop guessing, state what
                       it can't confirm, ask for concrete inputs, and offer /clear
                       + /debug + escalation.
     Any clean (non-correction) prompt resets the counter, so ordinary iteration
     never trips it. The breaker NEVER hard-blocks — it only adds guidance
     (exit 0 always).

Shares .claude/telemetry/.correction-state.json with telemetry-capture.py, which
maintains `tool_error_run` (consecutive failed Edit/Read = the AI hallucinating
code/files). Both counters feed the spiral level.

Escalation contacts come from titan.config.json (via titan_config.py), never
from pricing.json — pricing.json is purely commercial/tuning data.

Privacy: metadata only. Fail-silent on every error. Never blocks a prompt.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None


# ── Workspace / identity / opt-out (same contract as the other hooks) ───────
def _now() -> str:
    # Timezone-aware UTC with a trailing "Z" — matches the other hooks' event ts
    # format while avoiding the datetime.utcnow() DeprecationWarning (this hook
    # writes to stderr, so a stray warning would be visible to the developer).
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


def load_pricing(workspace: Path) -> dict:
    for p in (workspace / ".claude" / "pricing.json", workspace / "pricing.json"):
        try:
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def read_user_prompt() -> str:
    """UserPromptSubmit delivers the prompt as JSON on stdin (env fallback)."""
    try:
        if not sys.stdin.isatty():
            data = sys.stdin.read()
            if data:
                try:
                    parsed = json.loads(data)
                    if isinstance(parsed, dict):
                        return str(parsed.get("prompt") or parsed.get("user_prompt") or parsed.get("message") or "")
                except json.JSONDecodeError:
                    return data
    except Exception:
        pass
    for env in ("CLAUDE_USER_PROMPT", "CLAUDE_TOOL_INPUT"):
        v = os.environ.get(env, "")
        if v:
            return v
    return ""


def session_id() -> str:
    return (os.environ.get("CLAUDE_SESSION_ID", "") or "noop")[:32]


# ── Correction classification — TYPE + coarse category only, never text ─────
# Explicit flag = human ground truth (highest confidence). Phrase heuristics are
# medium confidence: kept reasonably specific, but false positives are low-harm
# because the counter resets on the next clean turn.
_EXPLICIT_FLAGS = ("!wrong", "/flag-wrong", "#wrong")

# Phrases are stored APOSTROPHE-FREE; the prompt is normalised the same way before
# matching, so "doesnt work" and "doesn't work" both hit (real prompts often drop
# apostrophes). Matching is a coarse hallucination proxy, not a content capture.
_PHRASE_CATEGORIES = [
    ("nonexistent_file", (
        "doesnt exist", "does not exist", "no such file", "that file isnt",
        "made that up", "you made up", "you invented", "hallucinat",
    )),
    ("fabricated_api", (
        "no such method", "no such function", "not a function", "invalid property",
        "there is no such", "that method doesnt", "that api doesnt",
    )),
    ("still_failing", (
        "still failing", "still broken", "still not working", "still errors",
        "doesnt work", "does not work", "not working", "same error", "didnt work",
    )),
    ("wrong_output", (
        "thats wrong", "this is wrong", "that is wrong",
        "not correct", "incorrect", "wrong answer", "thats not right",
        "that is not right", "not what i asked",
    )),
]


def _norm(text: str) -> str:
    """Lowercase + strip apostrophes (straight and curly) for match tolerance."""
    return text.strip().lower().replace("'", "").replace("’", "")


def classify_correction(prompt: str) -> tuple[str, str, str] | None:
    """Return (signal, confidence, category) or None if this is NOT a correction.
    Never returns prompt text."""
    p = _norm(prompt)
    if not p:
        return None
    if any(p.startswith(_norm(f)) or _norm(f) in p[:24] for f in _EXPLICIT_FLAGS):
        return ("explicit_flag", "high", "explicit")
    for category, phrases in _PHRASE_CATEGORIES:
        if any(ph in p for ph in phrases):
            return ("followup_phrase", "medium", category)
    return None


# ── Shared per-session breaker state (.correction-state.json) ───────────────
def _state_path(workspace: Path) -> Path:
    return workspace / ".claude" / "telemetry" / ".correction-state.json"


def load_state(workspace: Path, sid: str) -> dict:
    try:
        sf = _state_path(workspace)
        if sf.exists():
            data = json.loads(sf.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get(sid), dict):
                return data[sid]
    except Exception:
        pass
    return {}


def save_state(workspace: Path, sid: str, ent: dict) -> None:
    try:
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        sf = _state_path(workspace)
        data = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else {}
        if not isinstance(data, dict):
            data = {}
        data[sid] = ent
        sf.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    except Exception:
        pass


def episode_cost_usd(workspace: Path, sid: str, since_iso: str) -> float:
    """FACT: sum real billed cost_usd from today's _actual_usage events for this
    session since the episode started. Best-effort; 0.0 if unreadable."""
    total = 0.0
    try:
        f = workspace / ".claude" / "telemetry" / f"events-{_dt.date.today().isoformat()}.jsonl"
        if not f.exists():
            return 0.0
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            if '"_actual_usage"' not in line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if ev.get("tool") != "_actual_usage":
                continue
            if ev.get("session") and ev.get("session") != sid:
                continue
            if since_iso and str(ev.get("ts", "")) < since_iso:
                continue
            total += float((ev.get("meta") or {}).get("cost_usd", 0) or 0)
    except Exception:
        pass
    return total


# ── Telemetry emit ──────────────────────────────────────────────────────────
def emit(workspace: Path, sid: str, signal: str, confidence: str,
         category: str = "", consecutive: int | None = None) -> None:
    ev = {
        "v": 1,
        "ts": _now(),
        "user": hashed_user(workspace),
        "role": os.environ.get("CLAUDE_ROLE", "unknown"),
        "tool": "_correction",
        "session": sid,
        "meta": {"signal": signal, "confidence": confidence, "detect_method": "prompt"},
    }
    if category:
        ev["meta"]["category"] = category
    if consecutive is not None:
        ev["meta"]["consecutive"] = consecutive
    try:
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(ev, separators=(",", ":")) + "\n")
    except Exception:
        pass


# ── The break directive (injected into Claude's context this turn) ──────────
def break_directive(workspace: Path, level: int, cost: float, brand: str) -> str:
    owners = ""
    if titan_config:
        try:
            owners = titan_config.contacts_inline(workspace)
        except Exception:
            owners = ""
    owners = owners or "the area owner"
    return (
        f"[{brand} circuit-breaker] Hallucination-spiral detected: {level} consecutive "
        f"corrections on this thread (~${cost:.2f} spent) with no resolution.\n"
        "STOP producing another attempt. Do the following instead, per the org accuracy policy:\n"
        "1. State explicitly what you cannot confirm. Do NOT guess again. Say \"I cannot confirm this\" where true.\n"
        "2. Ask the developer for the concrete missing input: the exact error text, the actual file contents, "
        "or the failing test output — do not proceed without it.\n"
        "3. Recommend a fresh session (/clear): the prior failed attempts are poisoning this context.\n"
        "4. Recommend /debug (reproduce → trace → test-first) or /grill-me (stress-test before more code).\n"
        f"5. Offer to escalate — model (\"escalate to opus\") or a human owner: {owners}."
    )


# ── Main ─────────────────────────────────────────────────────────────────────
def main() -> int:
    # Same defensive UTF-8 reconfigure as session-start.py / gov-retrieve.py --
    # contacts_inline() can contain arrow/middle-dot characters that crash a
    # narrow-codepage Windows console on a raw stderr.write().
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    workspace = workspace_root()
    if is_disabled(workspace):
        return 0

    prompt = read_user_prompt()
    if not prompt:
        return 0

    brand = titan_config.brand(workspace) if titan_config else "Titan"
    sid = session_id()
    pricing = load_pricing(workspace)
    spiral = (pricing.get("correction", {}) or {}).get("spiral", {}) or {}
    warn_count = int(spiral.get("warn_count", 3))
    break_count = int(spiral.get("break_count", 5))
    cost_break = float(spiral.get("episode_cost_break_usd", 2.00))
    reset_clean = bool(spiral.get("reset_on_clean_turn", True))

    now = _now()
    ent = load_state(workspace, sid)
    classified = classify_correction(prompt)

    # ── Clean (non-correction) prompt → reset the episode, exit silent ──────
    if classified is None:
        if reset_clean and (ent.get("consecutive") or ent.get("tool_error_run")):
            ent["consecutive"] = 0
            ent["tool_error_run"] = 0
            ent.pop("episode_start_ts", None)
            save_state(workspace, sid, ent)
        return 0

    signal, confidence, category = classified

    # ── Correction → increment, emit, evaluate the spiral level ─────────────
    consecutive = int(ent.get("consecutive", 0)) + 1
    ent["consecutive"] = consecutive
    if not ent.get("episode_start_ts"):
        ent["episode_start_ts"] = now
    save_state(workspace, sid, ent)

    emit(workspace, sid, signal, confidence, category)

    # tool_error_run (failed Edits/Reads = AI hallucinating code/files) counts
    # toward the same loop; sum errs toward containment, which is always safe.
    tool_run = int(ent.get("tool_error_run", 0))
    level = consecutive + tool_run
    cost = episode_cost_usd(workspace, sid, ent.get("episode_start_ts", ""))

    tripped_break = level >= break_count or (cost_break > 0 and cost >= cost_break)
    tripped_warn = level >= warn_count

    if tripped_break:
        emit(workspace, sid, "spiral_break", "high", category, consecutive=level)
        directive = break_directive(workspace, level, cost, brand)
        # stderr → visible to the developer; stdout JSON → injected into Claude's context.
        sys.stderr.write("\n" + directive + "\n")
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": directive,
            }
        }))
        return 0

    if tripped_warn:
        emit(workspace, sid, "spiral_warn", "medium", category, consecutive=level)
        sys.stderr.write(
            f"\n[{brand}] {level} corrections in a row on this thread"
            f"{f', ~${cost:.2f} spent' if cost > 0 else ''} without resolution. "
            "If Claude is stuck, consider giving it the exact error/file, /debug, or a fresh /clear session.\n"
        )
        return 0

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)  # absolute fail-silent — never block a prompt
