#!/usr/bin/env bash
# verify-claude-snapshot.sh — T12.3 byte-identical gate for ClaudeAdapter.
#
# Re-renders the github-generic fixture and diffs against the committed
# baseline under tests/snapshots/claude-generic/. Exit 0 = identical.
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
python scripts/titan-render.py "$FIXTURE" "$OUT"

FAIL=0
for rel in CLAUDE.md settings.json data/build-map.json data/protected-paths.json data/qa-env.json data/reviewer-map.json; do
  if ! diff -q "$BASELINE/$rel" "$OUT/$rel" >/dev/null 2>&1; then
    echo "FAIL  $rel differs from baseline"
    diff -u "$BASELINE/$rel" "$OUT/$rel" || true
    FAIL=1
  else
    echo "ok    $rel"
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "RESULT: FAIL — Claude render output is not byte-identical to baseline."
  exit 1
fi

echo ""
echo "RESULT: PASS — Claude render matches committed snapshot."
exit 0
