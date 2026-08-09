#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Titan — Claude Code Governance Installer
=========================================

Run once per developer machine after cloning the workspace.

Usage:
    python titan-configure.py               # full interactive setup
    python titan-configure.py --force       # overwrite settings.local.json even if it exists
    python titan-configure.py --check       # verify setup without changing anything
    python titan-configure.py --skip-tools  # skip npm installs (Claude Code + MCPs already installed)
    python titan-configure.py --super       # request the toolkit-maintainer role (see Phase 4 below)
    python titan-configure.py --help

What this does:
    1. Checks prerequisites  (Python 3.8+, Node.js 16+, npm)
    2. Installs Claude Code CLI       (npm install -g @anthropic-ai/claude-code)
    3. Installs MCP connectors        (SCM + issue tracker, per titan.config.json platforms)
    4. Asks for your role             (from titan.config.json roles.definitions)
    5. Asks for your SCM PAT          (Azure DevOps / GitHub personal access token)
    6. Asks for your issue-tracker credentials (email + API token)
    7. Writes .claude/settings.local.json  (gitignored — this machine only)
    8. Verifies the complete setup against .claude/.deployed-manifest.json

Requires: Python 3.8+, Node.js 16+, npm, a deployed .claude/titan.config.json
(deploy-harness.sh seeds a placeholder on first deploy — fill it in before
running this installer for real values; --check works against the
placeholder too, it just reports everything as unconfigured).
"""

import os
import sys
import json
import shutil
import subprocess
import getpass
from pathlib import Path

# ── titan.config.json — the single source of truth for org facts ────────────
# Deployed by deploy-harness.sh to WORKSPACE/.claude/titan.config.json (never
# overwritten by that script once present). This installer is a standalone
# script (no pip deps allowed — matches the harness's zero-dependency hook
# posture), so rather than import titan_config.py's shared library (a hooks/
# module, not guaranteed to be on sys.path from an arbitrary workspace root)
# it duplicates the same minimal dotted-path/person-id resolution titan-
# render.py and titan-config.py already use. Fails soft: a missing/invalid
# config degrades every config-driven prompt to a generic fallback rather
# than crashing the installer.
def _load_titan_config(workspace: Path) -> dict:
    for candidate in (
        workspace / ".claude" / "titan.config.json",
        workspace / "harness" / "titan.config.json",   # running inside the harness source repo itself
    ):
        if candidate.is_file():
            try:
                return json.loads(candidate.read_text(encoding="utf-8"))
            except Exception:
                continue
    return {}


def _people(config: dict) -> dict:
    return config.get("contacts", {}).get("people", {})


def _person_name(config: dict, pid: str) -> str:
    p = _people(config).get(pid)
    if isinstance(p, dict) and p.get("name"):
        return p["name"]
    return pid


def _join_names(config: dict, ids) -> str:
    return " + ".join(_person_name(config, pid) for pid in (ids or [])) or "the governance owner"

# ── Terminal colours (ANSI — enabled on Windows via os.system("")) ───────────
if sys.platform == "win32":
    os.system("")

G, C, Y, R, B, X = "\033[32m", "\033[36m", "\033[33m", "\033[31m", "\033[1m", "\033[0m"


def ok(m):    print(f"  {G}[OK]{X}  {m}")
def info(m):  print(f"  {C}[..]{X}  {m}")
def warn(m):  print(f"  {Y}[!!]{X}  {m}")
def err(m):   print(f"  {R}[XX]{X}  {m}")
def hdr(m):   print(f"\n  {B}{C}{m}{X}\n")
def rule():   print(f"  {'-' * 58}")


# ── Argument parsing (no argparse dependency) ─────────────────────────────────
args = set(sys.argv[1:])
if "--help" in args or "-h" in args:
    print(__doc__)
    sys.exit(0)

FORCE       = "--force"       in args
CHECK_ONLY  = "--check"       in args
SKIP_TOOLS  = "--skip-tools"  in args

# --super: documented, explicit request for the toolkit-maintainer role.
# Replaces an old undocumented admin flag from the reference installer this
# was extracted from — an unlisted backdoor flag is a poor
# thing to ship to a third-party adopter. This flag does NOT silently grant
# the role: it is gated below (Phase 4) on the operator already being
# listed in titan.config.json roles.definitions.super.holders, matched
# against `git config user.email` / `user.name`. That match is a
# convenience check, not a security boundary — real access control is
# whatever your org's process is for handing out this toolkit's governance-
# file edit rights in the first place.
SUPER_REQUESTED = "--super" in args

# Titan installer (Electron wizard) contract — added 2026-05-17, kept in the
# CLI so a future Electron wizard can still drive this script headlessly.
# When JSON_OUTPUT=True, every progress signal becomes a single JSON line
# on stdout, ANSI colors are suppressed, and the human-readable banner is
# replaced by a {"phase":"banner",...} event. This is the protocol the
# Electron renderer parses to drive the InstallProgress screen.
JSON_OUTPUT     = "--json-output" in args
NON_INTERACTIVE = "--non-interactive" in args

# --config <path>: JSON file with non-secret installer inputs (role, workspace).
# Secrets (ADO PAT, Jira token) come from environment variables set by the
# Electron main process AFTER reading them from Windows Credential Manager.
CONFIG_PATH = None
for i, a in enumerate(sys.argv[1:]):
    if a == "--config" and i + 1 < len(sys.argv[1:]):
        CONFIG_PATH = Path(sys.argv[1:][i + 1]).resolve()
        break

# --role <po|manager|lead|architect|dev>: controls which phases run.
# PO/manager skip Node/Java prereq blocking and credential phases.
INSTALLER_ROLE = None
for i, a in enumerate(sys.argv[1:]):
    if a == "--role" and i + 1 < len(sys.argv[1:]):
        INSTALLER_ROLE = sys.argv[1:][i + 1]
        break

# Load config JSON if provided (Electron writes this to a temp file).
INSTALLER_CONFIG = {}
if CONFIG_PATH and CONFIG_PATH.is_file():
    try:
        INSTALLER_CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        # In JSON mode we can't print the error here yet (emit_json undefined);
        # fall back to plain stderr so the renderer can show it.
        sys.stderr.write(f"Failed to read --config {CONFIG_PATH}: {e}\n")
        sys.exit(2)

# Workspace path detection: skip values that belong to --flag <value> pairs.
# Without this, `titan-configure.py --role dev` would think "dev" is the workspace.
_VALUE_TAKING_FLAGS = {"--config", "--role", "--workspace"}
_cli = sys.argv[1:]
_skip_next = False
_positional = []
for _i, _a in enumerate(_cli):
    if _skip_next:
        _skip_next = False
        continue
    if _a in _VALUE_TAKING_FLAGS:
        _skip_next = True
        continue
    if not _a.startswith("-"):
        _positional.append(_a)

# Honor --workspace <path> when present; else first positional; else current dir.
_workspace_override = None
for _i, _a in enumerate(_cli):
    if _a == "--workspace" and _i + 1 < len(_cli):
        _workspace_override = _cli[_i + 1]
        break

WORKSPACE = Path(_workspace_override or (_positional[0] if _positional else ".")).resolve()

TITAN_CONFIG = _load_titan_config(WORKSPACE)
ORG_DISPLAY  = TITAN_CONFIG.get("org", {}).get("display_name") or "your organization"
ORG_BRAND    = TITAN_CONFIG.get("org", {}).get("harness_brand") or "Titan"
EMAIL_DOMAIN = TITAN_CONFIG.get("org", {}).get("email_domain") or "your organization's"
GOV_OWNER_ID = TITAN_CONFIG.get("roles", {}).get("governance_owner", "")
GOV_OWNER_NAME = _person_name(TITAN_CONFIG, GOV_OWNER_ID) if GOV_OWNER_ID else "the toolkit maintainer"

# JSON-line emitter. Single source of truth for the Electron contract.
# The protocol version lets us add fields later without breaking older
# installers; the Electron parser rejects unknown major versions.
_PROGRESS_TOTAL = 0.0
def emit_json(phase: str, progress: float, message: str = "", level: str = "info") -> None:
    payload = {
        "protocol": "1.0",
        "phase":    phase,
        "progress": round(progress, 3),
        "message":  message,
        "level":    level
    }
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()

# When --json-output is active, ALL the user-facing helpers become no-ops
# or get rerouted to emit_json. The renderer drives the UI from those events.
if JSON_OUTPUT:
    def ok(m):    emit_json("step", _PROGRESS_TOTAL, m, "info")
    def info(m):  emit_json("step", _PROGRESS_TOTAL, m, "info")
    def warn(m):  emit_json("step", _PROGRESS_TOTAL, m, "warn")
    def err(m):   emit_json("step", _PROGRESS_TOTAL, m, "error")
    def hdr(m):   emit_json("phase", _PROGRESS_TOTAL, m, "info")
    def rule():   pass

# ── Banner ─────────────────────────────────────────────────────────────────────
# Skip the human-readable banner entirely in JSON mode -- the Electron renderer
# owns its own header. Emit a structured "start" event instead.
if JSON_OUTPUT:
    emit_json("start", 0.0, f"Workspace: {WORKSPACE}", "info")
    if CHECK_ONLY:
        emit_json("step", 0.0, "Running in check-only mode -- no changes will be made.", "info")
else:
    print(f"""
  {C}{'=' * 60}{X}
  {B}{C}  {ORG_DISPLAY} — {ORG_BRAND} Claude Code Governance Installer{X}
  {C}{'=' * 60}{X}
  {C}  Workspace: {WORKSPACE}{X}
""")
    if not TITAN_CONFIG:
        warn("No .claude/titan.config.json found (or it failed to parse) — org-specific")
        warn("prompts below will use generic placeholders. Run deploy-harness.sh first,")
        warn("or fix the config, then re-run this installer.")
    elif not TITAN_CONFIG.get("configured", False):
        warn("titan.config.json has configured:false — this is still the shipped")
        warn("placeholder. Fill it in before treating this install as real.")

    if CHECK_ONLY:
        print(f"  {Y}Running in check-only mode — no changes will be made.{X}\n")

if not WORKSPACE.exists():
    err(f"Workspace does not exist: {WORKSPACE}")
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Prerequisites
# ─────────────────────────────────────────────────────────────────────────────
hdr("Phase 1 — Prerequisites")

def run(cmd, capture=True):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=capture, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except Exception as e:
        return 1, "", str(e)

# Python version
py_ver = sys.version_info
if py_ver < (3, 8):
    err(f"Python 3.8+ required. Found: {py_ver.major}.{py_ver.minor}")
    sys.exit(1)
ok(f"Python {py_ver.major}.{py_ver.minor}.{py_ver.micro}")

# `python` binary on PATH (hooks in .claude/settings.json invoke `python`,
# not `python3` — on Windows `python3` is the Microsoft Store stub).
rc, py_check, _ = run("python --version")
if rc != 0 or "Python" not in py_check:
    err("'python' is not a working interpreter on PATH.")
    err("  On Windows, ensure C:\\PythonXXX\\ is on PATH BEFORE Microsoft Store stubs.")
    err("  Hooks in .claude/settings.json invoke 'python' to run protect-skills.py")
    err("  and credential-scan.py. Without a real python, governance enforcement is off.")
    sys.exit(1)
ok(f"python binary on PATH: {py_check}")

# Node.js
rc, node_ver, _ = run("node --version")
if rc != 0:
    err("Node.js not found. Install from https://nodejs.org (v16 or later required)")
    sys.exit(1)
node_major = int(node_ver.lstrip("v").split(".")[0])
if node_major < 16:
    warn(f"Node.js {node_ver} detected. v16+ recommended. Some features may not work.")
else:
    ok(f"Node.js {node_ver}")

# npm
rc, npm_ver, _ = run("npm --version")
if rc != 0:
    err("npm not found. Reinstall Node.js from https://nodejs.org")
    sys.exit(1)
ok(f"npm {npm_ver}")

# Java (optional — required only for Hybris/AEM work)
rc, java_ver, _ = run("java -version 2>&1")
if rc == 0:
    ok(f"Java detected (required for AEM/Hybris builds)")
else:
    warn("Java not found — required for AEM/Hybris Maven builds. Install JDK 11+")

# git
rc, git_ver, _ = run("git --version")
if rc != 0:
    err("git not found. Install from https://git-scm.com")
    sys.exit(1)
ok(git_ver)

rule()


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Tool installation (Claude Code CLI + MCP servers)
# ─────────────────────────────────────────────────────────────────────────────
hdr("Phase 2 — Tool Installation")

if CHECK_ONLY or SKIP_TOOLS:
    info("Skipping tool installation (--check or --skip-tools flag set)")
else:
    # Claude Code CLI
    rc, cc_ver, _ = run("claude --version")
    if rc == 0:
        ok(f"Claude Code CLI already installed: {cc_ver}")
    else:
        info("Installing Claude Code CLI...")
        rc, out, err_msg = run("npm install -g @anthropic-ai/claude-code", capture=False)
        if rc != 0:
            err(f"Failed to install Claude Code CLI: {err_msg}")
            err("Try running:  npm install -g @anthropic-ai/claude-code")
            sys.exit(1)
        ok("Claude Code CLI installed")

    # Azure DevOps MCP server — launched on demand via `npx` (see .mcp.json),
    # so NO global install / admin rights are needed. We only pre-warm the
    # per-user npm cache so the first MCP launch isn't slow. `npm cache add`
    # writes to %LOCALAPPDATA%\npm-cache (user-writable) — never Program Files.
    info("Pre-fetching azure-devops-mcp into the per-user npm cache (no admin needed)...")
    rc, _, _ = run("npm cache add azure-devops-mcp@1.1.2")
    if rc == 0:
        ok("azure-devops-mcp@1.1.2 cached — runs via npx, no global install")
    else:
        warn("Could not pre-cache azure-devops-mcp — npx will fetch it on first use")

    # Caveman output-compression skill
    # Reduces narrative token usage ~75% across all modes per CLAUDE.md
    # "Output Compression" section. Code blocks and security alerts are
    # never compressed (G0 + Caveman built-in security override).
    caveman_dir = Path(".agents/skills/caveman")
    if caveman_dir.exists():
        ok("caveman skill already installed")
    else:
        info("Installing caveman skill (output compression, juliusbrussee/caveman)...")
        rc, _, err_msg = run("npx -y skills add juliusbrussee/caveman --skill caveman", capture=False)
        if rc != 0:
            warn("caveman install failed — token compression unavailable, otherwise harmless")
        else:
            ok("caveman skill installed")

rule()


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — Workspace file check
# ─────────────────────────────────────────────────────────────────────────────
hdr("Phase 3 — Workspace Structure")

# Repo list -- read from titan.config.json repos[].dir (was a hardcoded
# 5-repo list). A folder may also appear URL-encoded depending on how it
# was cloned (spaces -> %20), same fallback the original hardcoded list carried.
REPOS = []
for _repo in TITAN_CONFIG.get("repos", []):
    _dir = _repo.get("dir", "")
    if not _dir:
        continue
    _candidates = [_dir]
    if " " in _dir:
        _candidates.append(_dir.replace(" ", "%20"))
    REPOS.append((_repo.get("display", _dir), _candidates))

if not REPOS:
    info("No repos[] configured in titan.config.json — skipping workspace repo check")
else:
    for display_name, candidates in REPOS:
        found = any((WORKSPACE / c).is_dir() for c in candidates)
        if found:
            ok(f"Repo found: {display_name}")
        else:
            warn(f"Repo not found: {display_name}  (clone it separately if needed)")

claude_dir = WORKSPACE / ".claude"
if claude_dir.is_dir():
    ok(".claude/ governance toolkit present")
else:
    warn(".claude/ directory not found — this script must be run from the workspace root")
    warn("Clone the full workspace repo, then run:  python titan-configure.py")

# MCP-server drift detection — compare .mcp.json against the approved list.
# Warn (not block) so future-approved servers can be added without breaking install.
# Server name is derived from platforms.scm.kind so a github-configured
# adopter doesn't get a permanent "missing: azure-devops" nag (issue
# tracker MCP is out of scope here — Jira/Confluence go through the
# claude.ai Atlassian Rovo connector, not a workspace .mcp.json entry).
_SCM_KIND = TITAN_CONFIG.get("platforms", {}).get("scm", {}).get("kind", "azure-devops")
APPROVED_MCP_SERVERS = {_SCM_KIND} if _SCM_KIND else set()

# Directories that contain their own .claude/ or .claude-plugin/ and would
# silently inject skills into Claude Code sessions. Per CLAUDE.md "Blocked",
# these must never appear in the workspace root.
# Detection stays as a safety net even after a plugin is deleted — if someone
# re-clones a rejected plugin into the workspace, this warns immediately.
# Sourced from governance.plugin_policy.blocked (was a single reference-adopter-specific
# hardcoded entry with an inlined incident narrative — that history belongs
# in the adopter's own governance docs, not this installer's source).
REJECTED_PLUGIN_DIRS = [
    (name, f"Listed in titan.config.json governance.plugin_policy.blocked. "
           f"If it has been (re-)cloned, the rejection still stands — see /common/plugin-policy.")
    for name in TITAN_CONFIG.get("governance", {}).get("plugin_policy", {}).get("blocked", [])
]
for dir_name, reason in REJECTED_PLUGIN_DIRS:
    plugin_dir = WORKSPACE / dir_name
    if plugin_dir.is_dir():
        injects_skills = (
            (plugin_dir / ".claude").is_dir()
            or (plugin_dir / ".claude-plugin").is_dir()
        )
        if injects_skills:
            warn(f"REJECTED plugin auto-discovered: {dir_name}/")
            warn(f"  Reason: {reason}")
            warn(f"  Action: Delete {dir_name}/, or rename {dir_name}/.claude and "
                 f"{dir_name}/.claude-plugin to isolate from Claude Code discovery.")
        else:
            warn(f"{dir_name}/ present (without .claude/ discovery dirs). Confirm intent — "
                 f"the entire plugin is rejected per CLAUDE.md.")
mcp_json = WORKSPACE / ".mcp.json"
if mcp_json.is_file():
    try:
        mcp_config = json.loads(mcp_json.read_text(encoding="utf-8"))
        configured = set(mcp_config.get("mcpServers", {}).keys())
        unapproved = configured - APPROVED_MCP_SERVERS
        missing = APPROVED_MCP_SERVERS - configured
        if unapproved:
            warn(f"Unapproved MCP servers found in .mcp.json: {', '.join(sorted(unapproved))}")
            warn("  Per CLAUDE.md, new MCP servers require super-role approval and compliance review.")
            warn(f"  Contact {GOV_OWNER_NAME} (toolkit maintainer) before using them.")
        if missing:
            info(f"Expected MCP servers missing from .mcp.json: {', '.join(sorted(missing))}")
        if not unapproved and not missing:
            ok(".mcp.json matches approved server list")
    except Exception as exc:
        warn(f".mcp.json present but unreadable: {exc}")
else:
    info(".mcp.json not present (workspace-scoped MCP servers will be unavailable)")

rule()


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 4 — Role selection
# ─────────────────────────────────────────────────────────────────────────────
hdr("Phase 4 — Role Selection")

# Roles enumerated from titan.config.json roles.definitions -- was a
# hardcoded 4-entry dict. Any role marked hidden:true is skipped in the
# interactive menu (same "hidden mode" convention as /po-mode's
# require_mode_before_work pattern) but still selectable via --role in
# non-interactive mode, since a headless caller (the future Electron
# wizard) may legitimately need it. "super" is always excluded from the
# numbered menu regardless of its hidden flag -- it is requested via the
# explicit --super flag below, never picked from a list.
_ROLE_DESCRIPTIONS = {
    # Generic, catalog-style filler -- identical for every adopter, so it
    # belongs in code, not config (same rationale as titan-render.py's
    # MODE_CATALOG). Falls back to the role id itself if unrecognized.
    "developer": "Write and test code",
    "lead":      "PR reviews, governance, architecture guidance",
    "architect": "Full deploy authority",
    "qa":        "Test planning and execution",
    "po":        "Describe platform features in plain English",
    "manager":   "Backlog, planning, no code changes",
}

_ROLE_DEFS = TITAN_CONFIG.get("roles", {}).get("definitions", {})
_ALL_ROLE_IDS = set(_ROLE_DEFS.keys()) or {"developer", "lead", "architect", "po", "manager"}
ROLES = {}
_menu_num = 1
for _role_id, _role_def in _ROLE_DEFS.items():
    if _role_id == "super" or _role_def.get("hidden"):
        continue
    ROLES[str(_menu_num)] = (_role_id, _ROLE_DESCRIPTIONS.get(_role_id, f"See titan.config.json roles.definitions.{_role_id}"))
    _menu_num += 1
if not ROLES:
    # No config at all (placeholder/missing) -- fall back to a generic menu
    # so the installer still runs standalone against an unconfigured workspace.
    ROLES = {
        "1": ("developer", _ROLE_DESCRIPTIONS["developer"]),
        "2": ("lead",      _ROLE_DESCRIPTIONS["lead"]),
        "3": ("architect", _ROLE_DESCRIPTIONS["architect"]),
    }

role_choice = ""
selected_role = ""


def _git_identity():
    """Best-effort (name, email) from git config — not an auth system, just
    a convenience match for the --super gate below."""
    _, g_email, _ = run("git config user.email")
    _, g_name, _ = run("git config user.name")
    return (g_name or "").strip(), (g_email or "").strip()


if SUPER_REQUESTED:
    _holders = TITAN_CONFIG.get("roles", {}).get("definitions", {}).get("super", {}).get("holders", [])
    if not _holders:
        err("--super requested but titan.config.json has no roles.definitions.super.holders configured.")
        err("Ask the governance owner to add you there first.")
        sys.exit(2)
    _git_name, _git_email = _git_identity()
    _matched = False
    for _hid in _holders:
        _person = _people(TITAN_CONFIG).get(_hid, {})
        if _git_email and _person.get("email") and _git_email.lower() == _person["email"].lower():
            _matched = True
            break
        if _git_name and _person.get("name") and _git_name.lower() == _person["name"].lower():
            _matched = True
            break
    if not _matched:
        err("--super requires you to be listed in titan.config.json roles.definitions.super.holders")
        err(f"  (matched by `git config user.email`/`user.name` — got name={_git_name!r}, email={_git_email!r}).")
        err(f"  Contact {GOV_OWNER_NAME} if you believe this is wrong.")
        sys.exit(2)
    selected_role = "super"
    ok(f"--super granted (matched against roles.definitions.super.holders).")
elif CHECK_ONLY:
    local_path = WORKSPACE / ".claude" / "settings.local.json"
    if local_path.exists():
        try:
            existing = json.loads(local_path.read_text("utf-8"))
            selected_role = existing.get("env", {}).get("CLAUDE_ROLE", "developer")
            # Never reveal super role in check output -- show generic label.
            display_role = selected_role if selected_role != "super" else "configured"
            info(f"Current role from settings.local.json: {display_role}")
        except Exception:
            info("Could not read existing role")
elif NON_INTERACTIVE:
    # Titan installer (Electron) path -- role comes from --role flag or
    # the --config JSON. No prompt. Map the installer-side role name to the
    # internal CLAUDE_ROLE string (installer uses "dev"; internal uses "developer").
    raw_role = INSTALLER_ROLE or INSTALLER_CONFIG.get("role") or "developer"
    selected_role = "developer" if raw_role == "dev" else raw_role
    if selected_role not in _ALL_ROLE_IDS and selected_role not in {"developer", "lead", "architect", "po", "manager"}:
        err(f"Invalid --role value: {raw_role}")
        sys.exit(2)
    ok(f"Role from installer config: {selected_role}")
else:
    print(f"  {'#':<4} {'Role':<14} Description")
    rule()
    for k, (role, desc) in ROLES.items():
        print(f"  {k:<4} {role:<14} {desc}")
    rule()
    _default_choice = "1"
    while role_choice not in ROLES:
        role_choice = input(f"\n  Enter role number (1-{len(ROLES)}) [{_default_choice}]: ").strip() or _default_choice
        if role_choice not in ROLES:
            warn(f"Enter a number from 1 to {len(ROLES)}")
    selected_role, role_desc = ROLES[role_choice]
    ok(f"Role selected: {selected_role} -- {role_desc}")

rule()


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 5 — Credentials
# ─────────────────────────────────────────────────────────────────────────────
hdr("Phase 5 — Credentials")

print(f"""  Your credentials are stored ONLY on this machine in:
  {WORKSPACE / '.claude' / 'settings.local.json'}
  This file is gitignored and will never be committed.
""")

ado_pat    = ""
jira_email = ""
jira_token = ""

if CHECK_ONLY:
    info("Skipping credential input (--check mode)")
    # Read existing credentials for the summary verdict
    local_path = WORKSPACE / ".claude" / "settings.local.json"
    if local_path.exists():
        try:
            existing_env = json.loads(local_path.read_text("utf-8")).get("env", {})
            ado_pat    = existing_env.get("AZURE_DEVOPS_PAT", "")
            jira_email = existing_env.get("JIRA_EMAIL", "")
            jira_token = existing_env.get("JIRA_API_TOKEN", "")
        except Exception:
            pass
elif NON_INTERACTIVE:
    # Titan installer path: secrets come from environment variables that
    # the Electron main process injected from Windows Credential Manager
    # (keytar). They are NEVER passed via --config (the config JSON is on
    # disk and would leak secrets if logged or screenshotted).
    # TITAN_* env contract (kept as env vars,
    # not CLI flags, specifically so a future Electron wizard can drive
    # this script headlessly without secrets touching argv or disk).
    #
    # For PO/manager roles, the SCM PAT may be absent — the issue tracker
    # goes through OAuth post-install, no installer-side token needed.
    ado_pat    = os.environ.get("TITAN_ADO_PAT", "")
    jira_email = os.environ.get("TITAN_JIRA_EMAIL", "")
    jira_token = os.environ.get("TITAN_JIRA_TOKEN", "")
    if ado_pat:
        ok("SCM PAT received from installer (Windows Credential Manager)")
    elif selected_role in {"developer", "lead", "architect"}:
        warn("Installer did not supply a SCM PAT — SCM MCP will be unavailable")
    if jira_email and jira_token:
        ok("Issue-tracker credentials received from installer")
    else:
        # Expected for the installer flow — issue tracker via OAuth post-install.
        info("No issue-tracker credentials in installer payload — OAuth connector handles it")
else:
    # Read existing values to allow skipping
    local_path = WORKSPACE / ".claude" / "settings.local.json"
    existing_env = {}
    if local_path.exists() and not FORCE:
        try:
            existing_env = json.loads(local_path.read_text("utf-8")).get("env", {})
        except Exception:
            pass

    _scm = TITAN_CONFIG.get("platforms", {}).get("scm", {})
    _scm_kind_label = {"azure-devops": "Azure DevOps (ADO)", "github": "GitHub"}.get(_scm.get("kind"), "SCM")
    _pat_url = _scm.get("pat_url") or "your SCM provider's personal-access-token settings page"
    _tracker = TITAN_CONFIG.get("platforms", {}).get("issue_tracker", {})
    _tracker_kind_label = {"jira": "Jira", "none": "issue tracker"}.get(_tracker.get("kind"), "issue tracker")

    # SCM PAT
    existing_ado = existing_env.get("AZURE_DEVOPS_PAT", "")
    if existing_ado and existing_ado not in ("", "REPLACE_WITH_YOUR_ADO_PAT"):
        print(f"  {_scm_kind_label} PAT: {Y}already configured{X} (press Enter to keep)")
        ado_input = getpass.getpass(f"  New {_scm_kind_label} PAT (or Enter to keep): ").strip()
        ado_pat = ado_input if ado_input else existing_ado
    else:
        print(f"""  {_scm_kind_label} Personal Access Token (PAT):
  Create one at: {_pat_url}
  Scopes required: Code (Read), Pull Request Threads (Read & Write), Work Items (Read)
""")
        ado_pat = getpass.getpass(f"  {_scm_kind_label} PAT (input hidden): ").strip()
        if not ado_pat:
            warn(f"No {_scm_kind_label} PAT entered — PR reviews will use git fallback")

    # Issue-tracker email
    existing_email = existing_env.get("JIRA_EMAIL", "")
    if existing_email and "@" in existing_email:
        print(f"\n  {_tracker_kind_label} email: {Y}already configured{X} as {existing_email}")
        email_input = input(f"  New {_tracker_kind_label} email (or Enter to keep): ").strip()
        jira_email = email_input if email_input else existing_email
    else:
        print(f"\n  {_tracker_kind_label} email address (your {EMAIL_DOMAIN} email):")
        jira_email = input("  Email: ").strip()

    # Issue-tracker API token
    existing_jira = existing_env.get("JIRA_API_TOKEN", "")
    if existing_jira and existing_jira not in ("", "REPLACE_WITH_YOUR_JIRA_API_TOKEN"):
        print(f"\n  {_tracker_kind_label} API token: {Y}already configured{X} (press Enter to keep)")
        jira_input = getpass.getpass(f"  New {_tracker_kind_label} token (or Enter to keep): ").strip()
        jira_token = jira_input if jira_input else existing_jira
    else:
        print(f"""\n  {_tracker_kind_label} API token:
  Create one at: https://id.atlassian.com/manage-profile/security/api-tokens
  Log in with your {EMAIL_DOMAIN} account, then click 'Create API token'.
""")
        jira_token = getpass.getpass(f"  {_tracker_kind_label} API token (input hidden): ").strip()
        if not jira_token:
            warn(f"No {_tracker_kind_label} token entered — {_tracker_kind_label} MCP will be unavailable")

rule()


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 6 — Write settings.local.json
# ─────────────────────────────────────────────────────────────────────────────
hdr("Phase 6 — Writing Developer Settings")

# Role-based permissions
ROLE_PERMISSIONS = {
    # PO (Product Owner): read-only. Can browse the codebase but cannot run
    # builds, push code, or execute any write operation.
    "po": {
        "allow": [
            "Bash(git -C * log*)",
            "Bash(git -C * diff*)",
            "Bash(git -C * status)",
            "Bash(git -C * branch*)",
            "Bash(ls *)",
        ],
        "deny": [
            "Bash(git push*)",
            "Bash(git commit*)",
            "Bash(git merge*)",
            "Bash(git rebase*)",
            "Bash(git reset*)",
            "Bash(git branch -D *)",
            "Bash(git branch -d *)",
            "Bash(git tag*)",
            "Bash(mvn*)",
            "Bash(npm*)",
            "Bash(npx*)",
            "Bash(yarn*)",
            "Bash(gulp*)",
            "Bash(aio*)",
            "Bash(curl*)",
            "Bash(wget*)",
            "Bash(rm*)",
        ]
    },
    "developer": {
        "allow": [],
        "deny": [
            "Bash(git push*)",
            "Bash(git push --force*)",
            "Bash(git push -f *)",
            "Bash(git push --delete*)",
            "Bash(git -C * push*)",
            "Bash(git branch -D *)",
            "Bash(git -C * branch -D *)",
            "Bash(git reset --hard*)",
            "Bash(git commit --amend*)",
            "Bash(rm -rf*)",
            "Bash(mvn * -PautoInstallSinglePackage*)",
            "Bash(mvn * -PautoInstallSinglePackagePublish*)",
            "Bash(mvn clean install -Pprod*)",
            "Bash(curl *)",
            "Bash(wget *)",
            "Bash(aio *)",
        ]
    },
    "lead": {
        "allow": [
            "Bash(git -C * fetch origin refs/pull/*)",
        ],
        "deny": [
            "Bash(git push --force*)",
            "Bash(git push -f *)",
            "Bash(git push --delete*)",
            "Bash(git push origin :*)",
            "Bash(git -C * push --force*)",
            "Bash(git -C * push -f *)",
            "Bash(git branch -D *)",
            "Bash(git -C * branch -D *)",
            "Bash(git commit --amend*)",
            "Bash(git -C * commit --amend*)",
            "Bash(rm -rf*)",
            "Bash(mvn * -PautoInstallSinglePackage*)",
            "Bash(mvn * -PautoInstallSinglePackagePublish*)",
            "Bash(aio *)",
        ]
    },
    "architect": {
        "allow": [
            "Bash(git push origin *)",
            "Bash(git -C * push origin *)",
            "Bash(git -C * fetch origin refs/pull/*)",
            "Bash(mvn * -PautoInstallSinglePackage*)",
            "Bash(mvn * -PautoInstallSinglePackagePublish*)",
            "Bash(mvn clean install -Pprod*)",
            "Bash(aio *)",
            "Bash(curl *)",
        ],
        "deny": [
            "Bash(git push --force*)",
            "Bash(git push -f *)",
            "Bash(git push --delete*)",
            "Bash(git push origin :*)",
            "Bash(git -C * push --force*)",
            "Bash(git -C * push -f *)",
            "Bash(git -C * push --delete*)",
            "Bash(git branch -D *)",
            "Bash(git -C * branch -D *)",
            "Bash(git commit --amend*)",
            "Bash(git -C * commit --amend*)",
        ]
    },
    # super: toolkit maintainer — all architect permissions PLUS governance file edit authority.
    # The protect-skills.py hook allows only this role to modify .claude/ and CLAUDE.md.
    # Assign only to holders listed in titan.config.json roles.definitions.super.holders
    # (see --super above).
    "super": {
        "allow": [
            "Bash(git push origin *)",
            "Bash(git -C * push origin *)",
            "Bash(git -C * fetch origin refs/pull/*)",
            "Bash(mvn * -PautoInstallSinglePackage*)",
            "Bash(mvn * -PautoInstallSinglePackagePublish*)",
            "Bash(mvn clean install -Pprod*)",
            "Bash(aio *)",
            "Bash(curl *)",
        ],
        "deny": [
            "Bash(git push --force*)",
            "Bash(git push -f *)",
            "Bash(git push --delete*)",
            "Bash(git push origin :*)",
            "Bash(git -C * push --force*)",
            "Bash(git -C * push -f *)",
            "Bash(git -C * push --delete*)",
            "Bash(git branch -D *)",
            "Bash(git -C * branch -D *)",
            "Bash(git commit --amend*)",
            "Bash(git -C * commit --amend*)",
        ]
    },
}

if not CHECK_ONLY:
    _scm = TITAN_CONFIG.get("platforms", {}).get("scm", {})
    # base_url is the full org URL (e.g. https://dev.azure.com/<collection>);
    # AZURE_DEVOPS_URL is the host-only prefix the ADO MCP wrapper expects,
    # with collection kept separate in AZURE_DEVOPS_COLLECTION.
    _base_url = _scm.get("base_url", "")
    _ado_host = _base_url.rsplit("/", 1)[0] if _base_url.count("/") > 2 else (_base_url or "https://dev.azure.com")
    local_settings = {
        "permissions": ROLE_PERMISSIONS.get(selected_role, ROLE_PERMISSIONS["developer"]),
        "env": {
            "CLAUDE_ROLE": selected_role,
            "AZURE_DEVOPS_PAT":   ado_pat    or "REPLACE_WITH_YOUR_ADO_PAT",
            "AZURE_DEVOPS_URL":   _ado_host,
            "AZURE_DEVOPS_COLLECTION": _scm.get("collection") or "REPLACE_WITH_YOUR_ADO_COLLECTION",
            "JIRA_EMAIL":         jira_email or "REPLACE_WITH_YOUR_EMAIL",
            "JIRA_API_TOKEN":     jira_token or "REPLACE_WITH_YOUR_JIRA_API_TOKEN",
        }
    }

    local_path = WORKSPACE / ".claude" / "settings.local.json"

    if local_path.exists() and not FORCE:
        warn(f"settings.local.json already exists — use --force to overwrite")
        info("Run:  python titan-configure.py --force   to update your credentials")
    else:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_text(json.dumps(local_settings, indent=2), encoding="utf-8")
        ok(f"Written: .claude/settings.local.json  (role={selected_role})")

rule()


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 7 — Verify workspace .gitignore excludes secrets
# ─────────────────────────────────────────────────────────────────────────────
hdr("Phase 7 — Gitignore Safety Check")

GITIGNORE_REQUIRED = [
    ".claude/settings.local.json",
    ".claude/worktrees/",
]

ws_gitignore = WORKSPACE / ".gitignore"
if ws_gitignore.exists():
    content = ws_gitignore.read_text("utf-8")
    for entry in GITIGNORE_REQUIRED:
        if entry in content:
            ok(f".gitignore covers: {entry}")
        else:
            if not CHECK_ONLY:
                with ws_gitignore.open("a", encoding="utf-8") as f:
                    f.write(f"\n{entry}\n")
                ok(f"Added to .gitignore: {entry}")
            else:
                warn(f".gitignore missing: {entry}")
else:
    if not CHECK_ONLY:
        ws_gitignore.write_text("\n".join(GITIGNORE_REQUIRED) + "\n", encoding="utf-8")
        ok("Created workspace .gitignore")

rule()


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 8 — Verify complete setup
# ─────────────────────────────────────────────────────────────────────────────
hdr("Phase 8 — Setup Verification")

# EXPECTED_FILES single source of truth (Titan extraction plan Section F,
# step 18): read from .claude/.deployed-manifest.json, generated by
# deploy-harness.sh from the SAME layout logic it uses to actually copy
# files. This is what makes a hook/subagent rename in the harness source
# impossible to desync from this installer's verification step -- the old
# approach hardcoded ~44 filenames here that had to be hand-updated on
# every rename (exactly the failure mode Phase 3's nine subagent renames
# would otherwise have hit). titan-doctor.py reads the same file.
#
# Fallback (manifest missing -- e.g. a target deployed by a pre-manifest
# version of deploy-harness.sh): a small, deliberately generic spot-check
# list, kept only so this installer still verifies SOMETHING against an
# old deployment rather than silently skipping Phase 8 entirely.
_FALLBACK_EXPECTED_FILES = [
    "CLAUDE.md",
    ".mcp.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/hooks/session-start.py",
    ".claude/hooks/protect-secrets.py",
    ".claude/hooks/answer-cache.py",
    ".claude/data/build-map.json",
    ".claude/data/reviewer-map.json",
    ".claude/commands/roles/dev-mode.md",
    ".claude/subagents/code-reviewer.md",
]

_manifest_path = WORKSPACE / ".claude" / ".deployed-manifest.json"
if _manifest_path.is_file():
    try:
        EXPECTED_FILES = json.loads(_manifest_path.read_text(encoding="utf-8")).get("files", [])
        info(f"EXPECTED_FILES loaded from {_manifest_path.relative_to(WORKSPACE)} ({len(EXPECTED_FILES)} entries)")
    except Exception as exc:
        warn(f"{_manifest_path.name} present but unreadable ({exc}) -- using fallback list")
        EXPECTED_FILES = _FALLBACK_EXPECTED_FILES
else:
    warn(f"{_manifest_path.relative_to(WORKSPACE) if _manifest_path.is_absolute() else _manifest_path} not found "
         "-- was this deployed by an older deploy-harness.sh? Using fallback list.")
    EXPECTED_FILES = _FALLBACK_EXPECTED_FILES

missing_files = []
for rel in EXPECTED_FILES:
    p = WORKSPACE / rel
    if p.exists():
        ok(rel)
    else:
        warn(f"MISSING: {rel}")
        missing_files.append(rel)

rule()

# Claude Code CLI final check
rc, cc_ver, _ = run("claude --version")
if rc == 0:
    ok(f"Claude Code CLI: {cc_ver}")
else:
    warn("Claude Code CLI not found in PATH — restart terminal or reinstall")

rule()


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 9 — Summary
# ─────────────────────────────────────────────────────────────────────────────
hdr("Setup Summary")

ado_status   = "configured" if (ado_pat    and ado_pat    != "REPLACE_WITH_YOUR_ADO_PAT")    else "NOT SET"
jira_status  = "configured" if (jira_email and "@" in jira_email)                            else "NOT SET"

print(f"""  Role     : {B}{selected_role}{X}
  ADO PAT  : {G if ado_status  == 'configured' else Y}{ado_status}{X}
  Jira     : {G if jira_status == 'configured' else Y}{jira_status}{X}
""")

if missing_files:
    warn(f"{len(missing_files)} governance file(s) missing.")
    warn("Re-clone the workspace repo to restore them, then re-run this installer.")
    print()
else:
    ok("All governance files present")
    print()

print(f"  {B}How to start a session:{X}")
print(f"  cd \"{WORKSPACE}\"")
print(f"  claude                          # opens Claude Code")
print()
_chat_alt = TITAN_CONFIG.get("platforms", {}).get("general_chat_alternative")
print(f"  {B}Model routing (token cost):{X}")
print(f"  /arch-mode planning  ->  claude --model claude-opus-4-7")
print(f"  Code generation      ->  claude   (Sonnet default)")
if _chat_alt:
    print(f"  General questions    ->  {_chat_alt}")
print()
print(f"  {B}First command in every Claude session:{X}")
print(f"  /dev-mode           developer work")
print(f"  /lead-review        PR governance review")
print(f"  /arch-mode          architecture decisions")
print(f"  /grill-me           stress-test a plan before coding")
print(f"  /pr-create          assemble a PR description")
print(f"  /offshore-brief     create a task brief for offshore team")
print()

if not missing_files and (ado_status == "configured" or jira_status == "configured"):
    print(f"  {G}{B}[DONE] Setup complete. Open a new terminal window and run: claude{X}")
else:
    print(f"  {Y}[!!] Setup incomplete -- address warnings above before starting.{X}")

print(f"\n  {C}{'=' * 60}{X}\n")
