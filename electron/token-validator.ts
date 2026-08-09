// Token validator — verifies an ADO PAT against the live Azure DevOps API.
// One endpoint is enough: GET /_apis/projects?api-version=7.1 returns 200
// if the PAT is valid AND has at least the Code: Read scope, 401 if the
// PAT is invalid or expired, 403 if the PAT exists but lacks required scopes.
//
// SUPERSEDED by providers/scm/{azure-devops,github}.ts (Titan extraction
// Phase 6, §E): main.ts's token:test-ado handler and doctor.ts's
// checkAdoPat now call getScmProvider(config).validatePat(pat), which is
// config-driven (works for github.kind too) instead of this hardcoded ADO
// org. No remaining caller imports this module — kept only so a future
// direct ADO-only integration has a ready reference implementation to
// crib from; do not wire new code to it.
import https from 'node:https';

const ADO_ORG = 'UNCONFIGURED-ADO-ORG'; // dead code path — see note above

export interface AdoTestResult {
  ok: boolean;
  status: number;
  message: string;
  /** ISO 8601 timestamp of the test. Useful for the "last tested" UI hint. */
  testedAt: string;
}

/** Format the Basic-auth header value for an ADO PAT.
 *  ADO accepts an empty username + the PAT as the password. */
function authHeader(pat: string): string {
  const token = Buffer.from(`:${pat}`).toString('base64');
  return `Basic ${token}`;
}

/** Friendly status -> user-facing message mapping.
 *  Specific enough to be actionable, vague enough to not leak token state. */
function statusMessage(status: number): string {
  switch (status) {
    case 200: return 'Connection OK';
    case 203:
      // ADO returns 203 when the PAT is for an account that hasn't accepted
      // the MS sign-in agreement — looks like 200 to a careless parser.
      return 'Authentication redirected — please verify the PAT was created under the correct account';
    case 401: return '401 Unauthorized — check that your PAT is valid and not expired';
    case 403: return '403 Forbidden — PAT missing the required scope (Code: Read minimum)';
    case 404: return `404 — organisation "${ADO_ORG}" not found, or PAT scoped to a different org`;
    default:  return `Unexpected status ${status} — try regenerating the PAT`;
  }
}

/** Test the PAT. Returns within ~3 seconds (the request has a 5 s timeout). */
export function testAdoPat(pat: string): Promise<AdoTestResult> {
  return new Promise<AdoTestResult>((resolve) => {
    if (!pat || pat.length < 20) {
      return resolve({
        ok: false,
        status: 0,
        message: 'PAT looks too short — paste the full token (~52+ characters)',
        testedAt: new Date().toISOString()
      });
    }

    const req = https.request(
      {
        method:   'GET',
        hostname: 'dev.azure.com',
        path:     `/${ADO_ORG}/_apis/projects?api-version=7.1&$top=1`,
        headers: {
          'Authorization': authHeader(pat),
          'Accept':        'application/json',
          'User-Agent':    'Titan-Installer/0.1.0'
        },
        timeout: 5000
      },
      (res) => {
        // We only need the status — drain the body to free the socket
        // and avoid leaking memory on long-lived sessions.
        res.resume();
        const status = res.statusCode ?? 0;
        resolve({
          ok: status === 200,
          status,
          message: statusMessage(status),
          testedAt: new Date().toISOString()
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        status: 0,
        message: 'Request timed out — check your network or VPN connection',
        testedAt: new Date().toISOString()
      });
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        status: 0,
        message: `Network error: ${err.message}`,
        testedAt: new Date().toISOString()
      });
    });

    req.end();
  });
}
