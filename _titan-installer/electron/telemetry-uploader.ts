// Telemetry uploader — Phase 2 of Titan usage telemetry.
//
// Reads local JSONL event files written by `telemetry-capture.py` and
// uploads them to the adopter's own Azure Blob endpoint via a SAS URL.
//
// Design:
//   - No Azure SDK dependency — plain HTTPS PUT against the SAS URL
//   - One blob per upload session, named: <userHash>/<YYYY-MM-DD>/<epoch>.jsonl
//   - Successful upload renames the local file `events-YYYY-MM-DD.jsonl` →
//     `events-YYYY-MM-DD.uploaded.jsonl` (so we never re-upload the same data)
//   - Fail-silent on network errors — telemetry never breaks the dashboard
//
// Privacy: same whitelist guarantees as the capture hook. Uploader does NOT
// re-parse / re-shape event content; it streams the JSONL bytes as-is.

import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { URL } from 'node:url';
import { DEFAULT_TITAN_CONFIG } from './titan-config';

export interface UploadResult {
  ok: boolean;
  filesUploaded: number;
  bytesUploaded: number;
  lastError: string | null;
  uploadedAt: string;  // ISO timestamp
}

// The dashboard's read SAS is baked into its build at a different time, by a
// different person, on a different machine than the write SAS entered here —
// there is no runtime channel between the two processes to actually assert
// they point at the same container (2.4.1 pre-ship audit finding: this was
// the leading suspected cause of "dashboard not pulling in the right
// values" — a user pastes a SAS for the wrong container, upload succeeds,
// the dashboard never sees it, and nothing anywhere says so).
//
// The best available fix without that channel: parse the container name out
// of whatever SAS the user configures and compare it to the ONE documented
// canonical value (dashboard/.env.example — "Read + List on the
// claude-price-dashboard container"), surfaced back to the Dashboard UI so a
// human can catch a typo'd/wrong-container SAS at configuration time instead
// of discovering it weeks later as "the dashboard shows nothing".
export const EXPECTED_TELEMETRY_CONTAINER = 'claude-price-dashboard';

/** Parse the container name out of an Azure Blob SAS URL.
 *  Shape: https://<account>.blob.core.windows.net/<container>?<sas-query>
 *  Returns null if the URL doesn't parse or has no path segment. */
export function parseContainerFromSasUrl(sasUrl: string): string | null {
  try {
    const u = new URL(sasUrl);
    const segment = u.pathname.split('/').filter(Boolean)[0];
    return segment || null;
  } catch {
    return null;
  }
}

export interface LocalSummary {
  totalEvents: number;
  unUploadedFiles: number;
  oldestUnUploadedDate: string | null;
  newestUnUploadedDate: string | null;
  byMode: Record<string, number>;
  bySkill: Record<string, number>;
  byBashProgram: Record<string, number>;
  byTool: Record<string, number>;
  sessions: number;
}

/** Read all `events-*.jsonl` files (not `.uploaded.jsonl`) in the workspace
 *  telemetry dir. Return the list of paths. */
async function listUnUploadedFiles(workspacePath: string): Promise<string[]> {
  const dir = path.join(workspacePath, '.claude', 'telemetry');
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => e.startsWith('events-') && e.endsWith('.jsonl') && !e.includes('.uploaded'))
      .map((e) => path.join(dir, e))
      .sort();
  } catch {
    return [];
  }
}

/** Aggregate local JSONL into a personal usage summary. Skips malformed lines. */
export async function readLocalSummary(workspacePath: string): Promise<LocalSummary> {
  const summary: LocalSummary = {
    totalEvents: 0,
    unUploadedFiles: 0,
    oldestUnUploadedDate: null,
    newestUnUploadedDate: null,
    byMode: {},
    bySkill: {},
    byBashProgram: {},
    byTool: {},
    sessions: 0,
  };

  const dir = path.join(workspacePath, '.claude', 'telemetry');
  let allFiles: string[] = [];
  try {
    allFiles = (await fs.readdir(dir))
      .filter((e) => e.startsWith('events-') && e.endsWith('.jsonl'))
      .map((e) => path.join(dir, e));
  } catch {
    return summary;
  }

  const unUploaded = allFiles.filter((f) => !f.includes('.uploaded'));
  summary.unUploadedFiles = unUploaded.length;

  // Date range from filenames (events-YYYY-MM-DD.jsonl)
  const dates = unUploaded
    .map((f) => path.basename(f).replace(/^events-/, '').replace(/\.(jsonl|uploaded\.jsonl)$/, ''))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  summary.oldestUnUploadedDate = dates[0] ?? null;
  summary.newestUnUploadedDate = dates[dates.length - 1] ?? null;

  const sessionSet = new Set<string>();

  for (const file of allFiles) {
    let text: string;
    try { text = await fs.readFile(file, 'utf-8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      summary.totalEvents++;
      const tool = String(evt.tool ?? 'unknown');
      summary.byTool[tool] = (summary.byTool[tool] ?? 0) + 1;

      const sess = String(evt.session ?? '');
      if (sess) sessionSet.add(sess);

      const meta = (evt.meta as Record<string, unknown> | undefined) ?? {};
      const skillName = String(meta.skill_name ?? '');
      if (skillName) {
        if (skillName.endsWith('-mode') || skillName === 'lead-review' || skillName === 'grill-me') {
          summary.byMode[skillName] = (summary.byMode[skillName] ?? 0) + 1;
        } else {
          summary.bySkill[skillName] = (summary.bySkill[skillName] ?? 0) + 1;
        }
      }
      const bashProg = String(meta.bash_program ?? '');
      if (bashProg) summary.byBashProgram[bashProg] = (summary.byBashProgram[bashProg] ?? 0) + 1;
    }
  }
  summary.sessions = sessionSet.size;
  return summary;
}

/** PUT a file to the SAS-protected Azure Blob URL. Returns ok + size. */
function putBlob(sasBaseUrl: string, blobPath: string, body: Buffer): Promise<{ ok: boolean; status: number; error?: string }> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(sasBaseUrl);
    } catch (e) {
      resolve({ ok: false, status: 0, error: `Bad SAS URL: ${(e as Error).message}` });
      return;
    }
    // SAS URL is shaped like:
    //   https://<account>.blob.core.windows.net/<container>?<sas-query>
    // We want to insert /<blobPath> before the query string.
    const containerPath = u.pathname.replace(/\/+$/, ''); // strip trailing /
    u.pathname = `${containerPath}/${blobPath}`;

    const headers: Record<string, string> = {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2021-08-06',
      'Content-Type': 'application/x-ndjson',
      'Content-Length': String(body.length),
    };

    const req = https.request({
      method: 'PUT',
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers,
    }, (res) => {
      let respBody = '';
      res.on('data', (chunk: Buffer) => { respBody += chunk.toString(); });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status === 201 || status === 200) {
          resolve({ ok: true, status });
        } else {
          resolve({ ok: false, status, error: respBody.slice(0, 200) });
        }
      });
    });
    req.on('error', (err: Error) => resolve({ ok: false, status: 0, error: err.message }));
    req.write(body);
    req.end();
  });
}

/** Expiry (`se=`) of a SAS URL, or null if absent/unparseable. Non-secret —
 *  never returns or logs the `sig` component. */
export function parseSasExpiry(sasUrl: string): Date | null {
  try {
    const se = new URL(sasUrl).searchParams.get('se');
    if (!se) return null;
    const d = new Date(se);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export interface SasVerifyResult {
  ok: boolean;
  userHash: string;
  /** Blob path written on success — quote this to the maintainer to cross-check. */
  blobPath?: string;
  /** Operator-facing reason, already phrased for the installer UI. */
  error?: string;
}

/** Verify a pasted SAS URL by writing a real registration event to Blob under
 *  the user's real hashed id.
 *
 *  Format-only validation was letting two failures through to a finished
 *  install, both of which then 403'd silently on every scheduled upload
 *  forever: an EXPIRED SAS, and a read-only (or wrong-container) SAS pasted in
 *  place of the write one. Neither is distinguishable from a good URL by
 *  shape. The only check that actually proves the upload path works is
 *  performing the upload, so that is what this does.
 *
 *  The id written here is computed by computeUserHash(), the same function the
 *  scheduled uploader (harness/scripts/telemetry-upload.js) uses, so the blob
 *  that lands is under the exact prefix every later upload will use — the
 *  maintainer seeing it appear is proof of the real path, not a proxy for it.
 *
 *  Runs in main, never the renderer: Azure would reject a cross-origin PUT
 *  from a browser context unless CORS rules were added to the storage account.
 *
 *  Deliberately hash-only. displayName stays local in roster-entry.json per the
 *  metadata-only contract in CLAUDE.md — do not add it to this payload. */
export async function verifySasWithRegistration(
  sasBaseUrl: string,
  role: string,
  salt?: string,
): Promise<SasVerifyResult> {
  const userHash = computeUserHash(salt);

  let u: URL;
  try {
    u = new URL(sasBaseUrl);
  } catch {
    return { ok: false, userHash, error: 'Not a valid URL.' };
  }

  const container = parseContainerFromSasUrl(sasBaseUrl);
  if (container !== EXPECTED_TELEMETRY_CONTAINER) {
    return {
      ok: false,
      userHash,
      error: `SAS points at container "${container ?? '(none)'}" — expected "${EXPECTED_TELEMETRY_CONTAINER}". This is probably the dashboard's read URL rather than the upload URL.`,
    };
  }

  const se = u.searchParams.get('se');
  if (se) {
    const expiry = new Date(se);
    if (!isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) {
      return {
        ok: false,
        userHash,
        error: `This SAS expired on ${se}. Ask the toolkit maintainer for a current one.`,
      };
    }
  }

  const now = new Date();
  const event = {
    v: 1,
    ts: now.toISOString(),
    user: userHash,
    role: role || 'developer',
    tool: '_install_registration',
    session: 'install',
    meta: { source: 'installer-onboarding' },
  };
  const body = Buffer.from(JSON.stringify(event) + '\n', 'utf-8');
  const blobPath = `${userHash}/${now.toISOString().slice(0, 10)}/${Date.now()}-install.jsonl`;

  const put = await putBlob(sasBaseUrl, blobPath, body);
  if (put.ok) return { ok: true, userHash, blobPath };

  // Azure buries the actionable reason in <AuthenticationErrorDetail>; the
  // bare <Code>AuthenticationFailed</Code> is the same for expiry, wrong
  // permissions, and a revoked policy, so surface the distinction here rather
  // than making the user decode XML.
  const detail = put.error ?? '';
  if (put.status === 403) {
    if (/Signature not valid in the specified time frame/i.test(detail)) {
      return { ok: false, userHash, error: 'SAS rejected: the signature has expired. Ask the toolkit maintainer for a current URL.' };
    }
    if (/AuthorizationPermissionMismatch|not authorized to perform this operation/i.test(detail)) {
      return { ok: false, userHash, error: 'SAS rejected: this URL lacks write permission (needs create + write). It looks like a read-only URL.' };
    }
    return { ok: false, userHash, error: `SAS rejected by Azure (HTTP 403). Confirm you pasted the upload URL, not the dashboard read URL.` };
  }
  if (put.status === 0) {
    return { ok: false, userHash, error: `Could not reach Azure Blob storage (${detail}). Check your network/VPN and try again.` };
  }
  return { ok: false, userHash, error: `Upload test failed (HTTP ${put.status}). ${detail}` };
}

/** Upload all un-uploaded JSONL files. Renames each file to `.uploaded.jsonl`
 *  on success. Stops + returns first error otherwise. */
export async function uploadBatch(
  workspacePath: string,
  sasBaseUrl: string,
  userHash: string,
): Promise<UploadResult> {
  const result: UploadResult = {
    ok: true,
    filesUploaded: 0,
    bytesUploaded: 0,
    lastError: null,
    uploadedAt: new Date().toISOString(),
  };

  if (!sasBaseUrl || !sasBaseUrl.startsWith('https://')) {
    result.ok = false;
    result.lastError = 'No SAS URL configured. Set one in Dashboard → Usage.';
    return result;
  }

  const files = await listUnUploadedFiles(workspacePath);
  if (files.length === 0) {
    result.uploadedAt = new Date().toISOString();
    return result;  // nothing to do, ok=true
  }

  for (const file of files) {
    let body: Buffer;
    try { body = await fs.readFile(file); } catch (e) {
      result.ok = false;
      result.lastError = `Could not read ${path.basename(file)}: ${(e as Error).message}`;
      return result;
    }
    if (body.length === 0) {
      // Empty file — mark uploaded and continue
      try { await fs.rename(file, file.replace(/\.jsonl$/, '.uploaded.jsonl')); } catch { /* ignore */ }
      continue;
    }

    // Blob path: <userHash>/<YYYY-MM-DD>/<epoch-ms>.jsonl
    const datePart = path.basename(file)
      .replace(/^events-/, '')
      .replace(/\.jsonl$/, '');
    const blobPath = `${userHash}/${datePart}/${Date.now()}.jsonl`;

    const put = await putBlob(sasBaseUrl, blobPath, body);
    if (!put.ok) {
      result.ok = false;
      result.lastError = `Upload failed (HTTP ${put.status}): ${put.error ?? 'unknown'}`;
      return result;
    }

    result.filesUploaded++;
    result.bytesUploaded += body.length;

    // Mark uploaded by renaming the local file
    const uploadedPath = file.replace(/\.jsonl$/, '.uploaded.jsonl');
    try { await fs.rename(file, uploadedPath); } catch { /* file may already be renamed; ignore */ }
  }

  return result;
}

/** Delete every event file (uploaded and un-uploaded) in the local
 *  telemetry directory. Used by the "Forget me" action. */
export async function purgeLocal(workspacePath: string): Promise<{ deleted: number; errors: number }> {
  const dir = path.join(workspacePath, '.claude', 'telemetry');
  let deleted = 0;
  let errors = 0;
  try {
    const entries = await fs.readdir(dir);
    for (const e of entries) {
      if (e.startsWith('events-') && e.endsWith('.jsonl')) {
        try {
          await fs.unlink(path.join(dir, e));
          deleted++;
        } catch {
          errors++;
        }
      }
    }
  } catch { /* dir missing — nothing to delete */ }
  return { deleted, errors };
}

/** Read telemetry config (enabled, last upload time). Lives in
 *  `<workspace>/.claude/telemetry/config.json`. Created lazily. */
export interface TelemetryConfig {
  enabled: boolean;
  // Distinguishes "user has never touched the toggle" from "user explicitly
  // turned it off". Needed so get-status can auto-enable on first sight of a
  // configured SAS without ever overriding an explicit opt-out. Added in the
  // 2.4.1 pre-ship audit — previously this signal didn't exist, so the only
  // auto-enable path was gated on `readTelemetryDefaults().defaultSasUrl`,
  // which was hardcoded to null (SAS is never baked into pricing.json, by
  // design — see the removed comment below) and therefore could never fire.
  // TelemetrySetup.tsx presents telemetry as mandatory during onboarding,
  // so every install completed a SAS entry, yet upload silently stayed off
  // until a user found and clicked "Enable upload" themselves.
  enabledExplicitlySet: boolean;
  lastUploadAt: string | null;
  lastUploadResult: UploadResult | null;
}

export async function readConfig(workspacePath: string): Promise<TelemetryConfig> {
  const p = path.join(workspacePath, '.claude', 'telemetry', 'config.json');
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const cfg = JSON.parse(raw) as Partial<TelemetryConfig>;
    return {
      enabled: cfg.enabled === true,
      enabledExplicitlySet: cfg.enabledExplicitlySet === true,
      lastUploadAt: cfg.lastUploadAt ?? null,
      lastUploadResult: cfg.lastUploadResult ?? null,
    };
  } catch {
    return { enabled: false, enabledExplicitlySet: false, lastUploadAt: null, lastUploadResult: null };
  }
}

export async function writeConfig(workspacePath: string, cfg: TelemetryConfig): Promise<void> {
  const dir = path.join(workspacePath, '.claude', 'telemetry');
  try { await fs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
  const p = path.join(dir, 'config.json');
  await fs.writeFile(p, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

/** Compute a stable hashed user id — matches the Python hook's algorithm
 *  (titan_config.py:hashed_user). `salt` MUST be `config.telemetry.salt`
 *  from the same titan.config.json the workspace was deployed with, or the
 *  hash will not match what the hooks/scheduled uploader compute for the
 *  same user. Callers with a `workspacePath` in scope should resolve the
 *  config (see `resolveConfig` in main.ts) and pass its salt explicitly;
 *  the DEFAULT_TITAN_CONFIG placeholder salt is only a last-resort fallback
 *  for call sites that run before any workspace/config is known. */
export function computeUserHash(salt: string = DEFAULT_TITAN_CONFIG.telemetry.salt): string {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const user = process.env.USERNAME || process.env.USER || 'anonymous';
  return crypto.createHash('sha256').update(`${salt}:${user}`).digest('hex').slice(0, 16);
}

/** Best-effort helper — sync exists check. */
export function telemetryDirExists(workspacePath: string): boolean {
  return fssync.existsSync(path.join(workspacePath, '.claude', 'telemetry'));
}

// ── Cost rollup — reads _cost_estimate events from local JSONL ─────────────
export interface CostRollup {
  today: {
    estimates: number;
    estMinUsd: number;
    estMaxUsd: number;
    redirects: number;
  };
  thisSession: {
    estimates: number;
    estMinUsd: number;
    estMaxUsd: number;
  };
  last7Days: {
    estimates: number;
    estMinUsd: number;
    estMaxUsd: number;
    redirects: number;
    estimatedSavingsUsd: number;  // sum of (estMid * 0.30) for prompts classified as qa_short / yes_no → could have been Copilot
  };
  byClass: Record<string, { count: number; estMidUsd: number }>;
  byModel: Record<string, { count: number; estMidUsd: number }>;
}

/** Read all telemetry JSONL files and aggregate cost-estimate events into
 *  a Dashboard-friendly summary. Skips malformed lines. Privacy-safe — only
 *  reads metadata fields, never prompt content (which isn't there anyway). */
export async function readCostRollup(workspacePath: string, currentSessionId: string): Promise<CostRollup> {
  const result: CostRollup = {
    today:        { estimates: 0, estMinUsd: 0, estMaxUsd: 0, redirects: 0 },
    thisSession:  { estimates: 0, estMinUsd: 0, estMaxUsd: 0 },
    last7Days:    { estimates: 0, estMinUsd: 0, estMaxUsd: 0, redirects: 0, estimatedSavingsUsd: 0 },
    byClass:      {},
    byModel:      {},
  };

  const dir = path.join(workspacePath, '.claude', 'telemetry');
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir))
      .filter((e) => e.startsWith('events-') && e.endsWith('.jsonl'));
  } catch {
    return result;
  }

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const filename of entries) {
    // Extract date from filename: events-YYYY-MM-DD(.uploaded).jsonl
    const dateMatch = filename.match(/events-(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const fileDate = dateMatch[1];
    if (fileDate < sevenDaysAgo) continue;

    let body: string;
    try { body = await fs.readFile(path.join(dir, filename), 'utf-8'); } catch { continue; }

    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }

      const tool = String(evt.tool ?? '');
      const meta = (evt.meta as Record<string, unknown> | undefined) ?? {};
      const sessId = String(evt.session ?? '');

      if (tool === '_cost_estimate') {
        const cmin = Number(meta.cost_min_usd ?? 0);
        const cmax = Number(meta.cost_max_usd ?? 0);
        const cmid = (cmin + cmax) / 2;
        const cls = String(meta.class ?? 'default');
        const model = String(meta.model ?? 'unknown');

        // last7days bucket
        result.last7Days.estimates++;
        result.last7Days.estMinUsd += cmin;
        result.last7Days.estMaxUsd += cmax;

        // by-class + by-model breakdown
        if (!result.byClass[cls]) result.byClass[cls] = { count: 0, estMidUsd: 0 };
        result.byClass[cls].count++;
        result.byClass[cls].estMidUsd += cmid;

        if (!result.byModel[model]) result.byModel[model] = { count: 0, estMidUsd: 0 };
        result.byModel[model].count++;
        result.byModel[model].estMidUsd += cmid;

        // Savings heuristic: 30% of qa_short / yes_no estimates could have
        // gone to Copilot (free). Use mid-cost.
        if (cls === 'qa_short' || cls === 'yes_no') {
          result.last7Days.estimatedSavingsUsd += cmid * 0.30;
        }

        // today bucket
        if (fileDate === today) {
          result.today.estimates++;
          result.today.estMinUsd += cmin;
          result.today.estMaxUsd += cmax;
        }

        // this-session bucket
        if (sessId && sessId === currentSessionId) {
          result.thisSession.estimates++;
          result.thisSession.estMinUsd += cmin;
          result.thisSession.estMaxUsd += cmax;
        }
      } else if (tool === '_copilot_redirect') {
        result.last7Days.redirects++;
        if (fileDate === today) result.today.redirects++;
      }
    }
  }

  return result;
}
