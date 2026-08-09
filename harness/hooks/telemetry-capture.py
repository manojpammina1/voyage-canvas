#!/usr/bin/env python3
"""
Titan — Comprehensive usage telemetry (PostToolUse).

Captures EXACT metadata about every tool call: tool name, skill invocations,
agent spawns with model, bash programs, file path prefixes, worktree ops.

ROOT CAUSE FIX: Claude Code sends hook payloads via stdin JSON, not env vars.
Previous version read CLAUDE_TOOL_NAME env var → always "unknown". This version
reads from stdin first, falls back to env vars for older Claude Code versions.

Privacy: whitelist-only — no prompts, responses, file contents, secrets.
Fail-silent on every error. Never blocks a tool call.

Event types emitted:
  tool_name value        What it represents
  ─────────────────────────────────────────
  Edit / Write / Read    File operations (path_prefix captured, no content)
  Bash                   Shell commands (bash_program captured, no args)
  Skill                  Slash command invoked (skill_name captured)
  Agent                  Sub-agent spawn (subagent_type, model captured)
  _worktree_create       Worktree created (repo, name captured)
  _worktree_cleanup      Worktree removed (repo, name captured)
  _hook_block            Security hook fired (category, no content)
  _actual_usage          Real token counts from Stop event (see stop-usage-capture.py)
  _orchestrate_review    /orchestrate-review run (reviewers_spawned, findings_count,
                         governance, ci_gate — see orchestrate-review.md Step 6)
  _gov_retrieve          gov-retrieve.py query (kind, hit_count, latency_ms — no query text)
  _verify_gate           verify-gate.py Stop-hook run (modules, result, duration_ms)
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


def _fail_silent(fn):
    def wrapper(*a, **kw):
        try: return fn(*a, **kw)
        except Exception: return 0
    return wrapper


# ── Session + workspace ────────────────────────────────────────────────────
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
    if (workspace / ".no-telemetry").exists(): return True
    for var in ("CLAUDE_TELEMETRY",):
        if os.environ.get(var, "").lower() in ("off", "0", "false", "disabled"):
            return True
    try:
        sj = workspace / ".claude" / "settings.local.json"
        if sj.exists():
            cfg = json.loads(sj.read_text(encoding="utf-8"))
            if str((cfg.get("env") or {}).get("CLAUDE_TELEMETRY","")).lower() in ("off","0","false","disabled"):
                return True
    except Exception: pass
    return False


# ── Read hook payload — stdin first, env fallback ─────────────────────────
def read_payload() -> dict:
    """
    Claude Code sends all hook payloads as JSON on stdin.
    Older versions or some hook types also set env vars.
    We try stdin first, then env vars as fallback.
    """
    payload: dict = {}

    # Try stdin JSON
    try:
        if not sys.stdin.isatty():
            raw = sys.stdin.read()
            if raw.strip():
                payload = json.loads(raw)
    except Exception:
        pass

    return payload


def extract_tool_metadata(tool_name: str, tool_input: dict) -> dict:
    """
    Extract privacy-safe metadata from the tool input.
    Whitelist only — nothing not on this list is captured.
    """
    meta: dict = {}

    # ── File path operations (Edit, Write, Read, MultiEdit) ──────────────
    if tool_name in ("Edit", "Write", "Read", "MultiEdit", "NotebookEdit"):
        fp = tool_input.get("file_path") or tool_input.get("notebook_path", "")
        if fp and isinstance(fp, str):
            meta["path_prefix"] = _sanitise_path(fp)

    # ── Bash: program name only, never args ───────────────────────────────
    elif tool_name == "Bash":
        cmd = str(tool_input.get("command", ""))
        prog = cmd.strip().split(None, 1)[0] if cmd.strip() else ""
        prog = prog.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        if prog and not any(c in prog for c in "=<>|&;$@()"):
            meta["bash_program"] = prog[:32]
        # Detect worktree operations from script name
        if "worktree-create" in cmd:    meta["worktree_op"] = "create"
        elif "worktree-cleanup" in cmd: meta["worktree_op"] = "cleanup"
        elif "worktree-list" in cmd:    meta["worktree_op"] = "list"

    # ── Skill (slash command) ─────────────────────────────────────────────
    elif tool_name == "Skill":
        sn = str(tool_input.get("skill", "") or tool_input.get("name", ""))
        if sn and len(sn) <= 80:
            meta["skill_name"] = sn

    # ── Agent spawn ───────────────────────────────────────────────────────
    elif tool_name == "Agent":
        st = str(tool_input.get("subagent_type", "") or tool_input.get("agent_type", ""))
        model = str(tool_input.get("model", ""))
        if st and len(st) <= 64:  meta["subagent_type"] = st
        if model and len(model) <= 64: meta["agent_model"] = model

    # ── MCP tool calls ─────────────────────────────────────────────────────
    elif "__" in tool_name:
        # e.g. mcp__azure-devops__get_pull_request → mcp:azure-devops
        parts = tool_name.split("__")
        if len(parts) >= 2:
            meta["mcp_server"] = parts[1][:32]
            if len(parts) >= 3:
                meta["mcp_tool"] = parts[2][:32]

    return meta


_GENERIC_ALLOWED = {
    ".claude", ".claude-projects", "src", "test", "tests",
    "ui.frontend", "ui.config", "ui.apps", "ui.content",
    "dashboard", "harness", "electron",
}


def _sanitise_path(p: str) -> str:
    """Top-2 path components only, with allowlist prefix check. Repo names
    come from titan.config.json repos[].dir (fail-open: falls back to the
    generic, non-repo entries only if config is unavailable)."""
    allowed = set(_GENERIC_ALLOWED)
    if titan_config:
        try:
            allowed.update(titan_config.repo_dirs(workspace_root()))
        except Exception:
            pass
    ALLOWED = allowed
    normalised = p.replace("\\", "/").lstrip("/")
    if ":" in normalised[:3]: normalised = normalised.split(":", 1)[1].lstrip("/")
    parts = [s for s in normalised.split("/") if s]
    if not parts: return ""
    if parts[0] in ALLOWED:
        return "/".join(parts[:2]) + ("/..." if len(parts) > 2 else "")
    return parts[0] + ("/..." if len(parts) > 1 else "")


# ── Tool-result classification — TYPE ONLY, never stores response text ──────
# A failed Edit (old_string absent) or a Read of a missing path is the hardest
# in-session hallucination fingerprint: Claude asserted something about the code
# or filesystem that reality rejected — and it happens with no commit, so git can
# never see it. We classify the FAILURE TYPE from the tool_response for
# correlation and store ONLY that enum — never the text (an Edit error echoes the
# missing old_string; a Read error echoes the path). edit_string_not_unique is
# surfaced but NOT counted: ambiguity is not a hallucination.
_FILE_TOOLS = ("Edit", "Write", "Read", "MultiEdit", "NotebookEdit")
_COUNTED_ERRORS = ("edit_string_not_found", "file_not_found", "bash_nonzero")


def _response_is_error(resp) -> bool:
    """Best-effort structural error check. tool_response shape varies by version."""
    if isinstance(resp, dict):
        if resp.get("is_error") or resp.get("isError") or resp.get("error"):
            return True
        if resp.get("success") is False:
            return True
        for k in ("exit_code", "exitCode", "returncode", "code"):
            try:
                if resp.get(k) is not None and int(resp.get(k)) != 0:
                    return True
            except (TypeError, ValueError):
                pass
    return False


def classify_tool_result(tool_name: str, resp) -> tuple[bool, str]:
    """Return (ok, error_class). error_class '' when ok. NEVER stores resp text —
    `probe` is built for substring matching only and discarded on return."""
    try:
        probe = resp.lower() if isinstance(resp, str) else json.dumps(resp, default=str).lower()
    except Exception:
        probe = str(resp).lower()

    structural = _response_is_error(resp)
    keyword = any(kw in probe for kw in (
        "string to replace not found", "could not find the string", "no match",
        "no such file", "does not exist", "enoent", "file not found", "cannot find",
        "command not found", "not recognized as",
        "not unique", "multiple match", "matches of the string",
    ))
    if not (structural or keyword):
        return True, ""

    # Ambiguity (multiple matches) — a real failure, but NOT a hallucination.
    if any(kw in probe for kw in ("not unique", "multiple match", "matches of the string")):
        return False, "edit_string_not_unique"
    if tool_name in ("Edit", "MultiEdit") and any(
        kw in probe for kw in ("not found", "could not find", "no match")
    ):
        return False, "edit_string_not_found"
    if any(kw in probe for kw in ("no such file", "does not exist", "enoent", "file not found", "cannot find")):
        return False, "file_not_found"
    if tool_name == "Bash":
        return False, "bash_nonzero"
    return False, "tool_error"


def _update_correction_state(workspace: Path, session: str, ok: bool,
                             error_class: str, path_prefix: str, tool_name: str) -> None:
    """Maintain the per-session `tool_error_run` the UserPromptSubmit circuit-breaker
    reads. Increment on a COUNTED tool error; reset to 0 on a clean file-mutation
    success (a working Edit/Write ends the failed run). Shares
    .correction-state.json with correction-signal.py; each hook writes fail-silent."""
    try:
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        sf = tel / ".correction-state.json"
        data = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else {}
        if not isinstance(data, dict):
            data = {}
        ent = data.get(session) or {}
        if (not ok) and error_class in _COUNTED_ERRORS:
            ent["tool_error_run"] = int(ent.get("tool_error_run", 0)) + 1
            ent["last_error_ts"] = _dt.datetime.utcnow().isoformat() + "Z"
            if path_prefix:
                ent["last_error_path"] = path_prefix
        elif ok and tool_name in ("Edit", "Write", "MultiEdit"):
            ent["tool_error_run"] = 0
        else:
            return  # successful Read / uncounted error → no state change
        data[session] = ent
        sf.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    except Exception:
        pass


def write_event(workspace: Path, event: dict) -> None:
    """Append one JSON line, fail silent."""
    try:
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, separators=(",", ":")) + "\n")
    except Exception:
        pass


@_fail_silent
def main() -> int:
    workspace = workspace_root()
    if is_disabled(workspace): return 0

    payload   = read_payload()
    tool_name = (
        payload.get("tool_name")
        or payload.get("tool")
        or os.environ.get("CLAUDE_TOOL_NAME")
        or "unknown"
    )
    tool_input = payload.get("tool_input") or {}
    if isinstance(tool_input, str):
        try: tool_input = json.loads(tool_input)
        except Exception: tool_input = {}

    meta = extract_tool_metadata(tool_name, tool_input)

    session_id = (payload.get("session_id") or os.environ.get("CLAUDE_SESSION_ID", "") or "noop")[:32]

    # ── Tool success/failure — the primary in-session hallucination signal ──
    # Only when tool_response is actually present (older Claude Code versions
    # omit it — we must not fabricate ok=true when we can't observe the result).
    tool_response = payload.get("tool_response")
    if tool_response is not None and (tool_name in _FILE_TOOLS or tool_name == "Bash"):
        ok, error_class = classify_tool_result(tool_name, tool_response)
        meta["ok"] = ok
        if error_class:
            meta["error_class"] = error_class   # TYPE only — never the response text
        _update_correction_state(workspace, session_id, ok, error_class,
                                 meta.get("path_prefix", ""), tool_name)

    event = {
        "v": 1,
        "ts": _dt.datetime.utcnow().isoformat() + "Z",
        "user": hashed_user(workspace),
        "role": os.environ.get("CLAUDE_ROLE", "unknown"),
        "tool": tool_name,
        "session": session_id,
    }
    if meta:
        event["meta"] = meta

    write_event(workspace, event)
    return 0


if __name__ == "__main__":
    try: sys.exit(main())
    except Exception: sys.exit(0)
