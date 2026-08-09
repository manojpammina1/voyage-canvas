#!/usr/bin/env node
/*
 * Titan scheduled telemetry uploader.
 *
 * Runs out-of-band of the Electron Dashboard so usage events upload to Azure
 * Blob even when the Dashboard is closed. Bundled in harness/scripts/, called
 * from telemetry-upload.bat which the installer registers as a Windows
 * Scheduled Task (every 4 h).
 *
 * Reads:
 *   - <workspace>/.claude/settings.local.json env:
 *       TITAN_TELEMETRY_SAS_URL      (the SAS URL)
 *       CLAUDE_TELEMETRY             (set to "off" to disable)
 *   - <workspace>/.claude/telemetry/events-YYYY-MM-DD.jsonl  (non-uploaded files)
 *   - <workspace>/<repo>/.claude/telemetry/events-*.jsonl  (per-repo dirs — v2.3.2
 *       deploys the harness into every cloned repo, so repo-rooted Claude Code
 *       sessions write telemetry under the repo, not the workspace root. Sweeping
 *       these here is what keeps the dashboard complete; without it, events from
 *       sessions opened inside a repo never reach Azure.)
 *
 * Writes:
 *   - Uploads each file to <SAS-base>/<userHash>/<date>/<epoch>-<rand>.jsonl
 *   - Renames local files: events-YYYY-MM-DD.jsonl -> events-YYYY-MM-DD.uploaded.jsonl
 *   - Appends a log line to <workspace>/.claude/telemetry/upload.log
 *
 * Usage:
 *   node telemetry-upload.js <workspace-path>
 *
 * Fail-silent on every error; never throws to the OS scheduler.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { URL } = require('node:url');

function log(workspace, line) {
  try {
    const f = path.join(workspace, '.claude', 'telemetry', 'upload.log');
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${line}\n`, { encoding: 'utf-8' });
  } catch { /* ignore */ }
}

function readSettingsEnv(workspace) {
  try {
    const p = path.join(workspace, '.claude', 'settings.local.json');
    const raw = fs.readFileSync(p, 'utf-8');
    const cfg = JSON.parse(raw);
    return (cfg && cfg.env) || {};
  } catch {
    return {};
  }
}

// Same salt source as titan_config.py:telemetry_salt -- reads
// titan.config.json's telemetry.salt so the JS uploader and the Python hooks
// never diverge on user-hash identity. Fail-open to a fixed default.
function readTelemetrySalt(workspace) {
  const candidates = [
    path.join(workspace, '.claude', 'titan.config.json'),
    path.join(__dirname, '..', 'titan.config.json'),
  ];
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (cfg && cfg.telemetry && cfg.telemetry.salt) return cfg.telemetry.salt;
    } catch { /* try next candidate */ }
  }
  return 'TITAN-DEFAULT-SALT';
}

function computeUserHash(workspace) {
  const salt = readTelemetrySalt(workspace);
  const user = process.env.USERNAME || process.env.USER || 'anonymous';
  return crypto.createHash('sha256').update(`${salt}:${user}`).digest('hex').slice(0, 16);
}

// Describe a SAS URL for logging WITHOUT ever exposing the signature. Only
// non-secret query params (expiry, permissions, resource) are safe to log —
// `sig` is the actual credential and must never reach upload.log.
function describeSasSafely(sasUrl) {
  try {
    const u = new URL(sasUrl);
    const se = u.searchParams.get('se');   // expiry, e.g. 2026-07-10T00:00:00Z
    const sp = u.searchParams.get('sp');   // permissions, e.g. "cw" (create+write)
    const sr = u.searchParams.get('sr');   // resource type
    const hasSig = u.searchParams.has('sig');
    let expiryNote = 'no se= param (cannot determine expiry)';
    if (se) {
      const expiry = new Date(se);
      if (!isNaN(expiry.getTime())) {
        const msLeft = expiry.getTime() - Date.now();
        expiryNote = msLeft < 0
          ? `EXPIRED ${Math.round(-msLeft / 3_600_000)}h ago (se=${se})`
          : `valid, expires in ${Math.round(msLeft / 3_600_000)}h (se=${se})`;
      }
    }
    return `host=${u.hostname} container=${u.pathname.replace(/^\//, '')} sr=${sr || '?'} sp=${sp || '?'} hasSig=${hasSig} expiry=${expiryNote}`;
  } catch (e) {
    return `unparseable SAS URL (${e.message})`;
  }
}

function putBlob(sasBaseUrl, blobPath, body) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(sasBaseUrl); }
    catch (e) { resolve({ ok: false, status: 0, error: 'Bad SAS URL' }); return; }

    const containerPath = u.pathname.replace(/\/+$/, '');
    u.pathname = `${containerPath}/${blobPath}`;

    const req = https.request({
      method: 'PUT',
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-version':   '2021-08-06',
        'Content-Type':   'application/x-ndjson',
        'Content-Length': String(body.length),
      },
    }, (res) => {
      let respBody = '';
      res.on('data', (c) => { respBody += c.toString(); });
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status === 201 || status === 200) resolve({ ok: true, status });
        // 800 chars (was 200) — Azure's <AuthenticationErrorDetail> (the actual
        // "why": expired signature, clock skew, wrong permission scope, revoked
        // policy) lands past the first 200 chars of the XML body and was being
        // silently cut off, leaving only the generic <Code>AuthenticationFailed</Code>.
        else                                  resolve({ ok: false, status, error: respBody.slice(0, 800) });
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
    req.write(body);
    req.end();
  });
}

/** Upload every non-uploaded events-*.jsonl in one telemetry dir. Returns
 *  { uploaded, bytes, failed }. Fail-silent per file; stops that dir on the
 *  first HTTP failure (likely a bad SAS/network — no point hammering). */
async function uploadDir(telDir, sas, userHash, logWorkspace) {
  let uploaded = 0, bytes = 0, failed = false;
  let entries;
  try {
    entries = fs.readdirSync(telDir)
      .filter((e) => e.startsWith('events-') && e.endsWith('.jsonl') && !e.includes('.uploaded'));
  } catch { return { uploaded, bytes, failed }; }
  if (entries.length === 0) return { uploaded, bytes, failed };

  for (const fname of entries) {
    const fpath = path.join(telDir, fname);
    let body;
    try { body = fs.readFileSync(fpath); }
    catch (e) { log(logWorkspace, `Read failed: ${telDir}/${fname} (${e.message})`); continue; }

    if (body.length === 0) {
      try { fs.renameSync(fpath, fpath.replace(/\.jsonl$/, '.uploaded.jsonl')); } catch { /* ignore */ }
      continue;
    }

    const datePart = fname.replace(/^events-/, '').replace(/\.jsonl$/, '');
    // epoch + random suffix so two dirs uploading the same date in the same ms
    // can never collide on the blob name.
    const rand = crypto.randomBytes(3).toString('hex');
    const blobPath = `${userHash}/${datePart}/${Date.now()}-${rand}.jsonl`;

    const put = await putBlob(sas, blobPath, body);
    if (!put.ok) {
      log(logWorkspace, `Upload failed for ${telDir}/${fname}: HTTP ${put.status} ${put.error || ''}`);
      failed = true;
      break;  // stop this dir on first failure
    }
    uploaded++;
    bytes += body.length;
    try { fs.renameSync(fpath, fpath.replace(/\.jsonl$/, '.uploaded.jsonl')); } catch { /* ignore */ }
  }
  return { uploaded, bytes, failed };
}

async function main() {
  const workspace = process.argv[2];
  if (!workspace || !fs.existsSync(workspace)) {
    console.error('Usage: node telemetry-upload.js <workspace-path>');
    process.exit(0);
  }

  // SAS + disable flag come from the workspace-root settings.local.json — the
  // per-repo copies are seeded identically, so one read drives all uploads.
  const env = readSettingsEnv(workspace);
  if ((env.CLAUDE_TELEMETRY || '').toLowerCase() === 'off') {
    log(workspace, 'Skip: telemetry disabled (CLAUDE_TELEMETRY=off)');
    return;
  }
  const sas = env.TITAN_TELEMETRY_SAS_URL || '';
  if (!sas.startsWith('https://')) {
    log(workspace, 'Skip: no SAS URL configured in settings.local.json env');
    return;
  }
  // Diagnostic only — never logs the signature itself, only expiry/scope
  // parsed from the URL. This is what tells you WHY a 403 is happening
  // (expired vs wrong scope) without having to decode anything by hand.
  log(workspace, `SAS check: ${describeSasSafely(sas)}`);

  // Build the set of telemetry dirs: workspace root + every immediate subdir
  // that has one (the per-repo harness deploys from v2.3.2).
  const telDirs = [];
  const rootTel = path.join(workspace, '.claude', 'telemetry');
  if (fs.existsSync(rootTel)) telDirs.push(rootTel);
  try {
    for (const e of fs.readdirSync(workspace, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const sub = path.join(workspace, e.name, '.claude', 'telemetry');
      if (fs.existsSync(sub)) telDirs.push(sub);
    }
  } catch { /* workspace unreadable — root-only */ }

  if (telDirs.length === 0) {
    log(workspace, 'Skip: no telemetry directory');
    return;
  }

  const userHash = computeUserHash(workspace);
  let totalFiles = 0, totalBytes = 0, dirsWithData = 0;
  for (const dir of telDirs) {
    const r = await uploadDir(dir, sas, userHash, workspace);
    if (r.uploaded > 0) dirsWithData++;
    totalFiles += r.uploaded;
    totalBytes += r.bytes;
  }

  log(workspace, totalFiles > 0
    ? `Uploaded ${totalFiles} file(s), ${totalBytes} bytes across ${dirsWithData} dir(s) of ${telDirs.length} scanned`
    : `Nothing to upload (${telDirs.length} telemetry dir(s) scanned)`);
}

main().catch((err) => {
  try {
    const ws = process.argv[2];
    if (ws) log(ws, `Fatal: ${err && err.message}`);
  } catch { /* ignore */ }
  process.exit(0);
});
