#!/usr/bin/env python3
"""
Titan -- Skill file protection hook
Hooked into Claude Code PreToolUse for Write and Edit tools.
Blocks all modifications to .claude/ governance files and CLAUDE.md.
Only the 'super' role (toolkit maintainer) may edit governance files.
Leads and architects can deploy and review but cannot alter the toolkit.
Fails open (exit 0) on any Python error -- never silently blocks legitimate code work.
"""
import sys
import json
import os
import re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None

# Only the toolkit maintainer (super) may edit governance configuration.
# Leads and architects have deploy/review authority but NOT toolkit edit authority.
ELEVATED_ROLES = {"super"}

# Paths exempt from developer-role protection (machine-local state, never committed).
EXEMPT_PATHS = [
    r'(^|[/\\])\.claude[/\\]projects[/\\]current\.json$',
    r'(^|[/\\])\.claude[/\\]progress[/\\]',   # task-progress runtime data (task-progress skill)
    r'(^|[/\\])\.claude[/\\]branches[/\\]',   # branch context files (branch skill)
]

# Fallback if titan.config.json governance.locked_paths is unavailable.
DEFAULT_PROTECTED_PATTERNS = [
    r'(^|[/\\])\.claude[/\\]',    # anything inside .claude/ directory
    r'(^|[/\\])CLAUDE\.md$',      # workspace CLAUDE.md
]


def _path_to_pattern(locked_path: str) -> str:
    """Turn a governance.locked_paths entry (e.g. '.claude/', 'CLAUDE.md') into
    a path-matching regex fragment, same shape as the hardcoded defaults."""
    p = locked_path.strip().rstrip("/\\")
    escaped = re.escape(p).replace(r"\.claude", r"\.claude")  # no-op, kept explicit
    if locked_path.rstrip().endswith(("/", "\\")):
        return rf'(^|[/\\]){escaped}[/\\]'
    return rf'(^|[/\\]){escaped}$'


def protected_patterns(workspace: Path) -> list[str]:
    if titan_config:
        try:
            cfg = titan_config.load_config(workspace)
            locked = (cfg.get("governance") or {}).get("locked_paths")
            if locked:
                return [_path_to_pattern(p) for p in locked]
        except Exception:
            pass
    return DEFAULT_PROTECTED_PATTERNS


def is_exempt(path: str) -> bool:
    return any(re.search(p, path) for p in EXEMPT_PATHS)


def is_protected(path: str, patterns: list[str]) -> bool:
    if not path:
        return False
    for pattern in patterns:
        if re.search(pattern, path):
            return True
    return False


def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        sys.exit(0)

    workspace = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())

    # Elevated roles bypass this hook entirely.
    role = os.environ.get("CLAUDE_ROLE", "developer").strip().lower()
    if role in ELEVATED_ROLES:
        sys.exit(0)

    # Extract the file path from the tool input.
    tool_input = data.get("tool_input", {})
    file_path = (
        tool_input.get("file_path")   # Edit tool
        or tool_input.get("path")     # Write tool (some versions)
        or ""
    )

    if is_exempt(file_path):
        sys.exit(0)

    if not is_protected(file_path, protected_patterns(workspace)):
        sys.exit(0)

    brand = titan_config.brand(workspace) if titan_config else "Titan"
    owner_name = ""
    if titan_config:
        try:
            cfg = titan_config.load_config(workspace)
            owner_id = (cfg.get("roles") or {}).get("governance_owner")
            people = (cfg.get("contacts") or {}).get("people") or {}
            owner_name = (people.get(owner_id) or {}).get("name", "")
        except Exception:
            owner_name = ""
    owner_name = owner_name or "the toolkit maintainer (see `?gov governance`)"

    sys.stderr.write("\n" + "=" * 60 + "\n")
    sys.stderr.write(f"[{brand.upper()}] Skill file protection -- write blocked\n")
    sys.stderr.write("=" * 60 + "\n")
    sys.stderr.write(f"  File    : {file_path}\n")
    sys.stderr.write(f"  Role    : {role}\n")
    sys.stderr.write(f"  Requires: super (toolkit maintainer only)\n")
    sys.stderr.write("\n")
    sys.stderr.write("  Governance files are locked to all roles except super.\n")
    sys.stderr.write(f"  To propose a change to the toolkit, contact {owner_name}.\n")
    sys.stderr.write("  Changes go through review before being applied to settings.json.\n")
    sys.stderr.write("=" * 60 + "\n\n")
    sys.exit(1)


if __name__ == "__main__":
    main()
