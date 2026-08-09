#!/usr/bin/env node
/*
 * Titan — Azure DevOps MCP launcher wrapper.
 *
 * WHY THIS EXISTS: Claude Code expands ${VAR} in .mcp.json ONLY from the OS
 * environment it inherited at launch — NOT from .claude/settings.local.json's
 * env block (documented limitation; GitHub claude-code #4276). So the obvious
 * config `"AZURE_DEVOPS_PAT": "${AZURE_DEVOPS_PAT}"` silently expands to empty
 * when Claude Code is launched from any context (VS Code / desktop / a shell
 * without the var), and the azure-devops MCP server authenticates as the null
 * identity → TF400813. That failed for every launch context.
 *
 * This wrapper removes the OS-env dependency entirely: it reads the PAT straight
 * from the on-disk settings.local.json (the same file the installer writes and
 * the per-repo deploy seeds), injects it into the child's environment, and
 * execs the real MCP server with stdio inherited so the JSON-RPC channel passes
 * through untouched. Result: as long as the PAT is in settings.local.json, the
 * connection works on every session start, in every launch context, with no OS
 * env var and no re-login — it "stays intact".
 *
 * .mcp.json wires it as:
 *   "azure-devops": { "type":"stdio", "command":"node",
 *                     "args":[".claude/scripts/mcp-ado-launch.cjs"] }
 *
 * SECURITY: the PAT is read into this process's memory and passed to the child
 * via env only. It is never written to stdout (that's the JSON-RPC channel),
 * never logged, and never placed on the command line (not visible in argv /
 * process list). Errors go to stderr only.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ADO_PKG = 'azure-devops-mcp@1.1.2';   // keep in sync with plugin-policy.md
const err = (m) => process.stderr.write(`[mcp-ado-launch] ${m}\n`);

/** Walk up from startDir looking for .claude/settings.local.json. Claude Code
 *  launches project MCP servers with cwd = the project root, but a repo-rooted
 *  session (v2.3.2 per-repo deploy) roots at the repo — walking up handles both,
 *  plus any nested cwd. */
function findSettingsEnv(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const p = path.join(dir, '.claude', 'settings.local.json');
    try {
      if (fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (cfg && cfg.env) return cfg.env;
      }
    } catch { /* unreadable/malformed — keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

const fileEnv = findSettingsEnv(process.cwd());

// settings.local.json is the managed source of truth (installer writes it,
// rotation updates it) — prefer it, fall back to an OS env var. This is what
// makes the connection stay intact across launch contexts and rotations.
const pat = fileEnv.AZURE_DEVOPS_PAT || process.env.AZURE_DEVOPS_PAT || '';

if (!pat) {
  err('AZURE_DEVOPS_PAT not found in .claude/settings.local.json or OS env.');
  err('Add your ADO PAT via the installer (it writes settings.local.json), then restart Claude Code.');
  process.exit(1);   // fail loudly — better than a silent null-identity auth
}

// URL normalization — the reason auth was 401'ing. azure-devops-mcp builds its
// collection URL as `serverUrl + "/" + collection`. The installer writes
// AZURE_DEVOPS_URL WITH the org already in it (e.g. https://dev.azure.com/<org>)
// and leaves AZURE_DEVOPS_COLLECTION unset, so a naive pass-through produced
// https://dev.azure.com/<org>/<org> (or .../DefaultCollection) → 401. Normalize
// regardless of which form the config holds: serverUrl is always the bare
// host, collection is the explicit value or the org path segment. There is
// deliberately NO hardcoded org fallback here — an unset/malformed URL fails
// loudly below rather than silently routing an adopter at some other org's
// ADO instance (the failure class this script's PAT check above already
// treats as unacceptable).
const rawUrl = (fileEnv.AZURE_DEVOPS_URL || process.env.AZURE_DEVOPS_URL ||
                fileEnv.AZURE_DEVOPS_ORG_URL || process.env.AZURE_DEVOPS_ORG_URL ||
                '').replace(/\/+$/, '');
let serverUrl = 'https://dev.azure.com';
let collection = (fileEnv.AZURE_DEVOPS_COLLECTION || process.env.AZURE_DEVOPS_COLLECTION || '').trim();
if (rawUrl) {
  try {
    const u = new URL(rawUrl);
    serverUrl = `${u.protocol}//${u.host}`;              // strip any path → bare host
    if (!collection) {
      const seg = u.pathname.split('/').filter(Boolean); // org is the first path segment
      if (seg.length) collection = seg[0];
    }
  } catch { /* malformed URL — fall through to the error below */ }
}
if (!collection) {
  err('AZURE_DEVOPS_URL / AZURE_DEVOPS_ORG_URL not found (or missing an org path) in .claude/settings.local.json or OS env.');
  err('Set AZURE_DEVOPS_URL to https://dev.azure.com/<your-org> via the installer, then restart Claude Code.');
  process.exit(1);   // fail loudly — never guess another org's identity
}
const url = serverUrl;   // what azure-devops-mcp expects in AZURE_DEVOPS_URL

const child = spawn('npx', ['-y', ADO_PKG], {
  // npx is npx.cmd on Windows — spawn(shell:false) throws ENOENT on .cmd shims,
  // so shell:true is required on win32 (args are constants — no injection surface).
  shell: process.platform === 'win32',
  stdio: 'inherit',   // transparently pipe the MCP JSON-RPC stream both ways
  env: {
    ...process.env,
    AZURE_DEVOPS_PAT: pat,
    AZURE_DEVOPS_URL: url,
    AZURE_DEVOPS_COLLECTION: collection,
  },
});

child.on('error', (e) => { err(`failed to launch ${ADO_PKG}: ${e.message}`); process.exit(1); });
child.on('exit', (code, signal) => { process.exit(signal ? 1 : (code ?? 0)); });

// Forward termination so Claude Code closing the server cleanly stops the child.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { try { child.kill(sig); } catch { /* already gone */ } });
}
