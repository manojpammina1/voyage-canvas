#!/usr/bin/env node
// Assert every hook command registered in harness/settings.json resolves to a
// real file under harness/. This exists because settings.json once shipped a
// Stop hook pointing at hooks/verify-gate.py while that file was untracked —
// a fresh clone got a hook chain that referenced a file that did not exist.
// Run this before every package/commit that touches harness/settings.json or
// harness/hooks/.
//
// Usage: node harness/scripts/check-hook-paths.mjs

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.join(__dirname, '..');
const settingsPath = path.join(harnessRoot, 'settings.json');

const settingsText = readFileSync(settingsPath, 'utf8');

// Hook commands look like: python "$CLAUDE_PROJECT_DIR/.claude/hooks/foo.py"
// or (legacy, pre-hardening) bash .claude/hooks/foo.sh — match both forms.
const HOOK_CMD_RE = /\.claude\/hooks\/([A-Za-z0-9_.-]+\.(?:py|sh))/g;

const referenced = new Set();
let m;
while ((m = HOOK_CMD_RE.exec(settingsText)) !== null) {
  referenced.add(m[1]);
}

if (referenced.size === 0) {
  console.error('check-hook-paths: found zero hook references in settings.json — regex likely broken, treat as failure.');
  process.exit(1);
}

let missing = 0;
for (const name of [...referenced].sort()) {
  const onDisk = path.join(harnessRoot, 'hooks', name);
  const ok = existsSync(onDisk);
  console.log(`${ok ? 'OK  ' : 'MISS'}  hooks/${name}`);
  if (!ok) missing++;
}

if (missing > 0) {
  console.error(`\ncheck-hook-paths FAILED: ${missing} hook(s) referenced in settings.json but missing from harness/hooks/.`);
  console.error('A fresh clone/deploy would register a hook chain pointing at a file that does not exist.');
  process.exit(1);
}

console.log(`\ncheck-hook-paths OK — all ${referenced.size} referenced hooks present.`);
process.exit(0);
