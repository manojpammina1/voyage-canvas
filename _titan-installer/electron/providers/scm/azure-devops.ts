// Azure DevOps SCM provider — port of the ADO REST calls that used to be
// inlined in electron/main.ts with one specific reference adopter's ADO org
// hardcoded in.
//
// Org/collection now comes from `config.platforms.scm.collection` (falls
// back to `base_url`'s last path segment, then a placeholder) instead of a
// literal string, so this same code works for any ADO organisation.

import * as https from 'node:https';
import type { ScmProvider, ScmBranchResult, ScmPatTestResult, ScmProjectsProbeResult } from './types';
import type { TitanScmConfig, TitanRepoConfig } from '../../titan-config';

const MAX_BRANCHES_RETURNED = 100;

function resolveOrg(scm: TitanScmConfig): string {
  if (scm.collection) return scm.collection;
  if (scm.base_url) {
    const seg = scm.base_url.replace(/\/+$/, '').split('/').pop();
    if (seg) return seg;
  }
  return 'UNCONFIGURED-ADO-ORG';
}

export class AzureDevOpsProvider implements ScmProvider {
  readonly kind = 'azure-devops' as const;
  private readonly org: string;
  private readonly repos: TitanRepoConfig[];

  constructor(scm: TitanScmConfig, repos: TitanRepoConfig[] = []) {
    this.org = resolveOrg(scm);
    this.repos = repos;
  }

  patCreateUrl(): string {
    return `${this.baseUrl()}/_usersSettings/tokens`;
  }

  baseUrl(): string {
    return `https://dev.azure.com/${encodeURIComponent(this.org)}`;
  }

  async validatePat(pat: string): Promise<ScmPatTestResult> {
    const auth = Buffer.from(`:${pat}`).toString('base64');
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'dev.azure.com',
        path: `/${encodeURIComponent(this.org)}/_apis/projects?api-version=7.1`,
        method: 'GET',
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c.toString(); });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status === 200) resolve({ ok: true, status, message: '✓ Connection OK' });
          else if (status === 401 || status === 403) resolve({ ok: false, status, message: `${status} — token invalid or lacks scope` });
          else resolve({ ok: false, status, message: `HTTP ${status} — ${body.slice(0, 200)}` });
        });
      });
      req.on('error', (err: Error) => resolve({ ok: false, status: 0, message: err.message }));
      req.end();
    });
  }

  async listRepoBranches(repoName: string, pat: string): Promise<ScmBranchResult> {
    const encodedRepo = encodeURIComponent(repoName);
    const auth = Buffer.from(`:${pat}`).toString('base64');
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'dev.azure.com',
        path: `/${encodeURIComponent(this.org)}/_apis/git/repositories/${encodedRepo}/refs?filter=heads/&api-version=7.1`,
        method: 'GET',
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c.toString(); });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            resolve({ ok: false, branches: [], message: `HTTP ${status} — could not list branches` });
            return;
          }
          try {
            const data = JSON.parse(body) as { value: Array<{ name: string }> };
            const all = (data.value ?? []).map((r) => r.name.replace(/^refs\/heads\//, ''));
            const releaseBranches = all.filter((n) => n.startsWith('release/')).sort().reverse();
            const otherBranches = all.filter((n) => !n.startsWith('release/')).sort();
            const branches = [...releaseBranches, ...otherBranches].slice(0, MAX_BRANCHES_RETURNED);
            resolve({ ok: true, branches, message: `Found ${all.length} branch(es)${all.length > MAX_BRANCHES_RETURNED ? ` (showing first ${MAX_BRANCHES_RETURNED})` : ''}` });
          } catch (err) {
            resolve({ ok: false, branches: [], message: (err as Error).message });
          }
        });
      });
      req.on('error', (err: Error) => resolve({ ok: false, branches: [], message: err.message }));
      req.end();
    });
  }

  cloneUrl(repoName: string): string {
    const entry = this.repos.find((r) => r.id === repoName || r.display === repoName);
    const project = entry?.id ?? repoName;
    const slug = entry?.dir ?? repoName;
    return `https://dev.azure.com/${encodeURIComponent(this.org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(slug)}`;
  }

  async probeConnectivity(pat: string): Promise<ScmProjectsProbeResult> {
    const auth = Buffer.from(`:${pat}`).toString('base64');
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'dev.azure.com',
        path: `/${encodeURIComponent(this.org)}/_apis/projects?api-version=7.1`,
        method: 'GET',
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      }, (res) => {
        const status = res.statusCode ?? 0;
        res.on('data', () => { /* drain */ });
        res.on('end', () => {
          if (status === 200) resolve({ ok: true, detail: '' });
          else if (status === 401 || status === 403) resolve({ ok: false, detail: `${status} — token invalid or expired` });
          else resolve({ ok: false, detail: `HTTP ${status}` });
        });
      });
      req.on('error', (err: Error) => resolve({ ok: false, detail: err.message }));
      req.end();
    });
  }
}
