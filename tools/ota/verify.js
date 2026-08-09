#!/usr/bin/env node
'use strict';
/*
 * Titan OTA — manifest + artifact verification.
 *
 * Written as a reusable module (not just a CLI) because M2's client-side
 * updater (harness-update.js, per HARNESS-UPDATE-FRAMEWORK.md sec 3c steps
 * 3-5) needs this EXACT same verification logic — signature check, then
 * per-file hash check against the staged/extracted files. Duplicating this
 * logic between the publish tool and the client updater would let the two
 * drift and silently weaken the client's guarantee. When M2 is built, import
 * verifyManifestObject / verifyExtractedFiles from here (or copy this file
 * into harness/scripts/ verbatim — either way, one implementation).
 *
 * This CLI form only checks a manifest (and optionally an already-extracted
 * directory) — it does not download or extract anything itself.
 *
 * Usage:
 *   node tools/ota/verify.js --manifest dist-ota/manifest.json --pubkey <path> [--artifact-dir <dir>]
 *
 * --files-only (added 2026-07-08, for the unsigned patch path in
 * deploy-harness.sh --update — see tools/ota/README.md "Unsigned patch
 * mode"): skips the signature check entirely and only runs the per-file
 * hash comparison. Requires --artifact-dir. This is NOT a substitute for
 * signed OTA verification — it proves "these files match this manifest",
 * not "this manifest came from someone holding the production key". Use it
 * only for a manually-distributed patch you already trust the source of.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyManifest } = require('./lib/crypto');

/** Signature-only check. Returns { ok, reason }. */
function verifyManifestObject(manifest, publicKeyPem) {
  if (manifest.schemaVersion !== 1) {
    return { ok: false, reason: `unsupported schemaVersion: ${manifest.schemaVersion}` };
  }
  if (manifest.paused) {
    return { ok: false, reason: 'manifest is paused (kill-switch) — no-op, not an error' };
  }
  if (!verifyManifest(manifest, publicKeyPem)) {
    return { ok: false, reason: 'signature verification FAILED — manifest rejected' };
  }
  return { ok: true, reason: 'signature valid' };
}

/** Per-file hash check against an already-extracted staging directory.
 *  Returns { ok, mismatches: [{path, expected, actual|'MISSING'}] }. */
function verifyExtractedFiles(manifest, extractedDir) {
  const mismatches = [];
  for (const file of manifest.files) {
    const abs = path.join(extractedDir, file.path);
    if (!fs.existsSync(abs)) {
      mismatches.push({ path: file.path, expected: file.sha256, actual: 'MISSING' });
      continue;
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    if (hash !== file.sha256) {
      mismatches.push({ path: file.path, expected: file.sha256, actual: hash });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.replace(/^--/, '');
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filesOnly = args['files-only'] === true;

  if (!args.manifest || (!filesOnly && !args.pubkey) || (filesOnly && !args['artifact-dir'])) {
    console.error('Usage: node tools/ota/verify.js --manifest <path> --pubkey <path> [--artifact-dir <dir>]');
    console.error('   or: node tools/ota/verify.js --manifest <path> --files-only --artifact-dir <dir>   (unsigned — hash check only, see header comment)');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(path.resolve(args.manifest), 'utf-8'));

  if (filesOnly) {
    console.log('Signature: SKIPPED (--files-only — unsigned patch check, not proof of provenance)');
  } else {
    const publicKeyPem = fs.readFileSync(path.resolve(args.pubkey), 'utf-8');
    const sigResult = verifyManifestObject(manifest, publicKeyPem);
    console.log(`Signature: ${sigResult.ok ? 'OK' : 'FAIL'} — ${sigResult.reason}`);
    if (!sigResult.ok) process.exit(1);
  }

  console.log(`Manifest: harnessVersion=${manifest.harnessVersion} sequence=${manifest.sequence} channel=${manifest.channel} files=${manifest.files.length}`);

  if (args['artifact-dir']) {
    const fileResult = verifyExtractedFiles(manifest, path.resolve(args['artifact-dir']));
    if (fileResult.ok) {
      console.log(`Per-file hashes: OK — all ${manifest.files.length} file(s) match.`);
    } else {
      console.log(`Per-file hashes: FAIL — ${fileResult.mismatches.length} mismatch(es):`);
      for (const m of fileResult.mismatches) console.log(`  ${m.path}: expected ${m.expected}, got ${m.actual}`);
      process.exit(1);
    }
  }

  console.log('\nVERIFY PASSED.');
}

if (require.main === module) main();

module.exports = { verifyManifestObject, verifyExtractedFiles };
