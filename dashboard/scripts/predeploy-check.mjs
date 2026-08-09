#!/usr/bin/env node
// Predeploy guard — hard-fail if PII or fake-data overlay files made it into
// dist/. Both files are meant to be LOCAL-ONLY (see dashboard/.gitignore):
//   - public/user-map.json  → hash->employee-name map (PII)
//   - public/pr-stats.json  → self-labelled "LOCAL PREVIEW FIXTURE, not real
//                              ADO data" (fake numbers presented as real)
// Vite copies everything under public/ into dist/ verbatim, so either file
// left in place before `npm run build` ships straight to whatever static
// host `dist/` gets pushed to. This script is wired as the `predeploy` npm
// script — run it before any manual deploy step.
//
// Exit codes: 0 = clean, 1 = blocked (one or more forbidden files present).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const FORBIDDEN = [
  { file: 'user-map.json', reason: 'contains real employee names mapped to telemetry hashes (PII)' },
  { file: 'pr-stats.json', reason: 'self-labelled LOCAL PREVIEW FIXTURE — fake PR/cost numbers' }
];

let blocked = false;

for (const { file, reason } of FORBIDDEN) {
  const p = path.join(distDir, file);
  if (existsSync(p)) {
    blocked = true;
    console.error(`BLOCKED: dist/${file} — ${reason}`);
    console.error(`  Fix: rm "${p}" (and confirm public/${file} is not meant to ship).`);
  }
}

if (blocked) {
  console.error('\npredeploy-check failed — do not deploy dist/ as-is.');
  process.exit(1);
}

console.log('predeploy-check passed — no forbidden files in dist/.');
process.exit(0);
