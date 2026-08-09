#!/usr/bin/env bash
# poc-deploy-rcg.sh — deploy rendered Titan payloads to RCG POC root (T12.6).
set -euo pipefail

RCG_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HARNESS="$RCG_ROOT/titan/harness"
CONFIG="${1:-$RCG_ROOT/titan.config.json}"
OUT="$RCG_ROOT/.titan-out"

echo "== POC deploy to $RCG_ROOT =="
python3 "$HARNESS/scripts/titan-render.py" --config "$CONFIG" --target all --out "$OUT"

mkdir -p "$RCG_ROOT/.claude"/{hooks,scripts,data,commands,subagents}
cp -f "$OUT/CLAUDE.md" "$RCG_ROOT/CLAUDE.md"
cp -f "$OUT/AGENTS.md" "$RCG_ROOT/AGENTS.md"
cp -f "$OUT/governance-manifest.json" "$RCG_ROOT/governance-manifest.json"
cp -f "$OUT/settings.json" "$RCG_ROOT/.claude/settings.json"
cp -f "$OUT/data/"*.json "$RCG_ROOT/.claude/data/"
cp -f "$CONFIG" "$RCG_ROOT/.claude/titan.config.json"
cp -rf "$OUT/governance" "$RCG_ROOT/governance"
cp -rf "$OUT/.codex" "$RCG_ROOT/.codex"
mkdir -p "$RCG_ROOT/.cursor"
if cp -rf "$OUT/cursor-pack/"* "$RCG_ROOT/.cursor/" 2>/dev/null; then
  echo "  cursor-pack -> .cursor/"
else
  cp -rf "$OUT/cursor-pack" "$RCG_ROOT/cursor-pack"
  echo "  NOTE: copied cursor-pack/ (rename to .cursor/ if needed)"
fi
mkdir -p "$RCG_ROOT/.github/workflows"
cp -f "$OUT/.github/workflows/agent-governance.yml" "$RCG_ROOT/.github/workflows/"
cp -rf "$HARNESS/hooks/"*.py "$RCG_ROOT/.claude/hooks/"
cp -f "$HARNESS/scripts/path-guard.py" "$RCG_ROOT/.claude/scripts/"
cp -rf "$HARNESS/commands" "$RCG_ROOT/.claude/"
cp -rf "$HARNESS/subagents" "$RCG_ROOT/.claude/"
cp -f "$HARNESS/.mcp.json" "$RCG_ROOT/.mcp.json" 2>/dev/null || true
chmod +x "$RCG_ROOT/.codex/hooks/pre-commit" "$RCG_ROOT/.cursor/hooks/pre-tool-guard.sh" 2>/dev/null || true

if [ -d "$RCG_ROOT/.git" ]; then
  mkdir -p "$RCG_ROOT/.git/hooks"
  HOOK_DST="$RCG_ROOT/.git/hooks/pre-commit"
  HOOK_SRC="$RCG_ROOT/.codex/hooks/pre-commit"
  if [ -f "$HOOK_SRC" ]; then
    cp -f "$HOOK_SRC" "$HOOK_DST"
    chmod +x "$HOOK_DST"
    echo "  git pre-commit -> $HOOK_DST"
  else
    echo "  WARNING: $HOOK_SRC not found — pre-commit not installed" >&2
  fi
else
  echo "  NOTE: no .git/ — run 'git init' in $RCG_ROOT then re-run to install pre-commit"
fi

echo "Deployed. Run demo checks:"
echo "  python3 $RCG_ROOT/.claude/hooks/credential-scan.py --scan-file <file>"
echo "  node $RCG_ROOT/.codex/review.mjs"
