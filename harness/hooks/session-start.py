#!/usr/bin/env python3
"""
Titan -- SessionStart hook.

Ports session-start.sh's grep/sed JSON extraction to real JSON parsing via
titan_config.py, and adds the plan's §B.2 live governance header so a config
edit is visible immediately, without a re-deploy (CLAUDE.md itself can only
be updated by re-rendering; this header is the up-to-date surface in the
meantime).

Fails silently on any error -- never blocks session startup.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None


def workspace_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


def _cfg(workspace: Path) -> dict:
    if not titan_config:
        return {}
    try:
        return titan_config.load_config(workspace)
    except Exception:
        return {}


def p(text: str = "") -> None:
    print(text)


def print_header(workspace: Path, config: dict) -> None:
    b = titan_config.brand(workspace) if titan_config else "Titan"
    org_name = (config.get("org") or {}).get("name") or "(unconfigured org)"
    repos = config.get("repos") or []
    repo_ids = [r.get("id", r.get("dir", "?")) for r in repos if isinstance(r, dict)]

    areas = (config.get("contacts") or {}).get("areas") or {}
    esc_parts = []
    for key in ("ui", "aem", "commerce", "cif", "security"):
        entry = areas.get(key)
        if isinstance(entry, dict):
            names = [
                (config.get("contacts", {}).get("people", {}).get(pid) or {}).get("name", pid)
                for pid in entry.get("primary", [])
            ]
            if names:
                suffix = " (immediate)" if key == "security" else ""
                esc_parts.append(f"{key}→{', '.join(names)}{suffix}")
    escalation_line = " · ".join(esc_parts) if esc_parts else "(no contacts configured)"

    protected = []
    if titan_config:
        try:
            protected = titan_config.load_protected(workspace).get("paths", []) or []
        except Exception:
            protected = []
    n_rules = len(protected)
    n_critical = sum(1 for e in protected if isinstance(e, dict) and e.get("severity") == "CRITICAL")

    modes = config.get("modes") or {}
    active_modes = modes.get("active") or []

    p()
    p(f"  [{b}] Org: {org_name} · Config: .claude/titan.config.json (v1.0)")
    p(f"  Active repos: {', '.join(repo_ids) if repo_ids else '(none configured)'}")
    p(f"  Escalation by area: {escalation_line}")
    p(f"  Protected paths: {n_rules} rules ({n_critical} CRITICAL/irrotatable). "
      f"Resolve any path with `?gov <path>` -- never guess an owner.")
    p(f"  Mode required before work: {', '.join(active_modes) if active_modes else '(none configured)'}")
    p()

    if config.get("configured") is False:
        p("  " + "!" * 60)
        p(f"  [{b}] PLACEHOLDER CONFIG -- titan.config.json has not been filled in.")
        p("  Session context above is incomplete/example data. Fill in titan.config.json")
        p("  (see docs/ADOPTION.md) and set \"configured\": true before real use.")
        p("  " + "!" * 60)
        p()


def print_role_suggestion(config: dict) -> None:
    role = os.environ.get("CLAUDE_ROLE", "developer")
    definitions = (config.get("roles") or {}).get("definitions") or {}
    entry = definitions.get(role)
    if isinstance(entry, dict) and entry.get("default_mode") and role != "developer":
        p(f"  Suggested mode for role '{role}': /{entry['default_mode']}\n")


def print_model_routing(config: dict) -> None:
    alt = (config.get("platforms") or {}).get("general_chat_alternative") or "your org's general-chat assistant"
    p("  Model routing:")
    p("    Architecture planning  -> Opus")
    p("    Code generation        -> Sonnet (default, no flag needed)")
    p("    Convention checks      -> Haiku (auto via skill sub-agents)")
    p(f"    General chat / Q&A     -> {alt}")
    p()


def check_credentials(workspace: Path) -> None:
    local_settings = workspace / ".claude" / "settings.local.json"
    if not local_settings.exists():
        p("  [!!] FIRST-TIME SETUP REQUIRED")
        p("  Run the installer once from the workspace root, then restart Claude Code:")
        p()
        p("    python installer/titan-configure.py")
        p()
        return
    try:
        text = local_settings.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return
    if "AZURE_DEVOPS_PAT" not in text and "GITHUB_TOKEN" not in text:
        p("  [!!] SCM PAT not configured -- PR review will use git fallback.")
        p("  Re-run to reconfigure: python installer/titan-configure.py --force")
        p()


def print_recent_activity(workspace: Path, config: dict) -> None:
    repos = titan_config.repo_dirs(workspace) if titan_config else []
    if not repos:
        return
    found = False
    lines = []
    for repo in repos:
        repo_path = workspace / repo
        if not (repo_path / ".git").is_dir():
            continue
        try:
            out = subprocess.run(
                ["git", "-C", str(repo_path), "log", "--since=24 hours ago", "--oneline",
                 "--format=    %h %an %s", "-n", "5"],
                capture_output=True, text=True, timeout=5,
            )
        except Exception:
            continue
        recent = out.stdout.strip() if out.returncode == 0 else ""
        if not recent:
            continue
        try:
            b = subprocess.run(
                ["git", "-C", str(repo_path), "branch", "--show-current"],
                capture_output=True, text=True, timeout=5,
            )
            branch = b.stdout.strip() or "(unknown)"
        except Exception:
            branch = "(unknown)"
        lines.append(f"  {repo}  (on {branch}):")
        lines.append(recent)
        found = True

    if found:
        p("  " + "─" * 60)
        p("  Last 24h commits across configured repos:")
        for line in lines:
            p(line)
        p("  " + "─" * 60)
        p()


def emit_session_ticket_events(workspace: Path, config: dict) -> None:
    if (workspace / ".no-telemetry").exists():
        return
    if os.environ.get("CLAUDE_TELEMETRY", "on").lower() == "off":
        return
    ticket_regex = ((config.get("platforms") or {}).get("issue_tracker") or {}).get("ticket_regex") or r"[A-Z][A-Z0-9]+-\d+"
    try:
        pattern = re.compile(ticket_regex)
    except Exception:
        return

    salt = titan_config.telemetry_salt(workspace) if titan_config else "TITAN-DEFAULT-SALT"
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "anon"
    hashed = hashlib.sha256(f"{salt}:{user}".encode()).hexdigest()[:16]

    for repo in (titan_config.repo_dirs(workspace) if titan_config else []):
        repo_path = workspace / repo
        if not (repo_path / ".git").is_dir():
            continue
        try:
            b = subprocess.run(
                ["git", "-C", str(repo_path), "branch", "--show-current"],
                capture_output=True, text=True, timeout=5,
            )
            branch = b.stdout.strip()
        except Exception:
            continue
        m = pattern.search(branch or "")
        if not m:
            continue
        ticket = m.group(0)
        try:
            tel = workspace / ".claude" / "telemetry"
            tel.mkdir(parents=True, exist_ok=True)
            event = {
                "v": 1,
                "ts": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
                "user": hashed,
                "role": os.environ.get("CLAUDE_ROLE", "unknown"),
                "tool": "_session_ticket",
                "session": os.environ.get("CLAUDE_SESSION_ID", "")[:32],
                "meta": {"ticket": ticket, "repo": repo},
            }
            f = tel / f"events-{datetime.date.today().isoformat()}.jsonl"
            with f.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(event, separators=(",", ":")) + "\n")
        except Exception:
            continue


def print_open_progress(workspace: Path) -> None:
    progress_dir = workspace / ".claude" / "progress"
    if not progress_dir.is_dir():
        return
    open_tasks = []
    try:
        for f in progress_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            if isinstance(data, dict) and data.get("status") in ("in_progress", "pending"):
                open_tasks.append(f.stem)
    except Exception:
        return
    if open_tasks:
        p("  Open progress trackers (resume with /common/task-progress resume <ID>):")
        for t in open_tasks:
            p(f"    {t}")
        p()


def main() -> int:
    # Windows terminals often default to a narrow codepage (cp1252/cp437) that
    # cannot encode the arrow/middle-dot characters contacts_inline() and the
    # header format use. Force UTF-8 defensively, same pattern as
    # gov-retrieve.py -- this must never crash session start.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    workspace = workspace_root()
    config = _cfg(workspace)

    print_header(workspace, config)
    print_role_suggestion(config)
    print_model_routing(config)
    check_credentials(workspace)
    print_recent_activity(workspace, config)
    emit_session_ticket_events(workspace, config)
    print_open_progress(workspace)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
