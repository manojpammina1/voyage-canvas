#!/usr/bin/env python3
"""
Titan — deterministic verification gate (Stop hook, Phase 3 of the
orchestrator feature suite).

Existing Stop hooks (stop-usage-capture.py, correction-scan.py) are metadata-
only and always exit 0 — they never block turn-end. This hook is the first
Stop hook that CAN hold a turn open: if the session edited source and the
module's build/test command (resolved from data/build-map.json — never
hardcoded) fails, the turn is blocked with the first error lines so the
developer sees a failure immediately instead of relying on remembering to run
`/common/ci-gate` before `/dev/pr-create`.

SAFETY / SCOPE CONTRACT:
  - Dormant by default. Runs only when TITAN_VERIFY_GATE=1 is set in the
    session env (settings.local.json `env`, per pilot machine). No env var ->
    immediate exit 0. The org-wide install is unaffected until a machine opts in.
  - Never builds against a hard-stop module (titan.config.json protected_paths[]
    entries with enforcement.hard_stop=true) — emits the Escalation Alert and
    blocks with "manual verification
    required" instead of ever invoking a build/deploy command there.
  - Fail-OPEN on every internal error (missing git, unresolvable module,
    subprocess exception, timeout) — exit 0. A tool bug must never wedge a
    developer's session.
  - No build/test output is stored verbatim; any text shown in the block
    reason is piped through redact_lib.redact() first (build logs can contain
    stack traces with file contents, occasionally secrets-adjacent env dumps).
  - Metadata-only `_verify_gate` telemetry — modules/result/duration only,
    never log text.
  - Loop-safety: one gate run per unique (session, diff-hash); a repeated Stop
    event on an unchanged tree short-circuits to the cached result instead of
    re-running the build.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import redact_lib  # local import, same directory as this hook
except Exception:
    redact_lib = None  # fail-open: if redact_lib is missing, we still must not crash
try:
    import titan_config
except Exception:
    titan_config = None

BUILD_TIMEOUT_S = 300
# Fallback if titan.config.json protected_paths[] (enforcement.hard_stop) is
# unavailable -- a small, org-neutral default so the gate never silently
# stops refusing to auto-build a hard-stop module just because config is missing.
DEFAULT_HARD_STOP_MODULE_HINTS = (".cloudmanager",)


def workspace_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


def hard_stop_module_hints(workspace: Path) -> tuple[str, ...]:
    """Substrings of protected_paths[] globs where enforcement.hard_stop is
    true — derived live from config rather than hardcoded per adopter."""
    if titan_config:
        try:
            protected = titan_config.load_protected(workspace)
            hints = []
            for e in protected.get("paths", []) or []:
                if not isinstance(e, dict) or not (e.get("enforcement") or {}).get("hard_stop"):
                    continue
                for g in e.get("globs", []) or []:
                    # strip glob wildcards/wrapping to get a plain substring
                    # hint, e.g. "**/hybris/config/**" -> "hybris/config"
                    stripped = g.replace("**", "").strip("/*")
                    if stripped:
                        hints.append(stripped)
            if hints:
                return tuple(hints)
        except Exception:
            pass
    return DEFAULT_HARD_STOP_MODULE_HINTS


def hashed_user(workspace: Path) -> str:
    if titan_config:
        try:
            return titan_config.hashed_user(workspace)
        except Exception:
            pass
    salt = "TITAN-DEFAULT-SALT"
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "anon"
    return hashlib.sha256(f"{salt}:{user}".encode()).hexdigest()[:16]


def is_gate_enabled() -> bool:
    return os.environ.get("TITAN_VERIFY_GATE", "").strip() == "1"


def read_payload() -> dict:
    try:
        raw = sys.stdin.read()
        if raw.strip():
            return json.loads(raw)
    except Exception:
        pass
    return {}


def load_data_file(workspace: Path, name: str) -> dict:
    """Same two-location fallback as answer-cache.py:load_data_file."""
    for p in (
        workspace / ".claude" / "data" / name,
        Path(__file__).resolve().parent.parent / "data" / name,
    ):
        try:
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def changed_files(cwd: str) -> list[str]:
    """Uncommitted diff vs HEAD — the practical proxy for 'did this session
    edit source', without reading transcript content (no message-body access
    needed, unlike stop-usage-capture.py's token-usage extraction)."""
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "diff", "--name-only", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode != 0:
            return []
        return [l.strip() for l in out.stdout.splitlines() if l.strip()]
    except Exception:
        return []


def diff_hash(cwd: str, files: list[str]) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "diff", "HEAD", "--"] + files,
            capture_output=True, text=True, timeout=10,
        )
        return hashlib.sha256(out.stdout.encode("utf-8", errors="ignore")).hexdigest()[:16]
    except Exception:
        return ""


def detect_repo(cwd: str, repo_names: list[str]) -> str | None:
    try:
        p = Path(cwd).resolve()
        for candidate in (p, *p.parents):
            if candidate.name in repo_names:
                return candidate.name
    except Exception:
        pass
    return None


def touches_hard_stop(files: list[str], workspace: Path) -> str | None:
    hints = hard_stop_module_hints(workspace)
    for f in files:
        norm = f.replace("\\", "/").lower()
        for hint in hints:
            if hint.lower() in norm:
                return hint
    return None


def resolve_build_commands(cwd: str, files: list[str], workspace: Path) -> tuple[str | None, list[str]]:
    """Reuse data/build-map.json exactly as answer-cache.py:resolve_build does —
    never hardcode a build command here. build-map.json is keyed by repo id
    (titan-render.py's build_build_map), each entry carrying its own "dir"."""
    data = load_data_file(workspace, "build-map.json")
    repos = data.get("repos", {})
    if not repos:
        return None, []
    dir_to_id = {v.get("dir"): k for k, v in repos.items() if isinstance(v, dict) and v.get("dir")}
    repo_dir = detect_repo(cwd, list(dir_to_id.keys()))
    if not repo_dir:
        return None, []
    repo_id = dir_to_id.get(repo_dir, repo_dir)
    entry = repos.get(repo_id)
    if not entry:
        return None, []

    for mod in entry.get("modules", []):
        matches = mod.get("match", [])
        if any(any(m.strip("*") in f.replace("\\", "/") for f in files) for m in matches):
            return repo_dir, mod.get("commands", [])
    return repo_dir, entry.get("default", [])


def run_commands(cwd: str, commands: list[str]) -> tuple[bool, str]:
    """Run each command line in sequence in one shell session (commands list
    mirrors data/build-map.json's own convention of `cd <dir>` followed by the
    actual build/test invocation). Stops at first failure."""
    joined = " && ".join(commands)
    try:
        out = subprocess.run(
            joined, shell=True, cwd=cwd, capture_output=True, text=True,
            timeout=BUILD_TIMEOUT_S,
        )
        ok = out.returncode == 0
        tail = (out.stdout or "") + "\n" + (out.stderr or "")
        return ok, tail[-4000:]  # cap: this is a failure excerpt, not a log dump
    except subprocess.TimeoutExpired:
        return False, f"build/test timed out after {BUILD_TIMEOUT_S}s"
    except Exception as e:
        return False, f"verify-gate internal error running build: {type(e).__name__}"


def load_state(workspace: Path) -> dict:
    sf = workspace / ".claude" / "telemetry" / ".verify-gate-state.json"
    try:
        if sf.exists():
            return json.loads(sf.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def save_state(workspace: Path, state: dict) -> None:
    try:
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        (tel / ".verify-gate-state.json").write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    except Exception:
        pass


def emit_verify_gate_event(workspace: Path, session: str, modules: str, result: str, duration_ms: int) -> None:
    try:
        if (workspace / ".no-telemetry").exists():
            return
        if os.environ.get("CLAUDE_TELEMETRY", "").lower() in ("off", "0", "false"):
            return
        event = {
            "v": 1,
            "ts": _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "user": hashed_user(workspace),
            "role": os.environ.get("CLAUDE_ROLE", "unknown"),
            "tool": "_verify_gate",
            "session": (session or "noop")[:32],
            "meta": {"modules": modules, "result": result, "duration_ms": duration_ms},
        }
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, separators=(",", ":")) + "\n")
    except Exception:
        pass


def _redact(text: str) -> str:
    if not redact_lib:
        return text
    try:
        masked, _ = redact_lib.redact(text)
        return masked
    except Exception:
        return text


def main() -> int:
    if not is_gate_enabled():
        return 0  # dormant — the org-wide default

    t0 = time.monotonic()
    payload = read_payload()
    cwd = str(payload.get("cwd") or os.getcwd())
    session = str(payload.get("session_id") or "")
    workspace = workspace_root()

    files = changed_files(cwd)
    if not files:
        emit_verify_gate_event(workspace, session, "", "SKIP", int((time.monotonic() - t0) * 1000))
        return 0  # nothing to verify — docs-only / read-only session

    hard_stop = touches_hard_stop(files, workspace)
    if hard_stop:
        emit_verify_gate_event(workspace, session, hard_stop, "ESCALATE", int((time.monotonic() - t0) * 1000))
        print(json.dumps({
            "decision": "block",
            "reason": (
                "ESCALATION REQUIRED -- STOP WORK\n"
                f"Reason:  verify-gate will not auto-build a hard-stop module ({hard_stop})\n"
                "Action:  Run the build/test manually per /common/migration-check or /common/ci-gate "
                "escalation rules; do not let an automated hook touch this module."
            ),
        }))
        return 0

    dhash = diff_hash(cwd, files)
    state = load_state(workspace)
    cache_key = session or cwd
    if state.get(cache_key, {}).get("hash") == dhash and state.get(cache_key, {}).get("result") == "PASS":
        return 0  # already verified this exact diff — loop-safety, don't rebuild

    repo, commands = resolve_build_commands(cwd, files, workspace)
    if not commands:
        # Unresolvable module — fail-open. Do not invent a build command.
        emit_verify_gate_event(workspace, session, repo or "unknown", "SKIP", int((time.monotonic() - t0) * 1000))
        return 0

    ok, tail = run_commands(cwd, commands)
    duration_ms = int((time.monotonic() - t0) * 1000)
    module_label = repo or "unknown"

    state[cache_key] = {"hash": dhash, "result": "PASS" if ok else "BLOCK"}
    save_state(workspace, state)

    if ok:
        emit_verify_gate_event(workspace, session, module_label, "PASS", duration_ms)
        return 0

    emit_verify_gate_event(workspace, session, module_label, "BLOCK", duration_ms)
    safe_tail = _redact(tail)
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"[verify-gate] {module_label} build/test failed — turn held.\n\n"
            f"{safe_tail}\n\n"
            "Fix the failure above, or if this is a false positive, disable the gate for this "
            "session (unset TITAN_VERIFY_GATE) and run /common/ci-gate manually."
        ),
    }))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
