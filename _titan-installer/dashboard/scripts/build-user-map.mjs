#!/usr/bin/env node
// Build a PRIVATE hash -> display-name map for the dashboard's Per-user view.
//
// The telemetry blob stays FULLY ANONYMOUS (each node is a userHash only, e.g.
// 1bad2c528166b12d). This map lets the maintainer identify who's who WITHOUT
// ever putting a name in the blob — so the metadata-only privacy contract is
// preserved. The output contains employee names (PII), so it is gitignored and
// lives ONLY on the dashboard host (the maintainer's machine).
//
// The hash MUST match the uploader exactly (harness/scripts/telemetry-upload.js
// and electron/telemetry-uploader.ts both use this):
//     sha256(config.telemetry.salt + ":" + USERNAME).slice(0, 16)
// Pass the SAME salt your workspace was deployed with via --salt=<value> or
// the TITAN_TELEMETRY_SALT env var (check <workspace>/.claude/titan.config.json
// telemetry.salt) — a mismatched salt silently produces hashes that never
// match any real telemetry event.
//
// Usage:
//   node scripts/build-user-map.mjs --salt=<salt> roster.json > public/user-map.json
//   TITAN_TELEMETRY_SALT=<salt> node scripts/build-user-map.mjs roster.json roster-entry-a.json roster-entry-b.json > public/user-map.json
//
// Accepts any mix of files, in any order:
//   - roster.json format (array, from IT/AD roster):
//       [ { "username": "jblake",  "name": "Jordan Blake" },
//         { "username": "rchen",   "name": "Riley Chen"   } ]
//   - roster-entry.json fragments (single object, self-registered via the
//     installer's optional "Display name" field at TelemetrySetup,
//     electron/main.ts): { "username": "srivera", "name": "Sam Rivera" }
//     One of these lands in <workspace>/.claude/roster-entry.json on each
//     teammate's machine; they share it with the maintainer out-of-band
//     (Teams/email) since it is never uploaded automatically. Drop the files
//     you receive in a folder and pass them all here — later files win on
//     username collision, so put the authoritative roster.json first.

import crypto from 'node:crypto';
import fs from 'node:fs';

const DEFAULT_SALT = 'titan-default-salt'; // must match electron/titan-config.ts DEFAULT_TITAN_CONFIG.telemetry.salt

const args = process.argv.slice(2);
const saltArg = args.find((a) => a.startsWith('--salt='));
const SALT = saltArg ? saltArg.slice('--salt='.length) : (process.env.TITAN_TELEMETRY_SALT || DEFAULT_SALT);
if (SALT === DEFAULT_SALT) {
  console.error(`WARNING: no --salt=<value> or TITAN_TELEMETRY_SALT set — using the unconfigured default salt.` +
    ` This will NOT match a deployed workspace's real telemetry.salt unless it is also unconfigured.`);
}
const nodeHash = (u) => crypto.createHash('sha256').update(`${SALT}:${u}`).digest('hex').slice(0, 16);

const inputPaths = args.filter((a) => !a.startsWith('--salt='));
if (inputPaths.length === 0) {
  console.error('Usage: node scripts/build-user-map.mjs [--salt=<salt>] <roster.json> [roster-entry.json ...] > public/user-map.json');
  process.exit(1);
}

const entries = [];
for (const p of inputPaths) {
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : [parsed];   // fragment = single object
  for (const r of rows) {
    if (r && r.username) entries.push(r);
    else console.error(`Skipped malformed entry in ${p}: ${JSON.stringify(r)}`);
  }
}

const map = {};
for (const r of entries) {
  map[nodeHash(r.username)] = r.name || r.username;
}

process.stdout.write(JSON.stringify(map, null, 2) + '\n');
console.error(`Mapped ${Object.keys(map).length} user(s) from ${inputPaths.length} file(s). Save to dashboard/public/user-map.json (gitignored, dashboard-only).`);
