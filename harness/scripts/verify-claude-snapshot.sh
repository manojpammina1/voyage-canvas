#!/usr/bin/env bash
# verify-claude-snapshot.sh — T12.3 byte-identical gate for ClaudeAdapter.
#
# Re-renders the github-generic fixture and diffs against the committed
# baseline under tests/snapshots/claude-generic/. Exit 0 = identical.
# Render path forces LF (titan_core.write_text); baselines are eol=lf via
# .gitattributes so this gate is meaningful on Windows and macOS/Linux.
#
# Usage (from harness/):
#   bash scripts/verify-claude-snapshot.sh

set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HARNESS_DIR"

FIXTURE="../fixtures/titan.config.github-generic.json"
BASELINE="$HARNESS_DIR/tests/snapshots/claude-generic"
OUT="$HARNESS_DIR/.render/snapshot-verify"

if [ ! -f "$FIXTURE" ]; then
  echo "FAIL: fixture not found: $FIXTURE" >&2
  exit 1
fi

if [ ! -d "$BASELINE" ]; then
  echo "FAIL: baseline not found: $BASELINE" >&2
  exit 1
fi

rm -rf "$OUT"
python3 scripts/titan-render.py --config "$FIXTURE" --target claude --out "$OUT"

FAIL=0
CR_ONLY=0
for rel in CLAUDE.md settings.json data/build-map.json data/protected-paths.json data/qa-env.json data/reviewer-map.json; do
  if ! diff -q "$BASELINE/$rel" "$OUT/$rel" >/dev/null 2>&1; then
    # Diagnose carriage-return-only drift (historical Windows false failure).
    if diff -q <(tr -d '\r' < "$BASELINE/$rel") <(tr -d '\r' < "$OUT/$rel") >/dev/null 2>&1; then
      echo "FAIL  $rel differs from baseline (line endings only — CR/LF)"
      CR_ONLY=1
    else
      echo "FAIL  $rel differs from baseline"
      diff -u "$BASELINE/$rel" "$OUT/$rel" || true
    fi
    FAIL=1
  else
    echo "ok    $rel"
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo ""
  if [ "$CR_ONLY" -ne 0 ]; then
    echo "RESULT: FAIL — content matches after stripping CR, but byte gate requires LF."
    echo "  Fix: ensure renderer uses titan_core.write_text / normalize_lf, and"
    echo "  re-normalize baselines under .gitattributes (eol=lf)."
  else
    echo "RESULT: FAIL — Claude render output is not byte-identical to baseline."
  fi
  exit 1
fi

echo ""
echo "RESULT: PASS — Claude render matches committed snapshot."
exit 0
