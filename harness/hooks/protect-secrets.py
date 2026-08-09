#!/usr/bin/env python3
"""
Titan -- Protected-path secret file guard.
Hooked into Claude Code PreToolUse for Read, Write, Edit, Bash, and Grep tools.

Supersedes protect-hybris-secrets.py. Blocks tool calls that would read,
display, or overwrite secret files defined in the adopter's
titan.config.json `protected_paths[]` (compiled to data/protected-paths.json
by titan-render.py) -- PLUS a hardcoded, config-independent floor of
org-neutral secret-file-format facts.

DELIBERATE FAIL-OPEN / FAIL-CLOSED SPLIT (plan §C.1):
  - Hardcoded FLOOR, always active, config cannot disable and a missing/
    broken config cannot weaken it:
        Read/Write/Edit : \\.(p12|jks|pfx|pem|key|keystore)$
        Bash            : openssl pkcs12 / keytool -list|-export
    These are facts about secret file *formats*, not about any org's
    directory layout -- they belong in code, not config.
  - CONFIG-DERIVED rules layer on top of the floor and are fail-open: if
    protected-paths.json is missing or unparsable, one stderr WARNING line
    is printed and the hook exits 0 for anything the floor itself does not
    already cover -- it NEVER crashes, and it NEVER silently protects less
    than the floor.

Fails open (exit 0) on any Python error outside of an actual match -- never
blocks legitimate work silently for reasons unrelated to secrets.
"""
import fnmatch
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None  # extreme fail-open: floor still works without it

# ── Hardcoded floor -- always active, config-independent ───────────────────
FLOOR_FILE_RE = re.compile(r"\.(p12|jks|pfx|pem|key|keystore)$", re.IGNORECASE)
FLOOR_BASH_RE = re.compile(r"openssl\s+pkcs12|keytool\s+-(list|export)", re.IGNORECASE)

READER_PROG = r"\b(cat|type|less|more|head|tail|strings|grep|rg|awk|sed|Get-Content|gc)\b[^|;&]*"


def workspace_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


def brand(workspace: Path) -> str:
    if titan_config:
        try:
            return titan_config.brand(workspace)
        except Exception:
            pass
    return "Titan"


def load_entries(workspace: Path) -> list:
    if not titan_config:
        return []
    try:
        data = titan_config.load_protected(workspace)
        entries = data.get("paths", []) or []
        return entries if isinstance(entries, list) else []
    except Exception:
        return []


def warn_missing_config_once(workspace: Path, entries: list) -> None:
    if entries:
        return
    sys.stderr.write(
        "[TITAN] WARNING: protected-paths.json not found; only the built-in "
        "secret-file floor is active.\n"
    )


def _norm(path: str) -> str:
    return (path or "").replace("\\", "/")


def _glob_match(norm_path: str, glob: str) -> bool:
    if not glob:
        return False
    g = glob.replace("\\", "/")
    try:
        if fnmatch.fnmatch(norm_path, g):
            return True
        stripped = g.lstrip("*/")
        if stripped and fnmatch.fnmatch("/" + norm_path, "*/" + stripped):
            return True
    except Exception:
        pass
    return False


def reader_guard_regex(dirs: list):
    if not dirs:
        return None
    frags = []
    for d in dirs:
        try:
            d = str(d).replace("\\", "/")
            pat = fnmatch.translate(d)
            pat = re.sub(r"\\[Zz](\(\?ms\))?$", "", pat)
            frags.append(pat)
        except Exception:
            continue
    if not frags:
        return None
    try:
        return re.compile(READER_PROG + "(?:" + "|".join(frags) + ")", re.IGNORECASE)
    except Exception:
        return None


def match_file_entry(entries: list, tool_name: str, file_path: str):
    norm = _norm(file_path)
    need = "block_read" if tool_name == "Read" else "block_write"
    for e in entries:
        if not isinstance(e, dict):
            continue
        if not (e.get("enforcement") or {}).get(need):
            continue
        for g in e.get("globs", []) or []:
            if _glob_match(norm, g):
                return e, g
    return None, None


def match_bash_entry(entries: list, command: str):
    for e in entries:
        if not isinstance(e, dict):
            continue
        if not (e.get("enforcement") or {}).get("block_bash"):
            continue
        globs = e.get("globs", []) or []
        if titan_config:
            rx = titan_config.globs_to_regex(globs)
            if rx and rx.search(command):
                return e, "glob"
        for cp in e.get("command_patterns", []) or []:
            if not isinstance(cp, str) or not cp.startswith("regex:"):
                continue
            try:
                if re.search(cp[len("regex:"):], command, re.IGNORECASE):
                    return e, cp
            except Exception:
                continue
        rg = reader_guard_regex(e.get("reader_guard_dirs", []) or [])
        if rg and rg.search(command):
            return e, "reader-guard"
    return None, None


def match_grep_entry(entries: list, target: str):
    for e in entries:
        if not isinstance(e, dict):
            continue
        if not (e.get("enforcement") or {}).get("block_grep"):
            continue
        globs = e.get("globs", []) or []
        if titan_config:
            rx = titan_config.globs_to_regex(globs)
            if rx and rx.search(target):
                return e, "glob"
        rx2 = titan_config.globs_to_regex(e.get("reader_guard_dirs", []) or []) if titan_config else None
        if rx2 and rx2.search(target):
            return e, "reader-dir"
    return None, None


def owner_line(workspace: Path, entry: dict | None) -> str:
    if not entry:
        return "Open the file in your IDE, never via the assistant."
    owners = entry.get("owner_names") or entry.get("owners") or []
    if entry.get("message"):
        return entry["message"]
    if owners:
        return f"Escalate to: {', '.join(owners)}."
    return "Open the file in your IDE, never via the assistant."


def block(workspace: Path, tool_name: str, path_or_cmd: str, why: str, entry: dict | None) -> None:
    b = brand(workspace)
    display = path_or_cmd[:120] + ("..." if len(path_or_cmd) > 120 else "")
    sys.stderr.write("\n")
    sys.stderr.write("=" * 65 + "\n")
    sys.stderr.write(f"[{b.upper()}] PROTECTED FILE -- ACCESS BLOCKED\n")
    sys.stderr.write("=" * 65 + "\n")
    sys.stderr.write(f"  Tool    : {tool_name}\n")
    sys.stderr.write(f"  Target  : {display}\n")
    if why:
        sys.stderr.write(f"  Why     : {why}\n")
    sys.stderr.write("\n")
    sys.stderr.write("  These credentials may not be rotatable. Reading or displaying\n")
    sys.stderr.write("  them in any tool output creates a permanent exposure risk\n")
    sys.stderr.write("  (logs, clipboard, session history).\n")
    sys.stderr.write("\n")
    sys.stderr.write(f"  {owner_line(workspace, entry)}\n")
    sys.stderr.write("=" * 65 + "\n\n")
    sys.exit(1)


def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        sys.exit(0)  # fail open

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    workspace = workspace_root()
    entries = load_entries(workspace)
    warn_missing_config_once(workspace, entries)

    if tool_name in ("Read", "Write", "Edit"):
        file_path = tool_input.get("file_path") or tool_input.get("path") or ""
        if file_path and FLOOR_FILE_RE.search(file_path):
            block(workspace, tool_name, file_path, "Secret-format file extension (built-in floor)", None)
        entry, glob = match_file_entry(entries, tool_name, file_path)
        if entry:
            block(workspace, tool_name, file_path, entry.get("why", ""), entry)

    elif tool_name == "Bash":
        command = tool_input.get("command") or ""
        if command and FLOOR_BASH_RE.search(command):
            block(workspace, tool_name, command, "Secret-export command (built-in floor)", None)
        entry, matched = match_bash_entry(entries, command)
        if entry:
            block(workspace, tool_name, command, entry.get("why", ""), entry)

    elif tool_name == "Grep":
        target = " ".join(str(tool_input.get(k) or "") for k in ("path", "glob", "pattern"))
        entry, matched = match_grep_entry(entries, target)
        if entry:
            block(workspace, tool_name, target, entry.get("why", ""), entry)

    sys.exit(0)


if __name__ == "__main__":
    main()
