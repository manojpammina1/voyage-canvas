'use strict';
/*
 * Single source of truth for "what's in the harness content set, and how do
 * source paths (under harness/) map to target paths (under <repo>/ once
 * deployed)". manifest.js and pack-and-sign.js both import this — they used
 * to each hardcode their own copy of this list, which is exactly the kind
 * of drift deploy-harness.sh's header comment warns about ("keep in sync").
 *
 * This mirrors deploy-harness.sh / electron/main.ts deployHarnessIntoRepo().
 * Excludes `telemetry` (live local data, never touched post-install — see
 * HARNESS-UPDATE-FRAMEWORK.md sec 4) even though deploy-harness.sh's
 * INITIAL-install loop includes it to seed an empty dir on first install.
 */

const path = require('node:path');

const ROOT_FILES = ['CLAUDE.md', '.mcp.json', 'AGENTS.md', 'governance-manifest.json'];
const AGENT_NEUTRAL_DIRS = [
  { src: '.codex', target: '.codex' },
  { src: 'cursor-pack', target: '.cursor' },
  { src: 'governance', target: 'governance' },
  { src: '.github', target: '.github' },
];
const CLAUDE_FILES = ['settings.json', 'pricing.json'];
// cost-tracking and projects added in the 2.4.1 pre-ship audit — main.ts's
// deployHarnessIntoRepo / setup:run-native already deploy both (they live
// at harness/.claude/cost-tracking and harness/.claude/projects), but this
// list — the shared source of truth manifest.js and pack-and-sign.js both
// import — never had them, so a patch built from this list silently missed
// them and could never prune them. Keep the two in sync with main.ts and
// deploy-harness.sh's sub-dir loops.
const CLAUDE_DIRS = ['commands', 'hooks', 'scripts', 'subagents', 'data', 'runbooks', 'cost-tracking', 'projects'];
const SKILLS_SRC_REL = path.posix.join('agents', 'skills');
const SKILLS_TARGET_PREFIX = '.claude/skills/';

/** Walks harnessSrc and returns [{ targetPath, sourcePath }] for every file
 *  in the OTA-managed content set. targetPath is repo-root-relative (what
 *  deploy-harness.sh writes to); sourcePath is absolute, on disk. */
function listHarnessFiles(harnessSrc) {
  const results = [];

  const walk = (absDir, targetPrefix) => {
    const fs = require('node:fs');
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      // __pycache__ is Python-version-pinned bytecode (e.g. cpython-314.pyc),
      // never source -- excluding it here (the single source of truth for
      // "what's in the harness") keeps manifest.js, pack-and-sign.js, and
      // deploy-harness.sh's --update copy all agreeing on the same file set.
      if (entry.name === '__pycache__') continue;
      const abs = path.join(absDir, entry.name);
      const targetPath = path.posix.join(targetPrefix, entry.name);
      if (entry.isDirectory()) {
        walk(abs, targetPath);
      } else if (entry.isFile()) {
        results.push({ targetPath, sourcePath: abs });
      }
    }
  };

  const fs = require('node:fs');
  for (const rel of ROOT_FILES) {
    const abs = path.join(harnessSrc, rel);
    if (fs.existsSync(abs)) results.push({ targetPath: rel, sourcePath: abs });
  }
  for (const { src, target } of AGENT_NEUTRAL_DIRS) {
    const abs = path.join(harnessSrc, src);
    if (fs.existsSync(abs)) walk(abs, target);
  }
  for (const rel of CLAUDE_FILES) {
    const abs = path.join(harnessSrc, rel);
    if (fs.existsSync(abs)) results.push({ targetPath: `.claude/${rel}`, sourcePath: abs });
  }
  for (const dir of CLAUDE_DIRS) {
    const abs = path.join(harnessSrc, dir);
    if (fs.existsSync(abs)) walk(abs, `.claude/${dir}`);
  }
  const skillsAbs = path.join(harnessSrc, SKILLS_SRC_REL);
  if (fs.existsSync(skillsAbs)) walk(skillsAbs, '.claude/skills');

  results.sort((a, b) => (a.targetPath < b.targetPath ? -1 : a.targetPath > b.targetPath ? 1 : 0));
  return results;
}

/** Reverse mapping: manifest targetPath -> path relative to harnessSrc.
 *  Used by pack-and-sign.js to re-locate source files from a manifest that
 *  only stores targetPath (the client-relevant path). Throws on anything
 *  outside the known shape rather than guessing. */
function toSourceRelativePath(targetPath) {
  if (ROOT_FILES.includes(targetPath)) return targetPath;
  if (targetPath.startsWith(SKILLS_TARGET_PREFIX)) {
    return path.posix.join(SKILLS_SRC_REL, targetPath.slice(SKILLS_TARGET_PREFIX.length));
  }
  if (targetPath.startsWith('.claude/')) {
    return targetPath.slice('.claude/'.length);
  }
  throw new Error(`Cannot map manifest path back to a harness source path (unknown shape): ${targetPath}`);
}

module.exports = { listHarnessFiles, toSourceRelativePath };
