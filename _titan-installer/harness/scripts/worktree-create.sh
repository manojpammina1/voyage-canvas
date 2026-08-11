#!/usr/bin/env bash
# worktree-create.sh -- create a named Claude Code agent worktree in a workspace repo
#
# Usage:
#   bash .claude/scripts/worktree-create.sh <repo> <worktree-name> [base-branch]
#
# Examples:
#   bash .claude/scripts/worktree-create.sh storefront-repo fix-cart-saga release/R2026-05
#   bash .claude/scripts/worktree-create.sh "CIF Integration Layer" gql-schema-fix
#
# The worktree is created at:
#   <repo>/.claude/worktrees/<worktree-name>/
# on a new branch:
#   claude/<worktree-name>
#
# If base-branch is omitted, the repo's current HEAD is used.

set -euo pipefail

WORKSPACE="$(cd "$(dirname "$0")/../.." && pwd)"

REPO="${1:-}"
WORKTREE_NAME="${2:-}"
BASE_BRANCH="${3:-}"

# ── Validate args ─────────────────────────────────────────────────────────────
if [[ -z "$REPO" || -z "$WORKTREE_NAME" ]]; then
  echo ""
  echo "Usage: bash .claude/scripts/worktree-create.sh <repo> <worktree-name> [base-branch]"
  echo ""
  echo "Available repos (any workspace subdirectory with a .git):"
  for d in "$WORKSPACE"/*/; do
    r="$(basename "$d")"
    if [[ -d "$d/.git" ]]; then
      echo "  $r"
    fi
  done
  echo ""
  exit 1
fi

REPO_PATH="$WORKSPACE/$REPO"

if [[ ! -d "$REPO_PATH/.git" ]]; then
  echo "[worktree-create] ERROR: '$REPO_PATH' is not a git repo."
  exit 1
fi

WORKTREE_DIR="$REPO_PATH/.claude/worktrees/$WORKTREE_NAME"
BRANCH="claude/$WORKTREE_NAME"

# ── Check for existing worktree ───────────────────────────────────────────────
if [[ -d "$WORKTREE_DIR" ]]; then
  echo "[worktree-create] Worktree already exists: $WORKTREE_DIR"
  git -C "$REPO_PATH" worktree list | grep "$WORKTREE_DIR" || true
  exit 0
fi

# ── Resolve base branch ───────────────────────────────────────────────────────
if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD)"
  echo "[worktree-create] No base branch specified — using current HEAD: $BASE_BRANCH"
fi

# ── Create worktree ───────────────────────────────────────────────────────────
mkdir -p "$REPO_PATH/.claude/worktrees"

echo "[worktree-create] Repo        : $REPO"
echo "[worktree-create] Worktree    : $WORKTREE_DIR"
echo "[worktree-create] Branch      : $BRANCH"
echo "[worktree-create] Base        : $BASE_BRANCH"
echo ""

git -C "$REPO_PATH" worktree add -b "$BRANCH" "$WORKTREE_DIR" "$BASE_BRANCH"

# ── Emit telemetry ────────────────────────────────────────────────────────────
TELEMETRY_DIR="$WORKSPACE/.claude/telemetry"
TODAY="$(date -u +%Y-%m-%d)"
if [[ -z "${CLAUDE_TELEMETRY:-}" || "$CLAUDE_TELEMETRY" != "off" ]]; then
  mkdir -p "$TELEMETRY_DIR"
  echo "{\"v\":1,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"user\":\"local\",\"role\":\"${CLAUDE_ROLE:-unknown}\",\"tool\":\"_worktree_create\",\"session\":\"${CLAUDE_SESSION_ID:-}\",\"meta\":{\"repo\":\"${REPO}\",\"worktree\":\"${WORKTREE_NAME}\",\"branch\":\"${BRANCH}\",\"base\":\"${BASE_BRANCH}\"}}" \
    >> "$TELEMETRY_DIR/events-$TODAY.jsonl"
fi

echo ""
echo "[worktree-create] Done. Agent can now work in:"
echo "  $WORKTREE_DIR"
echo ""
echo "  To remove when done:"
echo "    bash .claude/scripts/worktree-cleanup.sh \"$REPO\" \"$WORKTREE_NAME\""
echo ""
