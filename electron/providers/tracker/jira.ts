// Jira/Atlassian issue-tracker provider — port of the REST identity check
// that used to hardcode one specific Atlassian site in main.ts.
//
// Auth scheme matches Atlassian's actual documented REST auth for Jira
// Cloud: HTTP Basic with `email:api_token` base64-encoded (NOT a bearer
// token — Atlassian API tokens are paired with the account email).

import * as https from 'node:https';
import type { TitanIssueTrackerConfig } from '../../titan-config';

export interface TrackerTestResult {
  ok: boolean;
  status: number;
  message: string;
}

export interface IssueTrackerProvider {
  readonly kind: 'jira' | 'none';
  siteUrl(): string | null;
  validateToken(email: string, token: string): Promise<TrackerTestResult>;
}

export class JiraProvider implements IssueTrackerProvider {
  readonly kind = 'jira' as const;
  private readonly site: string;

  constructor(cfg: TitanIssueTrackerConfig) {
    // `site` is expected as a bare hostname, e.g. "myorg.atlassian.net" —
    // matches how it's documented in titan.config.schema.json.
    this.site = cfg.site ?? 'UNCONFIGURED-ATLASSIAN-SITE.atlassian.net';
  }

  siteUrl(): string {
    return `https://${this.site}`;
  }

  async validateToken(email: string, token: string): Promise<TrackerTestResult> {
    const credentials = Buffer.from(`${email}:${token}`).toString('base64');
    return new Promise((resolve) => {
      const req = https.request({
        hostname: this.site,
        path: '/rest/api/3/myself',
        method: 'GET',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Accept': 'application/json',
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status === 200) {
            try {
              const data = JSON.parse(body) as { displayName?: string };
              resolve({ ok: true, status, message: `✓ Connected as ${data.displayName ?? email}` });
            } catch { resolve({ ok: true, status, message: '✓ Connected' }); }
          } else if (status === 401) {
            resolve({ ok: false, status, message: '401 Unauthorized — check your email and API token' });
          } else if (status === 403) {
            resolve({ ok: false, status, message: '403 Forbidden — token valid but lacks required scopes' });
          } else {
            resolve({ ok: false, status, message: `HTTP ${status} — check the Atlassian status page` });
          }
        });
      });
      req.on('error', (err: Error) => resolve({ ok: false, status: 0, message: err.message }));
      req.end();
    });
  }
}

/** No-op tracker for `issue_tracker.kind === 'none'` — screens that depend
 *  on a tracker (AtlassianSetup) should check `kind` and self-suppress
 *  rather than call into this, but a safe stub keeps call-sites simple. */
export class NoneTrackerProvider implements IssueTrackerProvider {
  readonly kind = 'none' as const;
  siteUrl(): string | null { return null; }
  async validateToken(): Promise<TrackerTestResult> {
    return { ok: false, status: 0, message: 'No issue tracker configured (platforms.issue_tracker.kind = "none").' };
  }
}

export function getIssueTrackerProvider(cfg: TitanIssueTrackerConfig): IssueTrackerProvider {
  if (cfg.kind === 'jira') return new JiraProvider(cfg);
  return new NoneTrackerProvider();
}
