#!/usr/bin/env bash
# worktree-list.sh -- list all Claude Code agent worktrees across all workspace repos

set -euo pipefail

WORKSPACE="$(cd "$(dirname "$0")/../.." && pwd)"

# Repo list is discovered, not hardcoded: any workspace subdirectory with a
# .git is a candidate. (An earlier version hardcoded a fixed 5-repo list from
# one reference workspace — that silently stopped finding worktrees in any
# other workspace shape, which is exactly the kind of config-shape assumption
# the Titan extraction's second fixture pass exists to catch.)
REPOS=()
for d in "$WORKSPACE"/*/; do
  [[ -d "$d/.git" ]] && REPOS+=("$(basename "$d")")
done

FOUND=0

echo ""
echo "============================================================"
echo "  Active Claude Code Worktrees"
echo "============================================================"

for REPO in "${REPOS[@]}"; do
  REPO_PATH="$WORKSPACE/$REPO"
  if [[ ! -d "$REPO_PATH/.git" ]]; then
    continue
  fi

  WORKTREE_LINES=$(git -C "$REPO_PATH" worktree list --porcelain 2>/dev/null | grep -A2 "claude/")

  if [[ -z "$WORKTREE_LINES" ]]; then
    continue
  fi

  echo ""
  echo "  Repo: $REPO"
  echo "  ──────────────────────────────────────────────────────"

  # Parse porcelain output: worktree / HEAD / branch
  while IFS= read -r line; do
    key="${line%% *}"
    val="${line#* }"
    case "$key" in
      worktree) WT_PATH="$val" ;;
      HEAD)     WT_HEAD="$val" ;;
      branch)
        WT_BRANCH="${val#refs/heads/}"
        # Only show claude/* branches (skip main worktree)
        if [[ "$WT_BRANCH" == claude/* ]]; then
          WT_NAME="${WT_BRANCH#claude/}"
          echo "  Name   : $WT_NAME"
          echo "  Branch : $WT_BRANCH"
          echo "  Path   : $WT_PATH"
          echo "  HEAD   : ${WT_HEAD:0:12}"
          echo ""
          FOUND=$((FOUND + 1))
        fi
        ;;
    esac
  done < <(git -C "$REPO_PATH" worktree list --porcelain)
done

if [[ $FOUND -eq 0 ]]; then
  echo ""
  echo "  No agent worktrees active."
fi

echo "============================================================"
echo ""
