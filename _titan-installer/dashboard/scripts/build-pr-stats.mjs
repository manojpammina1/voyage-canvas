#!/usr/bin/env node
// Build the merged-PR stats overlay for the dashboard's ROI section (cost-per-PR).
//
// Queries the Azure DevOps REST API for COMPLETED pull requests per configured repo and
// writes aggregate counts only (no titles, no authors, no branches) — consistent
// with the metadata-only telemetry contract. Output is gitignored and lives only
// on the dashboard host; if the file is absent the dashboard shows
// "baseline pending" instead of a number (it never invents one).
//
// Cost-per-PR = cohort exact spend (_actual_usage) / merged PR count. This is an
// INTERNAL TREND metric — no published industry benchmark exists (dashboard
// labels it accordingly).
//
// Usage:
//   ADO_ORG_URL=https://dev.azure.com/<org> ADO_PROJECT=<project> ADO_PAT=<pat> \
//     node scripts/build-pr-stats.mjs > public/pr-stats.json
//
// Env:
//   ADO_ORG_URL  e.g. https://dev.azure.com/<your-ado-org>
//   ADO_PROJECT  ADO project containing the configured repos
//   ADO_PAT      Personal Access Token, Code (Read) scope ONLY. Use a FRESH PAT —
//                never the previously-exposed one (rotation tracked in
//                SLING-PHASE2 milestone 10). Never commit or echo it.
//   ADO_REPOS    optional comma-separated override of repo names

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

if (!ORG_URL || !PROJECT || !PAT) {
  console.error('ERROR: ADO_ORG_URL, ADO_PROJECT and ADO_PAT env vars are required.');
  console.error('       Use a fresh PAT with Code (Read) scope only. Never commit it.');
  process.exit(1);
}

// 365 added in the 2.4.1 pre-ship audit: the dashboard's "All time" view
// (period.daysBack === 365) used to look up periods['365'], find nothing
// (only 7/30 were built), and fall back to periods['30']'s PR count as the
// denominator for all-time spend — inflating cost-per-PR by roughly the
// ratio of all-time days to 30. Building the real 365d count here is the
// correct fix; aggregations.ts also no longer falls back cross-period as a
// defense-in-depth measure (an overlay built by an OLDER version of this
// script, without 365d, now shows "baseline pending" instead of a wrong number).
const PERIOD_DAYS = [7, 30, 365];
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

async function completedPrCount(repo, sinceIso) {
  // Paged: ADO caps $top at 1000; loop with $skip until short page.
  let count = 0, skip = 0;
  for (;;) {
    const url =
      `${ORG_URL}/${encodeURIComponent(PROJECT)}/_apis/git/repositories/` +
      `${encodeURIComponent(repo)}/pullrequests` +
      `?searchCriteria.status=completed&searchCriteria.minTime=${sinceIso}` +
      `&searchCriteria.queryTimeRangeType=closed&$top=500&$skip=${skip}&api-version=7.1`;
    const page = await get(url);
    const n = (page.value || []).length;
    count += n;
    if (n < 500) break;
    skip += 500;
  }
  return count;
}

const out = { generated: new Date().toISOString(), source: 'ADO REST (completed PRs)', periods: {} };

for (const days of PERIOD_DAYS) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const byRepo = {};
  let total = 0;
  for (const repo of REPOS) {
    try {
      const n = await completedPrCount(repo, since);
      byRepo[repo] = n;
      total += n;
    } catch (e) {
      console.error(`WARN: ${repo}: ${e.message} — repo skipped for ${days}d period`);
      byRepo[repo] = null; // skipped, not zero — dashboard treats null as unknown
    }
  }
  out.periods[String(days)] = { prCount: total, byRepo };
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
console.error(
  `PR stats built for ${REPOS.length} repo(s), periods: ${PERIOD_DAYS.join('/')}d. ` +
  'Save to dashboard/public/pr-stats.json (gitignored, dashboard-only).'
);
