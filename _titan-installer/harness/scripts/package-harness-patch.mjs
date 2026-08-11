#!/usr/bin/env node
// Builds Artifact 2 from the two-tier 2.4.1+ distribution model: a
// harness-only patch zip for teammates who don't want to run the full .exe
// installer right now. Ships the harness FIXES ONLY (session-ID truncation,
// Zephyr copy, MCP truncation exemption, --prune support, .harness-version
// tracking) -- not the Start Over/connector/git-UI app fixes, which live in
// electron/ and src/ and need the .exe.
//
// Replaces the manual step the user ran by hand up to 2.4.1:
//   Compress-Archive -Path "harness" -DestinationPath "release\titan-harness-<ver>.zip" -Force
//
// That manual command zipped the WHOLE harness/ folder verbatim, including
// dev-only content deploy-harness.sh never reads (harness/.claude-projects,
// harness/docs, __pycache__). This script instead stages only the files
// deploy-harness.sh actually deploys -- the same managed set documented in
// deploy-harness.sh's own copy loop and tools/ota/lib/harness-layout.js's
// CLAUDE_DIRS. Three places now list this set; if you change one, change
// all three (same "keep in sync" contract those two already carry).
//
// Usage: node harness/scripts/package-harness-patch.mjs
//   (wired to `npm run package:harness-patch`)

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');
const harnessRoot = path.join(repoRoot, 'harness');
const releaseDir = path.join(repoRoot, 'release');

// Same gate `npm run package` gets via the "prepackage" npm lifecycle hook --
// this script has its own name, so npm won't trigger that hook automatically.
// A patch zip that ships a settings.json pointing at a hook file that isn't
// in the zip is exactly the failure class check-hook-paths.mjs exists to
// catch (see that file's header) -- worse here, since there's no app install
// step to catch it later, just a silent broken hook on the teammate's machine.
console.log('Running check-hook-paths.mjs...');
const checkResult = spawnSync(process.execPath, [path.join(__dirname, 'check-hook-paths.mjs')], {
  stdio: 'inherit',
});
if (checkResult.status !== 0) {
  console.error('\npackage-harness-patch: aborting -- check-hook-paths.mjs failed.');
  process.exit(1);
}

const version = readFileSync(path.join(harnessRoot, 'VERSION'), 'utf8').trim();
if (!version) {
  console.error('package-harness-patch: harness/VERSION is empty -- refusing to build an unversioned patch.');
  process.exit(1);
}

// Mirrors deploy-harness.sh's copy loop exactly (root files, then the
// commands/hooks/scripts/subagents/data/runbooks/cost-tracking/projects/
// telemetry set, then agents/skills). cost-tracking and projects live under
// harness/.claude/ on disk; everything else lives at harness/ root -- same
// fallback deploy-harness.sh itself checks.
const ROOT_FILES = ['CLAUDE.md', '.mcp.json', 'VERSION', 'settings.json', 'pricing.json'];
const MANAGED_DIRS = ['commands', 'hooks', 'scripts', 'subagents', 'data', 'runbooks', 'cost-tracking', 'projects', 'telemetry'];
const SKILLS_SRC_REL = path.join('agents', 'skills');

function resolveManagedDir(name) {
  const underDotClaude = path.join(harnessRoot, '.claude', name);
  if (existsSync(underDotClaude)) return underDotClaude;
  const atRoot = path.join(harnessRoot, name);
  if (existsSync(atRoot)) return atRoot;
  return null;
}

const stagingRoot = path.join(os.tmpdir(), `titan-harness-patch-${version}-${Date.now()}`);
const stagedHarness = path.join(stagingRoot, 'harness');
mkdirSync(stagedHarness, { recursive: true });

// __pycache__ is Python-version-pinned bytecode, never source -- excluding
// it keeps this in agreement with harness-layout.js's listHarnessFiles(),
// which excludes it for the same reason (see that file's walk() comment).
const copyOpts = { recursive: true, filter: (src) => path.basename(src) !== '__pycache__' };

console.log(`Staging harness ${version} patch contents...`);
for (const rel of ROOT_FILES) {
  const src = path.join(harnessRoot, rel);
  if (existsSync(src)) cpSync(src, path.join(stagedHarness, rel), copyOpts);
}
for (const dir of MANAGED_DIRS) {
  const src = resolveManagedDir(dir);
  if (src) cpSync(src, path.join(stagedHarness, dir), copyOpts);
}
const skillsSrc = path.join(harnessRoot, SKILLS_SRC_REL);
if (existsSync(skillsSrc)) {
  cpSync(skillsSrc, path.join(stagedHarness, SKILLS_SRC_REL), copyOpts);
}

mkdirSync(releaseDir, { recursive: true });
const zipName = `titan-harness-${version}.zip`;
const zipPath = path.join(releaseDir, zipName);

// No new dependency added for zip creation (a new devDependency would need
// Tech Lead review before merge per this session's guardrails) -- reuse the
// same PowerShell Compress-Archive the manual instructions already used.
// This installer is Windows-first (electron-builder targets win, dev
// machines are Windows) so shelling out to PowerShell here carries the same
// platform assumption the rest of the toolchain already makes.
if (process.platform !== 'win32') {
  rmSync(stagingRoot, { recursive: true, force: true });
  console.error(
    'package-harness-patch: zip creation currently shells out to PowerShell Compress-Archive ' +
      '(Windows-only). Staged contents left at: ' + stagedHarness +
      ' -- zip that directory manually (e.g. `cd ' + stagingRoot + ' && zip -r ' + zipPath + ' harness`) and rerun on Windows next time.'
  );
  process.exit(1);
}

console.log(`Compressing to ${zipPath}...`);
if (existsSync(zipPath)) rmSync(zipPath);
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path "${stagedHarness}" -DestinationPath "${zipPath}" -Force`,
], { stdio: 'inherit' });

rmSync(stagingRoot, { recursive: true, force: true });

console.log(`\npackage-harness-patch OK -- ${zipName} written to release/.`);
console.log('Send over Teams with: unzip anywhere, then per repo with its own .claude/:');
console.log('  HARNESS_SRC="<unzipped>/harness" bash "<unzipped>/harness/scripts/deploy-harness.sh" --update --prune <repo-path>');
