#!/usr/bin/env bash
# worktree-cleanup.sh -- remove a Claude Code agent worktree and optionally its branch
#
# Usage:
#   bash .claude/scripts/worktree-cleanup.sh <repo> <worktree-name> [--keep-branch]
#
# Examples:
#   bash .claude/scripts/worktree-cleanup.sh storefront-repo fix-cart-saga
#   bash .claude/scripts/worktree-cleanup.sh webapp-repo my-feature --keep-branch
#
# By default the branch claude/<worktree-name> is deleted after removing the worktree.
# Pass --keep-branch to leave the branch (e.g. if the agent's commits need to be pushed).

set -euo pipefail

WORKSPACE="$(cd "$(dirname "$0")/../.." && pwd)"

REPO="${1:-}"
WORKTREE_NAME="${2:-}"
KEEP_BRANCH="${3:-}"

# ── Validate args ─────────────────────────────────────────────────────────────
if [[ -z "$REPO" || -z "$WORKTREE_NAME" ]]; then
  echo ""
  echo "Usage: bash .claude/scripts/worktree-cleanup.sh <repo> <worktree-name> [--keep-branch]"
  echo ""
  echo "Run worktree-list.sh to see active worktrees."
  exit 1
fi

REPO_PATH="$WORKSPACE/$REPO"
WORKTREE_DIR="$REPO_PATH/.claude/worktrees/$WORKTREE_NAME"
BRANCH="claude/$WORKTREE_NAME"

if [[ ! -d "$REPO_PATH/.git" ]]; then
  echo "[worktree-cleanup] ERROR: '$REPO_PATH' is not a git repo."
  exit 1
fi

# ── Remove worktree ───────────────────────────────────────────────────────────
if [[ -d "$WORKTREE_DIR" ]]; then
  echo "[worktree-cleanup] Removing worktree: $WORKTREE_DIR"
  git -C "$REPO_PATH" worktree remove --force "$WORKTREE_DIR"
else
  echo "[worktree-cleanup] Worktree dir not found, pruning stale entries..."
  git -C "$REPO_PATH" worktree prune
fi

# ── Delete branch ─────────────────────────────────────────────────────────────
if [[ "$KEEP_BRANCH" != "--keep-branch" ]]; then
  if git -C "$REPO_PATH" branch --list "$BRANCH" | grep -q "$BRANCH"; then
    echo "[worktree-cleanup] Deleting branch: $BRANCH"
    git -C "$REPO_PATH" branch -d "$BRANCH" 2>/dev/null \
      || echo "[worktree-cleanup] Branch has unmerged commits — use 'git -C \"$REPO_PATH\" branch -D $BRANCH' to force-delete."
  fi
else
  echo "[worktree-cleanup] Keeping branch: $BRANCH"
fi

# ── Emit telemetry ────────────────────────────────────────────────────────────
TELEMETRY_DIR="$WORKSPACE/.claude/telemetry"
TODAY="$(date -u +%Y-%m-%d)"
if [[ -z "${CLAUDE_TELEMETRY:-}" || "$CLAUDE_TELEMETRY" != "off" ]]; then
  mkdir -p "$TELEMETRY_DIR"
  echo "{\"v\":1,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"user\":\"local\",\"role\":\"${CLAUDE_ROLE:-unknown}\",\"tool\":\"_worktree_cleanup\",\"session\":\"${CLAUDE_SESSION_ID:-}\",\"meta\":{\"repo\":\"${REPO}\",\"worktree\":\"${WORKTREE_NAME}\",\"kept_branch\":\"${KEEP_BRANCH:-false}\"}}" \
    >> "$TELEMETRY_DIR/events-$TODAY.jsonl"
fi

echo "[worktree-cleanup] Done."
echo ""
