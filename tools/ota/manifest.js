#!/usr/bin/env node
'use strict';
/*
 * Titan OTA — manifest generator (M1, publish-side, maintainer/super only).
 *
 * File-list shape (which dirs/files are in scope, source->target mapping)
 * lives in lib/harness-layout.js — the single source of truth shared with
 * pack-and-sign.js, so the two can't drift apart on what "the harness
 * content set" means (see that file's header comment for why this matters).
 *
 * Usage:
 *   node tools/ota/manifest.js \
 *     --harness-src ../harness \
 *     --version 2.5.0 \
 *     --sequence 1 \
 *     --channel canary \
 *     --out manifest.json
 *
 * --sequence is supplied manually for now (no Blob wiring yet to auto-read
 * the last-published sequence — see README "Deferred to M2/M4").
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { listHarnessFiles } = require('./lib/harness-layout');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    out[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return out;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['harness-src', 'version', 'sequence', 'channel', 'out'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required args: ${missing.map((m) => `--${m}`).join(', ')}`);
    console.error('Usage: node tools/ota/manifest.js --harness-src <dir> --version <x.y.z> --sequence <n> --channel <canary|stable> --out <manifest.json>');
    process.exit(1);
  }
  if (!['canary', 'stable'].includes(args.channel)) {
    console.error(`--channel must be "canary" or "stable", got: ${args.channel}`);
    process.exit(1);
  }
  const sequence = Number(args.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) {
    console.error(`--sequence must be a positive integer, got: ${args.sequence}`);
    process.exit(1);
  }

  const harnessSrc = path.resolve(args['harness-src']);
  if (!fs.existsSync(path.join(harnessSrc, 'CLAUDE.md'))) {
    console.error(`--harness-src does not look like the harness/ dir (no CLAUDE.md found): ${harnessSrc}`);
    process.exit(1);
  }

  const entries = listHarnessFiles(harnessSrc);
  if (entries.length === 0) {
    console.error('No files found — refusing to publish an empty manifest.');
    process.exit(1);
  }
  const files = entries.map((e) => ({ path: e.targetPath, sha256: sha256File(e.sourcePath) }));

  const manifest = {
    schemaVersion: 1,
    harnessVersion: args.version,
    sequence,
    channel: args.channel,
    releasedAt: new Date().toISOString(),
    minInstallerVersion: args['min-installer-version'] || '2.4.0',
    paused: false,
    files,
    // "artifact" / "artifactSha256" are filled in by pack-and-sign.js — a
    // manifest is meaningless without a matching tarball, so we deliberately
    // do not claim one here.
    artifact: null,
    artifactSha256: null,
    signature: null,
  };

  fs.writeFileSync(path.resolve(args.out), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Manifest written: ${args.out}`);
  console.log(`  harnessVersion=${manifest.harnessVersion} sequence=${manifest.sequence} channel=${manifest.channel}`);
  console.log(`  ${files.length} file(s) hashed.`);
  console.log('\nNext: node tools/ota/pack-and-sign.js --manifest <out> --harness-src <dir> --key <private-key-path>');
}

main();
