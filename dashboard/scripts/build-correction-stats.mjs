#!/usr/bin/env node
// Build the downstream "correction record" overlay for the dashboard's Correction
// section (Layer B — hallucinations that slipped through to a commit/PR).
//
// Queries the Azure DevOps REST API for AUDITABLE rework records per configured repo and
// writes aggregate COUNTS only (no titles, authors, branches, or comment text) —
// consistent with the metadata-only telemetry contract. Output is gitignored and
// lives only on the dashboard host; if the file is absent OR the PAT is invalid,
// every value is null and the dashboard shows "ADO pending — PAT" (it never
// invents a number).
//
// Records captured (all facts, verifiable in ADO):
//   prCount              completed PRs in the window
//   reworkIterations     Σ (iterations − 1) over those PRs — extra pushes after
//                        the first review round = objective rework
//   changesRequested     Σ reviewers whose final vote ≤ −5 (waiting/rejected)
//   ciFails              failed pipeline builds in the window (project-level)
//
// NOTE: git-local reverts are computed separately by the dashboard against the
// working copies; this script is the ADO half and is GATED on PAT rotation
// (SLING-PHASE2). Until a fresh PAT exists it errors → null overlay by design.
//
// Usage:
//   ADO_ORG_URL=https://dev.azure.com/<org> ADO_PROJECT=<project> ADO_PAT=<pat> \
//     node scripts/build-correction-stats.mjs > public/correction-stats.json
//
// Env: ADO_ORG_URL, ADO_PROJECT, ADO_PAT (Code Read + Build Read), ADO_REPOS opt.

import https from 'node:https';

const ORG_URL = process.env.ADO_ORG_URL;
const PROJECT = process.env.ADO_PROJECT;
const PAT = process.env.ADO_PAT;

const REPOS = (process.env.ADO_REPOS
  ? process.env.ADO_REPOS.split(',').map((s) => s.trim())
  : [
      'example-storefront-ui',
      'example-webapp',
      'example-migration',
      'example-integration-layer',
    ]);

// 365 added in the 2.4.1 pre-ship audit — same fix as build-pr-stats.mjs.
// See that file's comment for the full rationale (all-time cost-per-PR was
// inflated ~12x by silently reusing the 30-day PR count as the denominator).
const PERIOD_DAYS = [7, 30, 365];
const MAX_PRS_FOR_ITERATIONS = 200; // bound the per-PR iteration fetch (N+1 guard)

function emptyOverlay(reason) {
  // Null overlay — every field unknown. Dashboard renders "ADO pending".
  const periods = {};
  for (const d of PERIOD_DAYS) {
    periods[String(d)] = {
      prCount: null, reworkIterations: null, changesRequested: null,
      ciFails: null, byRepo: {},
    };
  }
  return { generated: new Date().toISOString(), source: 'ADO REST (correction records)', reason, periods };
}

if (!ORG_URL || !PROJECT || !PAT) {
  // Missing config is NOT a hard error here (unlike build-pr-stats) — we still
  // emit a valid null overlay so the dashboard has a well-formed file to read.
  console.error('WARN: ADO_ORG_URL/ADO_PROJECT/ADO_PAT not set — emitting null overlay (ADO pending).');
  process.stdout.write(JSON.stringify(emptyOverlay('missing-credentials'), null, 2) + '\n');
  process.exit(0);
}

const auth = 'Basic ' + Buffer.from(':' + PAT).toString('base64');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Authorization: auth, Accept: 'application/json' } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`ADO ${res.statusCode} for ${url.replace(/\?.*$/, '')}`));
            return;
          }
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

async function completedPrs(repo, sinceIso) {
  // Return the completed-PR objects in the window (reviewers included), paged.
  const prs = [];
  let skip = 0;
  for (;;) {
    const url =
      `${ORG_URL}/${encodeURIComponent(PROJECT)}/_apis/git/repositories/` +
      `${encodeURIComponent(repo)}/pullrequests` +
      `?searchCriteria.status=completed&searchCriteria.minTime=${sinceIso}` +
      `&searchCriteria.queryTimeRangeType=closed&$top=500&$skip=${skip}&api-version=7.1`;
    const page = await get(url);
    const batch = page.value || [];
    prs.push(...batch);
    if (batch.length < 500) break;
    skip += 500;
  }
  return prs;
}

async function iterationCount(repo, prId) {
  const url =
    `${ORG_URL}/${encodeURIComponent(PROJECT)}/_apis/git/repositories/` +
    `${encodeURIComponent(repo)}/pullRequests/${prId}/iterations?api-version=7.1`;
  const page = await get(url);
  return (page.value || []).length;
}

async function failedBuilds(sinceIso) {
  // Project-level failed builds in the window — objective CI-failure count.
  const url =
    `${ORG_URL}/${encodeURIComponent(PROJECT)}/_apis/build/builds` +
    `?statusFilter=completed&resultFilter=failed&minTime=${sinceIso}&$top=1000&api-version=7.1`;
  const page = await get(url);
  return (page.value || []).length;
}

async function repoRecords(repo, sinceIso) {
  const prs = await completedPrs(repo, sinceIso);
  let reworkIterations = 0;
  let changesRequested = 0;

  for (const pr of prs) {
    // Changes-requested: any reviewer whose final vote is "waiting" (−5) or
    // "rejected" (−10). Best-effort — a vote reset to approve before merge is not
    // recoverable from the PR object; this therefore UNDERCOUNTS, never over.
    for (const rv of pr.reviewers || []) {
      if (typeof rv.vote === 'number' && rv.vote <= -5) changesRequested += 1;
    }
  }

  // reworkIterations is an N+1 call per PR — bound it to stay cheap.
  const forIterations = prs.slice(0, MAX_PRS_FOR_ITERATIONS);
  for (const pr of forIterations) {
    try {
      const n = await iterationCount(repo, pr.pullRequestId);
      if (n > 1) reworkIterations += n - 1; // first iteration is the initial push
    } catch {
      // one PR's iterations failing does not fail the repo
    }
  }
  const iterationsCapped = prs.length > MAX_PRS_FOR_ITERATIONS;

  return {
    prCount: prs.length,
    reworkIterations: iterationsCapped ? null : reworkIterations, // null = not fully counted
    changesRequested,
  };
}

const out = { generated: new Date().toISOString(), source: 'ADO REST (correction records)', periods: {} };

for (const days of PERIOD_DAYS) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const byRepo = {};
  let prCount = 0, reworkIterations = 0, changesRequested = 0;
  let reworkKnown = true;

  for (const repo of REPOS) {
    try {
      const r = await repoRecords(repo, since);
      byRepo[repo] = r;
      prCount += r.prCount;
      changesRequested += r.changesRequested;
      if (r.reworkIterations == null) reworkKnown = false;
      else reworkIterations += r.reworkIterations;
    } catch (e) {
      console.error(`WARN: ${repo}: ${e.message} — repo skipped for ${days}d period`);
      byRepo[repo] = null; // skipped, not zero — dashboard treats null as unknown
      reworkKnown = false;
    }
  }

  let ciFails = null;
  try {
    ciFails = await failedBuilds(since);
  } catch (e) {
    console.error(`WARN: failed-build query: ${e.message} — ciFails unknown for ${days}d`);
  }

  out.periods[String(days)] = {
    prCount,
    reworkIterations: reworkKnown ? reworkIterations : null,
    changesRequested,
    ciFails,
    byRepo,
  };
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
console.error(
  `Correction records built for ${REPOS.length} repo(s), periods: ${PERIOD_DAYS.join('/')}d. ` +
  'Save to dashboard/public/correction-stats.json (gitignored, dashboard-only).'
);
