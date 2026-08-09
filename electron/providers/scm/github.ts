// GitHub SCM provider — same interface as azure-devops.ts, backed by the
// GitHub REST v3 API. Selected when `config.platforms.scm.kind === 'github'`.
//
// Auth: PAT sent as `Authorization: Bearer <pat>` (GitHub's documented
// scheme for both classic and fine-grained PATs). Org/owner comes from
// `config.platforms.scm.collection` (reused as "owner/org" for GitHub,
// same schema field as ADO's collection — avoids a schema fork for one
// string).

import * as https from 'node:https';
import type { ScmProvider, ScmBranchResult, ScmPatTestResult, ScmProjectsProbeResult } from './types';
import type { TitanScmConfig, TitanRepoConfig } from '../../titan-config';

const MAX_BRANCHES_RETURNED = 100;
const API_HOST = 'api.github.com';

function ghRequest(
  path: string,
  pat: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'titan-installer',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

export class GitHubProvider implements ScmProvider {
  readonly kind = 'github' as const;
  private readonly owner: string;
  private readonly repos: TitanRepoConfig[];

  constructor(scm: TitanScmConfig, repos: TitanRepoConfig[] = []) {
    this.owner = scm.collection ?? 'UNCONFIGURED-GITHUB-ORG';
    this.repos = repos;
  }

  patCreateUrl(): string {
    return 'https://github.com/settings/tokens';
  }

  baseUrl(): string {
    return `https://github.com/${encodeURIComponent(this.owner)}`;
  }

  async validatePat(pat: string): Promise<ScmPatTestResult> {
    try {
      const { status, body } = await ghRequest('/user', pat);
      if (status === 200) {
        try {
          const data = JSON.parse(body) as { login?: string };
          return { ok: true, status, message: `✓ Connected as ${data.login ?? 'GitHub user'}` };
        } catch { return { ok: true, status, message: '✓ Connected' }; }
      }
      if (status === 401) return { ok: false, status, message: '401 Unauthorized — check the token' };
      if (status === 403) return { ok: false, status, message: '403 Forbidden — token valid but lacks required scopes' };
      return { ok: false, status, message: `HTTP ${status} — ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, status: 0, message: (err as Error).message };
    }
  }

  async listRepoBranches(repoName: string, pat: string): Promise<ScmBranchResult> {
    const entry = this.repos.find((r) => r.id === repoName || r.display === repoName);
    const repoSlug = entry?.dir ?? repoName;
    try {
      const { status, body } = await ghRequest(
        `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(repoSlug)}/branches?per_page=100`,
        pat,
      );
      if (status !== 200) return { ok: false, branches: [], message: `HTTP ${status} — could not list branches` };
      const data = JSON.parse(body) as Array<{ name: string }>;
      const all = data.map((b) => b.name);
      const releaseBranches = all.filter((n) => n.startsWith('release/')).sort().reverse();
      const otherBranches = all.filter((n) => !n.startsWith('release/')).sort();
      const branches = [...releaseBranches, ...otherBranches].slice(0, MAX_BRANCHES_RETURNED);
      return { ok: true, branches, message: `Found ${all.length} branch(es)` };
    } catch (err) {
      return { ok: false, branches: [], message: (err as Error).message };
    }
  }

  cloneUrl(repoName: string): string {
    const entry = this.repos.find((r) => r.id === repoName || r.display === repoName);
    const slug = entry?.dir ?? repoName;
    return `https://github.com/${encodeURIComponent(this.owner)}/${encodeURIComponent(slug)}.git`;
  }

  async probeConnectivity(pat: string): Promise<ScmProjectsProbeResult> {
    try {
      const { status } = await ghRequest(`/orgs/${encodeURIComponent(this.owner)}/repos?per_page=1`, pat);
      if (status === 200) return { ok: true, detail: '' };
      if (status === 401 || status === 403) return { ok: false, detail: `${status} — token invalid or expired` };
      return { ok: false, detail: `HTTP ${status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
