// Post-install "doctor" — runs an end-to-end environment self-check so problems
// surface right after install (with a fix), instead of a developer discovering
// them mid-session. Metadata only: reads credentials from settings.local.json
// to TEST them, never logs or returns the secret values.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadTitanConfig } from './titan-config';
import { getScmProvider } from './providers/scm';
import { getIssueTrackerProvider } from './providers/tracker/jira';

const MIN_NODE_MAJOR = 18;

export interface DoctorCheck {
  id:     string;
  label:  string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  fix?:   string;   // one-line remediation shown in the UI
}
export interface DoctorReport {
  checks: DoctorCheck[];
  ranAt:  string;
  ok:     boolean;  // true if no 'fail' checks
}

/** Run `<cmd> <args>` and resolve its first output line + exit code.
 *  shell:true is REQUIRED on Windows: npm/npx (and most global CLIs) are
 *  `.cmd` batch shims there, and Node's spawn with shell:false throws ENOENT
 *  on `.cmd` files — it only resolves real executables (node.exe worked, which
 *  is why checkNode passed while checkNpx/checkMcpRegistry falsely reported
 *  "not found"/"unreachable" on every Windows machine). Safe here because
 *  every caller passes hardcoded constant args (--version, view <pinned-pkg>);
 *  no user/env input reaches this spawn, so there is no shell-injection surface. */
function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,   // MCP registration is project-scoped — cwd must be the workspace
    });
    let out = '';
    let done = false;
    const finish = (code: number | null) => { if (!done) { done = true; resolve({ code, out: out.trim() }); } };
    const timer = opts.timeoutMs
      ? setTimeout(() => { try { c.kill(); } catch { /* already gone */ } finish(null); }, opts.timeoutMs)
      : null;
    c.stdout?.on('data', (b: Buffer) => { out += b.toString('utf-8'); });
    c.stderr?.on('data', (b: Buffer) => { out += b.toString('utf-8'); });
    c.on('error', () => { if (timer) clearTimeout(timer); finish(null); });
    c.on('close', (code) => { if (timer) clearTimeout(timer); finish(code); });
  });
}

async function checkNode(): Promise<DoctorCheck> {
  const { code, out } = await runCmd('node', ['--version']);
  const m = out.match(/v?(\d+)\./);
  const major = m ? parseInt(m[1], 10) : 0;
  if (code !== 0 || !major) {
    return { id: 'node', label: 'Node.js ≥ 18', status: 'fail', detail: 'Node not found on PATH',
      fix: 'Install Node 20 LTS (per-user via fnm if no admin), then restart.' };
  }
  if (major < MIN_NODE_MAJOR) {
    return { id: 'node', label: 'Node.js ≥ 18', status: 'fail', detail: `Node ${major} is too old — MCP servers and builds need ≥ ${MIN_NODE_MAJOR}`,
      fix: 'Switch the default to Node 20 (nvm/fnm use 20), then restart.' };
  }
  return { id: 'node', label: 'Node.js ≥ 18', status: 'pass', detail: out };
}

async function checkNpx(): Promise<DoctorCheck> {
  const { code, out } = await runCmd('npx', ['--version']);
  if (code !== 0) {
    return { id: 'npx', label: 'npx available', status: 'fail', detail: 'npx not found',
      fix: 'Reinstall Node (npx ships with it). MCP servers launch via npx.' };
  }
  return { id: 'npx', label: 'npx available', status: 'pass', detail: `npx ${out}` };
}

// The exact package+version pinned in harness/.mcp.json — keep in sync.
const ADO_MCP_PKG = 'azure-devops-mcp@1.1.2';

/** The ADO MCP server is fetched by npx from the npm registry on first use.
 *  Machines behind a corporate proxy (or with a scoped/misconfigured registry)
 *  pass every credential check yet still can't START the MCP server — the
 *  failure users reported on freshly-installed systems. `npm view` proves the
 *  registry can resolve the exact pinned package from THIS machine without
 *  actually executing it. */
async function checkMcpRegistry(): Promise<DoctorCheck> {
  const { code, out } = await runCmd('npm', ['view', ADO_MCP_PKG, 'version']);
  if (code === 0 && out) {
    return { id: 'mcp-registry', label: 'ADO MCP package resolvable', status: 'pass',
      detail: `${ADO_MCP_PKG} resolves from the npm registry` };
  }
  return { id: 'mcp-registry', label: 'ADO MCP package resolvable', status: 'fail',
    detail: `npm cannot resolve ${ADO_MCP_PKG} — registry unreachable or blocked (proxy?)`,
    fix: 'Check corporate proxy / npm registry config (npm config get registry). Until this resolves, the azure-devops MCP server cannot start in Claude Code even with a valid PAT.' };
}

async function readEnv(workspacePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, '.claude', 'settings.local.json'), 'utf-8');
    const cfg = JSON.parse(raw) as { env?: Record<string, string> };
    return cfg.env ?? {};
  } catch { return {}; }
}

// NOTE: this validates the PAT against the ADO REST API — it does NOT prove the
// azure-devops MCP server loaded in Claude Code (a separate code path). The two
// were previously conflated under one "Azure DevOps connection ✓" badge, which
// hid a total MCP failure (RCA 2026-07-06). checkAdoMcp below covers the MCP side.
async function checkAdoPat(env: Record<string, string>, workspacePath: string): Promise<DoctorCheck> {
  const pat = env.AZURE_DEVOPS_PAT ?? '';
  if (!pat) {
    return { id: 'ado-pat', label: 'SCM PAT valid (REST)', status: 'fail', detail: 'No AZURE_DEVOPS_PAT in settings.local.json',
      fix: 'Add a valid PAT on the PAT screen (Code:Read, Work Items:Read, PR Threads:R/W).' };
  }
  const config = await loadTitanConfig(workspacePath);
  const scm = getScmProvider(config);
  const r = await scm.validatePat(pat);
  if (r.ok) return { id: 'ado-pat', label: 'SCM PAT valid (REST)', status: 'pass', detail: 'PAT authenticates as a valid identity (REST — not proof the MCP server loaded)' };
  return { id: 'ado-pat', label: 'SCM PAT valid (REST)', status: 'fail', detail: r.message,
    fix: 'Regenerate the PAT (likely expired/invalid) and re-save it. Do NOT embed it in any git URL.' };
}

/** The check that actually proves ADO works IN Claude Code: run `claude mcp list`
 *  in the workspace and confirm the azure-devops server registered. If .mcp.json
 *  is malformed (e.g. an invalid entry type), Claude Code discards the whole file
 *  and the server is simply ABSENT here — the exact failure the PAT check can't
 *  see. Cold-start: first run may show the server present-but-not-connected while
 *  npx fetches the package; presence is what matters (it proves the file parsed). */
async function checkAdoMcp(workspacePath: string): Promise<DoctorCheck> {
  const { code, out } = await runCmd('claude', ['mcp', 'list'], { cwd: workspacePath, timeoutMs: 30000 });
  if (code === null && !out) {
    return { id: 'ado-mcp', label: 'ADO MCP server registered', status: 'warn',
      detail: 'Could not run `claude mcp list` (Claude Code CLI not found on PATH, or timed out)',
      fix: 'Ensure the Claude Code CLI is installed and on PATH, then re-run the doctor.' };
  }
  const listed = /azure-devops/i.test(out);
  if (!listed) {
    return { id: 'ado-mcp', label: 'ADO MCP server registered', status: 'fail',
      detail: 'azure-devops is ABSENT from `claude mcp list` — .mcp.json was likely rejected (an invalid entry discards the whole file), so no MCP server loaded',
      fix: 'Check .mcp.json: every entry under mcpServers must be type stdio|http|sse. Remove any documentation/builtin stubs. Then restart Claude Code.' };
  }
  const connected = /connected|✓/i.test(out);
  if (connected) {
    return { id: 'ado-mcp', label: 'ADO MCP server registered', status: 'pass', detail: 'azure-devops registered and connected in Claude Code' };
  }
  return { id: 'ado-mcp', label: 'ADO MCP server registered', status: 'warn',
    detail: 'azure-devops is registered but not yet connected — usually npx cold-start on first package fetch',
    fix: 'Re-run once (npx caches the package after first fetch). If it persists, see the ADO PAT and MCP-package-resolvable checks.' };
}

/** Validate Jira creds against the configured issue tracker (providers/tracker/jira.ts,
 *  selected by config.platforms.issue_tracker.kind). 200 = valid identity; 401 = bad email/token. */
async function checkJira(env: Record<string, string>, workspacePath: string): Promise<DoctorCheck> {
  const config = await loadTitanConfig(workspacePath);
  if (config.platforms.issue_tracker.kind === 'none') {
    return { id: 'jira', label: 'Issue tracker connection', status: 'warn', detail: 'No issue tracker configured (platforms.issue_tracker.kind = "none")' };
  }
  const email = env.JIRA_EMAIL ?? '';
  const token = env.JIRA_API_TOKEN ?? '';
  if (!email || !token) {
    return { id: 'jira', label: 'Atlassian Jira connection', status: 'warn', detail: 'No Jira email/token in settings.local.json',
      fix: 'Optional: Jira MCP access goes through the built-in Atlassian Rovo connector (OAuth on first use). The email/token here are only for REST-based scripts and this identity check.' };
  }
  const tracker = getIssueTrackerProvider(config.platforms.issue_tracker);
  const result = await tracker.validateToken(email, token);
  if (result.ok) return { id: 'jira', label: 'Atlassian Jira connection', status: 'pass', detail: 'Authenticated to Jira' };
  if (result.status === 401 || result.status === 403) {
    return { id: 'jira', label: 'Atlassian Jira connection', status: 'fail', detail: `${result.status} — Jira email/token invalid or expired`,
      fix: 'Regenerate the Atlassian API token and re-save it with your configured Jira email.' };
  }
  return { id: 'jira', label: 'Atlassian Jira connection', status: 'fail', detail: result.status ? `Unexpected status ${result.status}` : 'Network error / VPN?',
    fix: 'Check network/VPN, then re-test.' };
}

/** Scan each cloned repo's .git/config for a credential embedded in a remote
 *  URL (https://…@host). Flags the repo path only — never the secret. */
async function checkEmbeddedCreds(workspacePath: string): Promise<DoctorCheck> {
  const affected: string[] = [];
  let scanned = 0;
  try {
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const cfgPath = path.join(workspacePath, e.name, '.git', 'config');
      try {
        const cfg = await fs.readFile(cfgPath, 'utf-8');
        scanned++;
        // url = https://<anything>@host  → credential embedded in the remote
        if (/^\s*url\s*=\s*https:\/\/[^@\s/]+@/im.test(cfg)) affected.push(e.name);
      } catch { /* no .git/config — skip */ }
    }
  } catch { /* workspace unreadable */ }

  if (affected.length > 0) {
    return { id: 'git-creds', label: 'No embedded git credentials', status: 'fail',
      detail: `Credential embedded in remote URL of: ${affected.join(', ')}`,
      fix: 'Rotate the exposed PAT, then run: git -C <repo> remote set-url origin <clean-url>. Re-running the installer also scrubs it.' };
  }
  return { id: 'git-creds', label: 'No embedded git credentials', status: 'pass',
    detail: scanned ? `${scanned} repo(s) clean` : 'No cloned repos found to scan' };
}

/** QA-only: confirm Playwright's browser binaries actually landed (the
 *  post-clone `npx playwright install` step in setup:run-native can fail
 *  silently past a warn — this is the independent proof at Done-screen time).
 *  Runs `npx playwright --version` from inside the cloned repo so it picks up
 *  THAT repo's pinned Playwright version, not a stray global install. */
async function checkPlaywrightBrowsers(workspacePath: string): Promise<DoctorCheck> {
  const repoPath = path.join(workspacePath, 'Playwright');
  const { code, out } = await runCmd('npx', ['playwright', '--version'], { cwd: repoPath, timeoutMs: 15000 });
  if (code !== 0) {
    return { id: 'playwright', label: 'Playwright installed', status: 'fail',
      detail: 'npx playwright --version failed in the Playwright repo',
      fix: 'Run `npx playwright install` from the Playwright repo folder, then re-run the doctor.' };
  }
  return { id: 'playwright', label: 'Playwright installed', status: 'pass', detail: out };
}

/** QA-only: confirm the qa-mode skill actually deployed into the Playwright
 *  repo (Phase 3b is skip-if-exists — this catches a harness deploy that was
 *  silently skipped or pointed at the wrong repo). */
async function checkQaModePresent(workspacePath: string): Promise<DoctorCheck> {
  const skillPath = path.join(workspacePath, 'Playwright', '.claude', 'commands', 'roles', 'qa-mode.md');
  const exists = await fs.access(skillPath).then(() => true).catch(() => false);
  if (!exists) {
    return { id: 'qa-mode', label: '/qa-mode skill deployed', status: 'fail',
      detail: `Not found at ${skillPath}`,
      fix: 'Re-run the installer, or run deploy-harness.sh --update against the Playwright repo.' };
  }
  return { id: 'qa-mode', label: '/qa-mode skill deployed', status: 'pass', detail: 'qa-mode.md present in Playwright/.claude/commands/roles/' };
}

/** Run all checks in parallel and assemble the report. `role` gates the
 *  QA-only checks (Playwright browsers, qa-mode skill presence) — dev/lead/
 *  architect installs never touch the Playwright repo, so those checks would
 *  be a false "fail" for them rather than a meaningful signal. */
export async function runDoctor(workspacePath: string, role?: string): Promise<DoctorReport> {
  const env = await readEnv(workspacePath);
  const isQa = role === 'qa';
  const checks = await Promise.all([
    checkNode(),
    checkNpx(),
    checkMcpRegistry(),
    checkAdoPat(env, workspacePath),
    checkAdoMcp(workspacePath),
    checkJira(env, workspacePath),
    checkEmbeddedCreds(workspacePath),
    ...(isQa ? [checkPlaywrightBrowsers(workspacePath), checkQaModePresent(workspacePath)] : []),
  ]);
  return {
    checks,
    ranAt: new Date().toISOString(),
    ok: !checks.some((c) => c.status === 'fail'),
  };
}
