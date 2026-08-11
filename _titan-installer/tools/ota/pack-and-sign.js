#!/usr/bin/env node
'use strict';
/*
 * Titan OTA — pack + sign (M1, publish-side, maintainer/super only).
 *
 * Takes the unsigned manifest from manifest.js, builds the matching
 * tarball, fills in artifact/artifactSha256, then signs.
 *
 * Two Windows/cross-platform pitfalls found by actually running this against
 * the real harness/ tree (not assumed away):
 *
 * 1. Manifest paths are TARGET-relative (`.claude/commands/x.md` — where the
 *    file lands on a dev machine per deploy-harness.sh), but harness/ on
 *    disk has no `.claude/` subdirectory (commands/, hooks/, etc. live at
 *    harness root, per lib/harness-layout.js's mapping). Feeding tar a file
 *    list of target-relative paths against `-C harnessSrc` fails with
 *    "Cannot stat" for every entry. Fixed by STAGING: copy each source file
 *    to its target-relative path under a temp dir first, then tar that
 *    whole dir — the tarball's internal layout then matches exactly what
 *    the client should extract straight into `.claude/`.
 *
 * 2. Git-for-Windows' bundled tar misparses a bare `C:\...` path given as
 *    the `-f` archive argument as an rsh-style `host:file` remote-tape spec
 *    ("Cannot connect to C: resolve failed") — a known GNU-tar-on-Windows
 *    gotcha. Fixed with `--force-local`, which disables that heuristic.
 *
 * Usage:
 *   node tools/ota/pack-and-sign.js \
 *     --manifest manifest.json \
 *     --harness-src ../harness \
 *     --key tools/ota/.devkeys/dev-signing.private.key \
 *     --pubkey tools/ota/.devkeys/dev-signing.public.pem \
 *     --out-dir dist-ota
 *
 * --pubkey is used only for an immediate self-verify after signing (catch a
 * broken signer before anything is published) — it is never required for
 * signing itself.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { signManifest, verifyManifest } = require('./lib/crypto');
const { toSourceRelativePath } = require('./lib/harness-layout');

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

function copyRecursiveTargetShape(manifestFiles, harnessSrc, stageDir) {
  for (const file of manifestFiles) {
    const srcRel = toSourceRelativePath(file.path);
    const srcAbs = path.join(harnessSrc, srcRel);
    const dstAbs = path.join(stageDir, file.path);
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    fs.copyFileSync(srcAbs, dstAbs);
    // Belt-and-braces: catch a source-tree edit between manifest.js and this
    // step (e.g. a mid-flight commit) before it ships silently mismatched.
    const actual = sha256File(dstAbs);
    if (actual !== file.sha256) {
      throw new Error(`Hash drift detected while staging ${file.path} — harness/ changed since the manifest was built. Re-run manifest.js. expected=${file.sha256} actual=${actual}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['manifest', 'harness-src', 'key', 'out-dir'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required args: ${missing.map((m) => `--${m}`).join(', ')}`);
    process.exit(1);
  }

  const manifestPath = path.resolve(args.manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    console.error('Manifest has no files — run manifest.js first.');
    process.exit(1);
  }
  if (manifest.signature) {
    console.error('Manifest is already signed. Re-run manifest.js to build a fresh unsigned one before re-signing.');
    process.exit(1);
  }

  const harnessSrc = path.resolve(args['harness-src']);
  const outDir = path.resolve(args['out-dir']);
  fs.mkdirSync(outDir, { recursive: true });

  const artifactName = `harness-${manifest.harnessVersion}.tar.gz`;
  const artifactPath = path.join(outDir, artifactName);

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-stage-'));
  try {
    copyRecursiveTargetShape(manifest.files, harnessSrc, stageDir);
    // --force-local: without it, Git-for-Windows' tar treats a `C:\...` -f
    // argument as `host:path` (drive-letter colon) and tries to rsh to a
    // host named "C" — see header comment. Path.relative keeps -C/-f
    // arguments short and colon-free where possible too.
    execFileSync('tar', ['--force-local', '-czf', artifactPath, '-C', stageDir, '.'], { stdio: 'inherit' });
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  manifest.artifact = artifactName;
  manifest.artifactSha256 = sha256File(artifactPath);

  const privateKeyPem = fs.readFileSync(path.resolve(args.key), 'utf-8');
  const signed = signManifest(manifest, privateKeyPem);

  if (args.pubkey) {
    const publicKeyPem = fs.readFileSync(path.resolve(args.pubkey), 'utf-8');
    if (!verifyManifest(signed, publicKeyPem)) {
      console.error('SELF-VERIFY FAILED immediately after signing — refusing to write output. This means sign/verify are not using matching canonicalization, not that the key is wrong.');
      process.exit(1);
    }
    console.log('Self-verify OK (signature checked against --pubkey immediately after signing).');
  } else {
    console.warn('No --pubkey given — skipped self-verify. Run verify.js separately before publishing.');
  }

  const signedManifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(signedManifestPath, JSON.stringify(signed, null, 2) + '\n');

  console.log(`Artifact: ${artifactPath}`);
  console.log(`  artifactSha256=${manifest.artifactSha256}`);
  console.log(`Signed manifest: ${signedManifestPath}`);
  console.log(`\nNext: node tools/ota/verify.js --manifest ${signedManifestPath} --pubkey <public-key-path> [--artifact-dir <extracted-dir>]`);
}

main();
