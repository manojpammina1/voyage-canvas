#!/usr/bin/env bash
# Cursor pre-tool guard — invokes shared Titan hook logic (credential + protected paths).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS="$ROOT/.claude/hooks"
SCRIPTS="$ROOT/.claude/scripts"

scan_staged() {
  if [ -f "$SCRIPTS/path-guard.py" ]; then
    python "$SCRIPTS/path-guard.py" --staged || return 1
  elif [ -f "$ROOT/governance/../harness/scripts/path-guard.py" ]; then
    python "$ROOT/governance/../harness/scripts/path-guard.py" --staged || return 1
  fi
  return 0
}

if [ -f "$HOOKS/credential-scan.py" ]; then
  # Best-effort: if stdin has file content from Cursor hook JSON, scan it
  if [ -t 0 ]; then
    scan_staged || exit 1
    exit 0
  fi
  CONTENT="$(python -c "
import json, sys
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input') or d.get('input') or {}
    print(ti.get('content') or ti.get('new_string') or ti.get('prompt') or '')
except Exception:
    print('')
" 2>/dev/null || true)"
  if [ -n "$CONTENT" ]; then
    printf '%s' "$CONTENT" | python "$HOOKS/credential-scan.py" --scan-stdin || exit 1
  fi
fi
scan_staged || exit 1
exit 0
