#!/usr/bin/env bash
# Titan harness -- scripted harness deploy (headless equivalent of the
# Electron installer's Phase 3 "Deploying Framework Files" step, main.ts:560+).
#
# RENDER OVERLAY (Titan extraction plan Section B.4 / Residual risk #1):
# titan.config.json drives a render step (titan-render.py) that produces
# CLAUDE.md, data/*.json and settings.json filled in from config -- these
# differ, by design, from the raw template source under harness/. A patch
# run (--update) ends by hash-verifying target files against $HARNESS_SRC;
# comparing against the RAW template would therefore always fail once
# rendering is live. This script resolves that by rendering FIRST into an
# "effective source" overlay (harness/.render/effective -- raw harness
# source with the rendered files copied on top) and pointing every
# subsequent copy_file/copy_dir/prune_dir/manifest.js call at that overlay
# by reassigning $HARNESS_SRC to it. Hash-verify therefore compares against
# what was ACTUALLY deployed post-render, not the pre-render template --
# see "Render overlay" section below for the implementation.
#
# Use this to deploy the harness into a repo that has its own .git and was
# never picked as the installer's workspacePath -- e.g. Ecommerce/, which is
# nested inside the ecom-webapp workspace but is its own git repo, so a
# Claude Code session started at its root only sees Ecommerce/.claude/ (empty
# except settings.local.json), not the parent workspace's harness.
#
# Default mode NEVER overwrites an existing file/dir at the destination --
# same skip-if-exists behavior as the Electron installer, so a repo's
# settings.local.json (PATs, tokens) is always preserved. This is correct for
# a FIRST-TIME deploy but means a plain re-run does nothing once hooks/ +
# settings.json already exist -- by design, not a bug (see M1 progress notes,
# 2026-07-08, "crush propagation" -- discovered the hard way).
#
# --update MODE (added 2026-07-08, interim substitute for signed OTA while
# Key Vault provisioning is stuck with DevOps -- see docs/HARNESS-UPDATE.md
# and tools/ota/README.md "Unsigned patch mode"): force-overwrites every file
# in the managed harness content set (per lib/harness-layout.js) instead of
# skipping it, so an ALREADY-deployed repo actually receives new/changed
# files. Still NEVER touches settings.local.json -- that file was never part
# of the managed set to begin with, and this mode explicitly refuses to
# honor SETTINGS_LOCAL_SRC even if set, as a second, code-level guarantee
# rather than relying on caller discipline alone. Verified by per-file hash
# check (tools/ota/manifest.js + verify.js --files-only) after copying, not
# by a signature no one can produce yet.
#
# Every --update run snapshots whatever it's about to overwrite into
# .claude/update-backups/<UTC-timestamp>/ FIRST (inside .claude/, so it's
# already covered by the .git/info/exclude entries below -- no separate
# exclude rule needed). Files that didn't exist before this update are
# recorded in that snapshot's NEW_FILES.txt instead of being "backed up",
# so --rollback can correctly DELETE them rather than restore garbage.
#
# --rollback MODE: restores the most recent .claude/update-backups snapshot
# (or a specific one via --to <timestamp>) -- reverses exactly one --update
# run. Does not delete the snapshot after restoring, so rolling forward
# again (re-running --update) or repeating the rollback both stay possible.
#
# --prune (added, must be combined with --update -- 2.4.1 pre-ship audit):
# --update alone COPIES the managed set but never deletes -- a file that was
# removed from the harness source (e.g. a dead script deleted in Phase 3 of
# the audit) stays orphaned on every already-deployed repo forever. --prune
# closes that gap: after the normal copy pass, it walks each managed dir
# under the deploy target, and any file present there but absent from the
# CURRENT harness source tree is treated exactly like an overwrite for backup
# purposes (backup_before_overwrite -- it existed, so it is snapshotted into
# this run's BACKUP_DIR/files/), then removed from the target. Because the
# backup path is identical to the overwrite path, --rollback needs NO changes
# to restore a pruned file -- it is just another file present in files/.
# Never touches settings.local.json or telemetry/ -- prune walks only the
# CLAUDE_DIRS managed set (see the copy loop below), same scope as --update.
#
# Usage:
#   bash deploy-harness.sh [--update [--prune]] <target-repo-path>
#   bash deploy-harness.sh --rollback [--to <timestamp>] <target-repo-path>
#
# Run from the harness source repo (harness/ must resolve relative
# to this script), or set HARNESS_SRC explicitly.

set -euo pipefail

UPDATE_MODE=0
ROLLBACK_MODE=0
PRUNE_MODE=0
ROLLBACK_TO=""
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --update) UPDATE_MODE=1; shift ;;
    --rollback) ROLLBACK_MODE=1; shift ;;
    --prune) PRUNE_MODE=1; shift ;;
    --to) ROLLBACK_TO="${2:-}"; shift 2 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [ "$UPDATE_MODE" = "1" ] && [ "$ROLLBACK_MODE" = "1" ]; then
  echo "ERROR: --update and --rollback are mutually exclusive." >&2
  exit 1
fi
if [ "$PRUNE_MODE" = "1" ] && [ "$UPDATE_MODE" != "1" ]; then
  echo "ERROR: --prune requires --update (pruning only makes sense as part of a patch run)." >&2
  exit 1
fi

TARGET="${POSITIONAL[0]:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: bash deploy-harness.sh [--update] <target-repo-path>" >&2
  echo "       bash deploy-harness.sh --rollback [--to <timestamp>] <target-repo-path>" >&2
  exit 1
fi
if [ ! -d "$TARGET" ]; then
  echo "ERROR: target path does not exist: $TARGET" >&2
  exit 1
fi
TARGET="$(cd "$TARGET" && pwd)"   # normalize -- backup/restore path math below assumes no trailing slash, absolute
if [ "$UPDATE_MODE" = "1" ] && [ -n "${SETTINGS_LOCAL_SRC:-}" ]; then
  echo "NOTE: --update mode ignores SETTINGS_LOCAL_SRC unconditionally -- settings.local.json is never touched by a patch." >&2
  SETTINGS_LOCAL_SRC=""
fi

BACKUPS_ROOT="$TARGET/.claude/update-backups"

if [ "$ROLLBACK_MODE" = "1" ]; then
  if [ ! -d "$BACKUPS_ROOT" ]; then
    echo "ERROR: no backups found at $BACKUPS_ROOT -- nothing to roll back." >&2
    exit 1
  fi
  if [ -n "$ROLLBACK_TO" ]; then
    CHOSEN="$BACKUPS_ROOT/$ROLLBACK_TO"
    if [ ! -d "$CHOSEN" ]; then
      echo "ERROR: no backup named '$ROLLBACK_TO' under $BACKUPS_ROOT" >&2
      echo "Available backups:" >&2
      ls -1 "$BACKUPS_ROOT" >&2
      exit 1
    fi
  else
    CHOSEN="$(find "$BACKUPS_ROOT" -maxdepth 1 -mindepth 1 -type d | sort | tail -1)"
    if [ -z "$CHOSEN" ]; then
      echo "ERROR: $BACKUPS_ROOT exists but has no backup snapshots inside it." >&2
      exit 1
    fi
  fi

  echo "Rolling back $TARGET"
  echo "Using backup : $(basename "$CHOSEN")"
  echo

  restored=0
  removed=0

  if [ -d "$CHOSEN/files" ]; then
    while IFS= read -r rel; do
      mkdir -p "$TARGET/$(dirname "$rel")"
      cp -f "$CHOSEN/files/$rel" "$TARGET/$rel"
      echo "  RESTORED       $TARGET/$rel"
      restored=$((restored+1))
    done < <(cd "$CHOSEN/files" && find . -type f | sed 's#^\./##')
  fi

  if [ -f "$CHOSEN/NEW_FILES.txt" ]; then
    while IFS= read -r rel; do
      [ -z "$rel" ] && continue
      if [ -f "$TARGET/$rel" ]; then
        rm -f "$TARGET/$rel"
        echo "  REMOVED        $TARGET/$rel (did not exist before the update being rolled back)"
        removed=$((removed+1))
      fi
    done < "$CHOSEN/NEW_FILES.txt"
  fi

  echo
  echo "Rollback complete: $restored file(s) restored, $removed file(s) removed."
  echo "NOTE: snapshot left in place at $CHOSEN -- rerun --update to roll forward again, or --rollback again to repeat/pick a different --to."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_SRC="${HARNESS_SRC:-$(cd "$SCRIPT_DIR/.." && pwd)}"   # harness/scripts/../ = harness/

if [ ! -f "$HARNESS_SRC/CLAUDE.md" ]; then
  echo "ERROR: HARNESS_SRC does not look like the harness/ dir: $HARNESS_SRC" >&2
  exit 1
fi

echo "Harness source : $HARNESS_SRC"
echo "Deploy target  : $TARGET"
echo

copied=0
skipped=0
pruned=0

if [ "$UPDATE_MODE" = "1" ]; then
  BACKUP_DIR="$BACKUPS_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$BACKUP_DIR/files"
  : > "$BACKUP_DIR/NEW_FILES.txt"
  echo "Backup snapshot (pre-update state, for --rollback): $BACKUP_DIR"
  echo
fi

# Snapshots $dst (identified by its path relative to $TARGET, $rel) into
# BACKUP_DIR BEFORE it gets overwritten -- or, if it doesn't exist yet,
# records $rel in NEW_FILES.txt so --rollback deletes it instead of trying
# to "restore" a file that never existed. Only called in update mode.
backup_before_overwrite() {
  local dst="$1" rel="$2"
  if [ -f "$dst" ]; then
    mkdir -p "$BACKUP_DIR/files/$(dirname "$rel")"
    cp -f "$dst" "$BACKUP_DIR/files/$rel"
  else
    echo "$rel" >> "$BACKUP_DIR/NEW_FILES.txt"
  fi
}

copy_file() {
  local src="$1" dst="$2"
  if [ ! -f "$src" ]; then return 0; fi
  if [ -e "$dst" ] && [ "$UPDATE_MODE" != "1" ]; then
    echo "  SKIP (exists)  $dst"
    skipped=$((skipped+1))
    return 0
  fi
  if [ "$UPDATE_MODE" = "1" ]; then
    backup_before_overwrite "$dst" "${dst#$TARGET/}"
  fi
  mkdir -p "$(dirname "$dst")"
  cp -f "$src" "$dst"
  if [ "$UPDATE_MODE" = "1" ]; then
    echo "  UPDATED        $dst"
  else
    echo "  DEPLOYED       $dst"
  fi
  copied=$((copied+1))
}

# Deletes any file present under $dst but absent from $src -- i.e. no longer
# part of the harness content set. Only called when PRUNE_MODE=1, and only
# after the corresponding copy_dir has already run for this pair, so
# BACKUP_DIR exists. Reuses backup_before_overwrite for the snapshot: the
# file existed at $dst, so it lands in files/ and --rollback restores it with
# no special-case code.
prune_dir() {
  local src="$1" dst="$2"
  if [ ! -d "$dst" ]; then return 0; fi
  if [ ! -d "$src" ]; then return 0; fi
  local dst_rel_base="${dst#$TARGET/}"
  while IFS= read -r rel; do
    if [ ! -f "$src/$rel" ]; then
      backup_before_overwrite "$dst/$rel" "$dst_rel_base/$rel"
      rm -f "$dst/$rel"
      echo "  PRUNED         $dst/$rel (no longer in harness content set)"
      pruned=$((pruned+1))
    fi
  done < <(cd "$dst" && find . -type f -not -path '*/__pycache__/*' | sed 's#^\./##')
}

copy_dir() {
  local src="$1" dst="$2"
  if [ ! -d "$src" ]; then return 0; fi
  if [ "$UPDATE_MODE" = "1" ]; then
    # Per-file force-overwrite -- never skip the whole dir just because it
    # already exists. That whole-dir skip is exactly right for a first-time
    # deploy and exactly wrong for a patch (an already-deployed repo's
    # hooks/ dir always "exists", so a patch could never land otherwise).
    local dst_rel_base="${dst#$TARGET/}"
    while IFS= read -r rel; do
      mkdir -p "$dst/$(dirname "$rel")"
      backup_before_overwrite "$dst/$rel" "$dst_rel_base/$rel"
      cp -f "$src/$rel" "$dst/$rel"
      echo "  UPDATED        $dst/$rel"
      copied=$((copied+1))
    done < <(cd "$src" && find . -type f -not -path '*/__pycache__/*' | sed 's#^\./##')
    return 0
  fi
  if [ -e "$dst" ]; then
    echo "  SKIP (exists)  $dst/"
    skipped=$((skipped+1))
    return 0
  fi
  mkdir -p "$dst"
  cp -r "$src"/. "$dst"/
  echo "  DEPLOYED       $dst/"
  copied=$((copied+1))
}

# -----------------------------------------------------------------------
# .claude/titan.config.json -- the adopter's config. Deployed ONLY if
# missing, in EITHER mode (first deploy or --update) -- never force-
# overwritten, same second-code-level guarantee already used below for
# settings.local.json. Runs before the render step so the render step can
# always assume a target config exists (freshly-seeded placeholder on a
# first deploy, or the adopter's real edited file on every later run).
# -----------------------------------------------------------------------
echo "-- .claude/titan.config.json (adopter config -- deploy-harness.sh never overwrites this) --"
TITAN_CONFIG_DST="$TARGET/.claude/titan.config.json"
if [ -f "$TITAN_CONFIG_DST" ]; then
  echo "  SKIP (exists)  $TITAN_CONFIG_DST"
  skipped=$((skipped+1))
elif [ -f "$HARNESS_SRC/titan.config.json" ]; then
  mkdir -p "$(dirname "$TITAN_CONFIG_DST")"
  cp -f "$HARNESS_SRC/titan.config.json" "$TITAN_CONFIG_DST"
  echo "  DEPLOYED       $TITAN_CONFIG_DST (placeholder -- configured:false until edited)"
  copied=$((copied+1))
else
  echo "  SKIP           no titan.config.json found under $HARNESS_SRC -- nothing to seed" >&2
fi
echo

# -----------------------------------------------------------------------
# .claude/titan.config.schema.json + titan.config.example.json -- these are
# versioned HARNESS files (part of the toolkit release, not adopter-owned
# data), unlike titan.config.json above. They are force-refreshed on every
# deploy/--update, same as any other managed harness file.
#
# BUG FIXED (found live 2026-08-09): earlier versions of this script only
# ever copied titan.config.json and skipped the schema/example, which made
# `titan-config.py --validate` fail on every deployed repo with "No such
# file" for titan.config.schema.json -- titan-config.py resolves the schema
# relative to its own deployed location (.claude/), it does not fall back
# to the harness source tree. Ship the schema alongside the config always.
# -----------------------------------------------------------------------
echo "-- .claude/titan.config.schema.json + titan.config.example.json (versioned, always refreshed) --"
for f in titan.config.schema.json titan.config.example.json; do
  SRC_F="$HARNESS_SRC/$f"
  DST_F="$TARGET/.claude/$f"
  if [ -f "$SRC_F" ]; then
    mkdir -p "$(dirname "$DST_F")"
    cp -f "$SRC_F" "$DST_F"
    echo "  DEPLOYED       $DST_F"
    copied=$((copied+1))
  else
    echo "  SKIP           no $f found under $HARNESS_SRC" >&2
  fi
done
echo

# -----------------------------------------------------------------------
# Render overlay (Titan extraction plan Section B.4 / Residual risk #1).
#
# Preferred resolution implemented here (over the documented fallback of an
# excluded-files list): render titan-render.py's output into
# $HARNESS_SRC/.render/output using the TARGET's now-guaranteed-to-exist
# config, then build $HARNESS_SRC/.render/effective as a full copy of the
# raw harness source with the rendered files copied on top (rendered wins).
# $HARNESS_SRC is then reassigned to that effective tree for the REST of
# this script -- every copy_file/copy_dir/prune_dir call below, and the
# OTA manifest.js --harness-src argument at the bottom, therefore already
# operate on post-render content with no per-call-site changes needed.
# This was chosen over the RENDERED_FILES exclusion-list fallback because
# an exclusion list only silences the hash mismatch -- it does not make
# hash-verify mean anything for the excluded files ever again. The overlay
# keeps hash-verify meaningful: it compares what was actually deployed.
# -----------------------------------------------------------------------
HARNESS_SRC_RAW="$HARNESS_SRC"
RENDER_OUT="$HARNESS_SRC_RAW/.render/output"
# EFFECTIVE_SRC deliberately lives OUTSIDE $HARNESS_SRC_RAW (a mktemp dir,
# not e.g. $HARNESS_SRC_RAW/.render/effective) -- nesting the merged tree
# inside the tree it's merged FROM makes `cp -r "$HARNESS_SRC_RAW"/. "$dst"/`
# try to copy the destination into itself recursively. ".render/" is still
# the one gitignored name (both RENDER_OUT and this mktemp dir are
# ephemeral build output either way).
EFFECTIVE_SRC="$(mktemp -d -t titan-harness-effective.XXXXXX)"
trap 'rm -rf "$EFFECTIVE_SRC" 2>/dev/null || true' EXIT   # scratch merge dir, never meant to persist

if command -v python >/dev/null 2>&1 \
   && [ -f "$HARNESS_SRC_RAW/scripts/titan-render.py" ] \
   && [ -f "$TITAN_CONFIG_DST" ]; then
  echo "-- Render overlay (titan-render.py) --"
  echo "  Config source  : $TITAN_CONFIG_DST"
  rm -rf "$RENDER_OUT"
  TITAN_RENDER_TARGET="${TITAN_RENDER_TARGET:-claude}"
  RENDER_OK=0
  if [ "$TITAN_RENDER_TARGET" = "all" ] || [ "$TITAN_RENDER_TARGET" = "codex" ] || [ "$TITAN_RENDER_TARGET" = "cursor" ]; then
    if python "$HARNESS_SRC_RAW/scripts/titan-render.py" --config "$TITAN_CONFIG_DST" --target "$TITAN_RENDER_TARGET" --out "$RENDER_OUT" >/dev/null; then
      RENDER_OK=1
    fi
  elif python "$HARNESS_SRC_RAW/scripts/titan-render.py" "$TITAN_CONFIG_DST" "$RENDER_OUT" >/dev/null; then
    RENDER_OK=1
  fi
  if [ "$RENDER_OK" = "1" ]; then
    rm -rf "$EFFECTIVE_SRC"
    mkdir -p "$EFFECTIVE_SRC"
    cp -r "$HARNESS_SRC_RAW"/. "$EFFECTIVE_SRC"/
    rm -rf "$EFFECTIVE_SRC/.render"   # never let the overlay recurse into itself
    while IFS= read -r rel; do
      mkdir -p "$EFFECTIVE_SRC/$(dirname "$rel")"
      cp -f "$RENDER_OUT/$rel" "$EFFECTIVE_SRC/$rel"
      echo "  OVERLAY        $rel (rendered from titan.config.json, replaces template copy)"
    done < <(cd "$RENDER_OUT" && find . -type f -not -name ".render-manifest.json" | sed 's#^\./##')
    HARNESS_SRC="$EFFECTIVE_SRC"
    echo "  Effective src  : $HARNESS_SRC (raw template + rendered overlay -- used for the rest of this run)"
  else
    echo "  WARNING: titan-render.py failed against $TITAN_CONFIG_DST -- deploying the RAW" >&2
    echo "           (unrendered) harness source instead. CLAUDE.md / data/*.json will" >&2
    echo "           contain unfilled {{...}} markers until the config is fixed, and the" >&2
    echo "           OTA hash-verify step below may now legitimately fail if the target" >&2
    echo "           was previously deployed WITH a working render -- fix titan.config.json" >&2
    echo "           and re-run rather than treating that mismatch as a real drift." >&2
  fi
  echo
else
  echo "-- Render overlay skipped (python, titan-render.py, or titan.config.json not found) --"
  echo "  Deploying raw (unrendered) harness source -- CLAUDE.md / data/*.json may contain" >&2
  echo "  unfilled {{...}} template markers." >&2
  echo
fi

echo "-- Root files --"
copy_file "$HARNESS_SRC/CLAUDE.md"   "$TARGET/CLAUDE.md"
copy_file "$HARNESS_SRC/.mcp.json"   "$TARGET/.mcp.json"
if [ -f "$HARNESS_SRC/AGENTS.md" ]; then
  copy_file "$HARNESS_SRC/AGENTS.md" "$TARGET/AGENTS.md"
fi
if [ -f "$HARNESS_SRC/governance-manifest.json" ]; then
  copy_file "$HARNESS_SRC/governance-manifest.json" "$TARGET/governance-manifest.json"
fi

echo "-- Agent-neutral payloads (.codex/, .cursor/, governance/) --"
if [ -d "$HARNESS_SRC/.codex" ]; then
  copy_dir "$HARNESS_SRC/.codex" "$TARGET/.codex"
fi
if [ -d "$HARNESS_SRC/cursor-pack" ]; then
  mkdir -p "$TARGET/.cursor"
  copy_dir "$HARNESS_SRC/cursor-pack" "$TARGET/.cursor"
elif [ -d "$HARNESS_SRC/.cursor" ]; then
  copy_dir "$HARNESS_SRC/.cursor" "$TARGET/.cursor"
fi
if [ -d "$HARNESS_SRC/governance" ]; then
  copy_dir "$HARNESS_SRC/governance" "$TARGET/governance"
fi
if [ -d "$HARNESS_SRC/.github" ]; then
  copy_dir "$HARNESS_SRC/.github" "$TARGET/.github"
fi

echo "-- .claude/settings.json + pricing.json --"
copy_file "$HARNESS_SRC/settings.json" "$TARGET/.claude/settings.json"
copy_file "$HARNESS_SRC/pricing.json"  "$TARGET/.claude/pricing.json"

# .claude/.harness-version -- always written (not skip-if-exists, not part of
# copy_file's backup/rollback bookkeeping): a version marker should always
# reflect the CURRENT truth, on both a first deploy and every --update.
# Added in the 2.4.1 pre-ship audit -- /ops/check-version previously read a
# TOOLKIT_VERSION from a setup-claude-toolkit.sh that doesn't exist in this
# repo, so it reported nothing useful. harness/VERSION is the single source
# of truth (bump it alongside the version-history table in
# harness/commands/ops/check-version.md).
if [ -f "$HARNESS_SRC/VERSION" ]; then
  mkdir -p "$TARGET/.claude"
  cp -f "$HARNESS_SRC/VERSION" "$TARGET/.claude/.harness-version"
  echo "  WROTE          $TARGET/.claude/.harness-version ($(cat "$HARNESS_SRC/VERSION"))"
fi

# Mirrors electron/main.ts's dir list exactly -- keep these two in sync.
# cost-tracking and projects added in the 2.4.1 pre-ship audit -- main.ts's
# setup:run-native already deployed both (harness/.claude/cost-tracking,
# harness/.claude/projects) but this list never had them, so a patch built
# from here silently missed them and could never prune them.
# NOTE: telemetry is copied here (INITIAL deploy only, to seed an empty dir)
# but deliberately excluded from the --prune loop below -- it is live local
# data (per-repo usage events), never part of the managed/patchable content
# set. This matches tools/ota/lib/harness-layout.js's CLAUDE_DIRS, which also
# excludes it.
echo "-- .claude/{commands,hooks,scripts,subagents,data,runbooks,cost-tracking,projects,telemetry} --"
for sub in commands hooks scripts subagents data runbooks cost-tracking projects telemetry; do
  # commands/hooks/scripts/subagents/data/runbooks live at harness root;
  # cost-tracking/projects/telemetry live under harness/.claude/ -- check
  # both, same fallback order as main.ts.
  if [ -d "$HARNESS_SRC/.claude/$sub" ]; then
    copy_dir "$HARNESS_SRC/.claude/$sub" "$TARGET/.claude/$sub"
  elif [ -d "$HARNESS_SRC/$sub" ]; then
    copy_dir "$HARNESS_SRC/$sub" "$TARGET/.claude/$sub"
  fi
done

# skills/ lives at a different source root (harness/agents/skills) -- same
# special-case as the fix applied to electron/main.ts. Keep these two in sync.
echo "-- .claude/skills/ --"
copy_dir "$HARNESS_SRC/agents/skills" "$TARGET/.claude/skills"

if [ "$PRUNE_MODE" = "1" ]; then
  echo "-- Pruning files removed from the harness content set --"
  for sub in commands hooks scripts subagents data runbooks cost-tracking projects; do
    if [ -d "$HARNESS_SRC/.claude/$sub" ]; then
      prune_dir "$HARNESS_SRC/.claude/$sub" "$TARGET/.claude/$sub"
    elif [ -d "$HARNESS_SRC/$sub" ]; then
      prune_dir "$HARNESS_SRC/$sub" "$TARGET/.claude/$sub"
    fi
  done
  prune_dir "$HARNESS_SRC/agents/skills" "$TARGET/.claude/skills"
  if [ "$pruned" = "0" ]; then
    echo "  (nothing to prune)"
  fi
fi

# Adopter repos are not assumed to gitignore .claude/ -- without this, the
# deployed harness (and any future settings.local.json holding PATs) shows
# up as committable untracked files in the repo. .git/info/exclude is the
# local-only ignore: per-clone, never committed, no change to the repo's
# own .gitignore.
#
# IDEMPOTENCY KEY (Titan extraction plan Residual Risk #2, see
# docs/HARNESS-UPDATE.md): the literal string below ("Titan harness") is how
# this script detects "have I already added my exclude block to this repo".
# It was renamed from the marker string used by the company-specific
# reference installer this harness was extracted from. KNOWN, ACCEPTED
# CONSEQUENCE: any repo that was deployed by that OLDER, pre-extraction
# installer (a different marker string) will not match this new string, so
# it gets a SECOND, duplicate exclude block appended the next time --update
# (or a plain deploy) runs against it.
# Duplicate `.claude/` / `CLAUDE.md` / etc. ignore lines are harmless to
# git -- this is a one-time cosmetic duplication, not a functional bug --
# but it is worth knowing about before you go looking for why a repo has
# two near-identical blocks in .git/info/exclude. Do not rename this marker
# again without expecting the same one-time duplication for every repo
# already deployed under the CURRENT string.
echo "-- .git/info/exclude (prevent accidental harness commit) --"
if [ -d "$TARGET/.git" ]; then
  EXCLUDE="$TARGET/.git/info/exclude"
  mkdir -p "$(dirname "$EXCLUDE")"
  if ! grep -q "Titan harness" "$EXCLUDE" 2>/dev/null; then
    printf '\n# Titan harness (deployed locally by deploy-harness.sh / installer) — never commit\n.claude/\nCLAUDE.md\n.mcp.json\nAGENTS.md\n.codex/\n.cursor/\ngovernance/\ngovernance-manifest.json\n.github/workflows/agent-governance.yml\ninstall.py\ntitan-configure.py\n' >> "$EXCLUDE"
    echo "  DEPLOYED       $EXCLUDE entries"
    copied=$((copied+1))
  else
    echo "  SKIP (exists)  $EXCLUDE entries"
    skipped=$((skipped+1))
  fi
else
  echo "  SKIP           $TARGET has no .git (workspace root?) — exclude not needed"
fi

# Per-repo sessions need the env block (PATs for MCP \${VAR} expansion,
# telemetry SAS, CLAUDE_ROLE). If a source workspace's settings.local.json is
# provided, copy it -- it is covered by the exclude entries above so it can
# never be committed. Never overwrites an existing one.
if [ -n "${SETTINGS_LOCAL_SRC:-}" ] && [ -f "$SETTINGS_LOCAL_SRC" ]; then
  echo "-- .claude/settings.local.json (env from source workspace) --"
  copy_file "$SETTINGS_LOCAL_SRC" "$TARGET/.claude/settings.local.json"
fi

# -----------------------------------------------------------------------
# .claude/.deployed-manifest.json -- EXPECTED_FILES single source of truth
# (Titan extraction plan Section F, step 18: "a file rename can never
# desync the verifier again"). Snapshots every file CURRENTLY present under
# the managed root files + managed dirs at $TARGET, post-copy -- not just
# what THIS run happened to touch, so it is accurate even after a run that
# was mostly SKIP (exists). titan-configure.py's Phase 8 verification and
# titan-doctor.py both read this file as their EXPECTED_FILES list instead
# of hardcoding filenames, so a hook/subagent rename here is automatically
# reflected there with no separate list to keep in sync. Generated, JSON,
# hand-rolled (no jq / python dependency at this point in the script) --
# paths are trusted filesystem entries, not user input, so no escaping
# beyond the literal path text is needed.
# -----------------------------------------------------------------------
echo "-- .claude/.deployed-manifest.json (EXPECTED_FILES source of truth) --"
MANIFEST_DST="$TARGET/.claude/.deployed-manifest.json"
mkdir -p "$(dirname "$MANIFEST_DST")"
{
  printf '{\n'
  printf '  "_description": "Every file this deploy manages, relative to the target workspace root. Generated by deploy-harness.sh -- do not hand-edit. Read by titan-configure.py (Phase 8 verification) and titan-doctor.py as the single source of truth for EXPECTED_FILES.",\n'
  printf '  "generated_at_utc": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "files": [\n'
  MANIFEST_FIRST=1
  manifest_emit() {
    if [ "$MANIFEST_FIRST" = "0" ]; then printf ',\n'; fi
    printf '    "%s"' "$1"
    MANIFEST_FIRST=0
  }
  for root_rel in "CLAUDE.md" ".mcp.json" ".claude/settings.json" ".claude/pricing.json" \
                  ".claude/titan.config.json" ".claude/.harness-version"; do
    [ -f "$TARGET/$root_rel" ] && manifest_emit "$root_rel"
  done
  for sub in commands hooks scripts subagents data runbooks; do
    subdir="$TARGET/.claude/$sub"
    if [ -d "$subdir" ]; then
      while IFS= read -r f; do
        manifest_emit ".claude/$sub/$f"
      done < <(cd "$subdir" && find . -type f -not -path '*/__pycache__/*' | sed 's#^\./##' | sort)
    fi
  done
  skillsdir="$TARGET/.claude/skills"
  if [ -d "$skillsdir" ]; then
    while IFS= read -r f; do
      manifest_emit ".claude/skills/$f"
    done < <(cd "$skillsdir" && find . -type f | sed 's#^\./##' | sort)
  fi
  printf '\n  ]\n'
  printf '}\n'
} > "$MANIFEST_DST"
echo "  WROTE          $MANIFEST_DST"
echo

if [ "$UPDATE_MODE" = "1" ]; then
  if [ "$PRUNE_MODE" = "1" ]; then
    echo "Done. $copied item(s) updated, $skipped skipped, $pruned pruned."
  else
    echo "Done. $copied item(s) updated, $skipped skipped."
  fi
else
  echo "Done. $copied item(s) deployed, $skipped skipped (already present)."
fi
echo
echo "NOTE: settings.local.json is never touched by this script or by main.ts --"
echo "      if $TARGET/.claude/settings.local.json does not exist yet, the user"
echo "      must run titan-configure.py once inside $TARGET to configure PATs/tokens."

if [ "$UPDATE_MODE" = "1" ]; then
  OTA_TOOLS="$SCRIPT_DIR/../../tools/ota"
  echo
  echo "-- Post-update verification (per-file hash check, no signature) --"
  if [ ! -f "$OTA_TOOLS/manifest.js" ]; then
    echo "  SKIPPED -- tools/ota/ not found relative to this script (only exists in the" >&2
    echo "             harness source repo itself, not in a deployed copy)." >&2
    echo "             The copy above still ran; it just wasn't hash-verified." >&2
  else
    TMP_MANIFEST="$(mktemp -t harness-update-manifest.XXXXXX).json"
    node "$OTA_TOOLS/manifest.js" \
      --harness-src "$HARNESS_SRC" \
      --version "patch-$(date -u +%Y%m%dT%H%M%SZ)" \
      --sequence 1 \
      --channel canary \
      --out "$TMP_MANIFEST" >/dev/null
    if node "$OTA_TOOLS/verify.js" --manifest "$TMP_MANIFEST" --files-only --artifact-dir "$TARGET"; then
      echo "PATCH VERIFIED: every managed file in $TARGET matches the source harness/ tree."
    else
      echo "PATCH VERIFICATION FAILED -- see mismatches above. Do not consider $TARGET patched." >&2
      rm -f "$TMP_MANIFEST"
      exit 1
    fi
    rm -f "$TMP_MANIFEST"
  fi
fi
