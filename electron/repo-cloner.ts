import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WebContents } from 'electron';

// Repo cloner — parallel git clone over HTTPS using the user's ADO PAT.
// Each clone is its own child_process running `git clone`. Events stream
// back to the renderer via webContents.send('clone:event', ...).
//
// Concurrency cap: up to 4 simultaneous clones. Repos beyond the cap queue.
// 4 is the sweet spot for typical corporate networks — higher tends to
// trigger rate-limits or saturate the VPN tunnel.

const MAX_PARALLEL = 4;

// One repo's worth of input. The clone URL is constructed inside this module
// so the renderer never has to know about the PAT-injection scheme.
export interface CloneInput {
  repoName: string;
  branch:   string;
  /** Absolute path the repo should land at. */
  targetPath: string;
}

export interface CloneEvent {
  repoName: string;
  status: 'queued' | 'cloning' | 'done' | 'failed';
  message?: string;
}

export interface CloneSpawnResult {
  ok: boolean;
  succeeded: string[];
  failed:    { repoName: string; message: string }[];
}

// SUPERSEDED fallback map — every real caller (main.ts's clone:start/retry)
// now passes a `cloneUrlFor` built from providers/scm/{azure-devops,github}.ts
// (config-driven via config.repos[] + config.platforms.scm), so buildCloneUrl
// below is only reached if a caller explicitly omits that override. Kept as
// a working default rather than deleted so this module still does something
// sane if called directly; values renamed off the reference implementation's org/repo
// names in the Titan de-branding pass.
const ADO_ORG = 'UNCONFIGURED-ADO-ORG';
const REPO_URL_MAP: Record<string, { project: string; repoSlug: string }> = {
  'example-storefront-ui':       { project: 'example-storefront-ui',       repoSlug: 'example-storefront-ui' },
  'example-webapp':              { project: 'example-webapp',              repoSlug: 'example-webapp' },
  'example-migration':           { project: 'example-migration',           repoSlug: 'example-migration' },
  'example-integration-layer':   { project: 'example-integration-layer',   repoSlug: 'example-integration-layer' },
  'example-commerce-platform':   { project: 'example-commerce-platform',   repoSlug: 'example-commerce-platform' },
  'Playwright':                                { project: 'Playwright',                                repoSlug: 'playwright' }
};

/** Build the CLEAN clone URL — NO credential embedded, so nothing is ever
 *  persisted into .git/config. Auth is supplied transiently via authEnv().
 *
 *  This is the pre-Titan fallback, kept for callers that don't pass a
 *  `cloneUrlFor` override (see runClones/retryClone below). The Titan
 *  provider layer (providers/scm/{azure-devops,github}.ts) supersedes this
 *  with a config-driven equivalent selected by `config.platforms.scm.kind`;
 *  main.ts's clone:start/clone:retry handlers always pass one in now, so
 *  this hardcoded fallback map is effectively dead code kept only so this module
 *  still has a sane default if called directly (e.g. from a test). */
function buildCloneUrl(repoName: string): string {
  const entry = REPO_URL_MAP[repoName];
  if (!entry) throw new Error(`Unknown repo: ${repoName}`);
  // URL-encode the project name (repo/project names can contain spaces).
  const proj = encodeURIComponent(entry.project);
  const slug = encodeURIComponent(entry.repoSlug);
  return `https://dev.azure.com/${ADO_ORG}/${proj}/_git/${slug}`;
}

/** Git env that authenticates with the PAT via an HTTP header, WITHOUT writing
 *  it to .git/config or exposing it in the process argv. GIT_CONFIG_* (git
 *  2.31+) injects the header for this invocation only — the persisted remote
 *  URL stays clean, so the PAT never lands in .git/config. */
export function authEnv(pat: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`:${pat}`, 'utf-8').toString('base64');
  return {
    ...process.env,
    GIT_CONFIG_COUNT:   '2',
    GIT_CONFIG_KEY_0:   'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    // AEM repos (jcr_root/apps/...) have paths past Windows MAX_PATH (260).
    // Without this, `git clone` checks out to 100% then exits 128 with
    // "Filename too long" on the deepest files. Set transiently for every
    // git call here so fresh machines clone cleanly with no global git config.
    GIT_CONFIG_KEY_1:   'core.longpaths',
    GIT_CONFIG_VALUE_1: 'true',
    GIT_TERMINAL_PROMPT: '0',   // never hang on a credential prompt
  };
}

/** Clone a single repo. Emits 'cloning' on start, 'done' or 'failed' on end. */
function cloneOne(
  webContents: WebContents,
  input: CloneInput,
  pat: string,
  cloneUrlFor: (repoName: string) => string = buildCloneUrl,
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    webContents.send('clone:event', {
      repoName: input.repoName,
      status: 'cloning'
    } satisfies CloneEvent);

    // If the target dir already contains a .git folder, treat it as already
    // cloned — run `git fetch` + checkout the requested branch instead. This
    // makes re-running the wizard idempotent and avoids "destination not
    // empty" failures on repeated test passes.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const dotGit = path.join(input.targetPath, '.git');
    if (fs.existsSync(dotGit)) {
      void (async () => {
        const runGit = (args: string[]): Promise<{ code: number | null; stderr: string }> =>
          new Promise((res) => {
            const c = spawn('git', ['-C', input.targetPath, ...args], {
              shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: authEnv(pat)
            });
            let se = '';
            c.stderr?.on('data', (b: Buffer) => { se += b.toString('utf-8'); });
            c.on('error', (err) => res({ code: null, stderr: err.message }));
            c.on('close', (code) => res({ code, stderr: se }));
          });
        // Remediate any PREVIOUSLY-embedded credential: reset origin to the
        // clean URL. Older installs baked the PAT into .git/config — this
        // scrubs it on re-run. Auth now comes from authEnv, not the URL.
        await runGit(['remote', 'set-url', 'origin', cloneUrlFor(input.repoName)]);
        const fetched = await runGit(['fetch', 'origin', input.branch]);
        if (fetched.code !== 0) {
          // Fixed in the 2.4.1 pre-ship audit: this used to report 'done' on
          // a failed fetch, so the row showed green while the checked-out
          // branch silently stayed whatever it was before — a
          // silently-wrong-branch risk with no visible signal to the user.
          // Report it as a real failure so the Retry button appears.
          webContents.send('clone:event', {
            repoName: input.repoName, status: 'failed',
            message: `git fetch failed for ${input.branch}: ${fetched.stderr.trim() || 'unknown error'}`
          });
          resolve({ ok: false, message: `Fetch failed for ${input.repoName}@${input.branch}.` });
          return;
        }
        const checked = await runGit(['checkout', input.branch]);
        if (checked.code !== 0) {
          webContents.send('clone:event', {
            repoName: input.repoName, status: 'failed',
            message: `Could not switch to ${input.branch}: ${checked.stderr.trim() || 'unknown error'}`
          });
          resolve({ ok: false, message: `Checkout failed for ${input.repoName}@${input.branch}.` });
          return;
        }
        await runGit(['pull', '--ff-only', 'origin', input.branch]);
        webContents.send('clone:event', {
          repoName: input.repoName, status: 'done',
          message: `Already present — fetched + switched to ${input.branch}`
        });
        resolve({ ok: true, message: `Updated existing clone to ${input.branch}.` });
      })();
      return;
    }

    const cloneUrl = cloneUrlFor(input.repoName);
    // Branch fallback: try the requested branch first; if not found on remote,
    // fall back to default branch (main/master/etc.) automatically.
    const spawnClone = (extraArgs: string[]) =>
      new Promise<{ code: number | null; stderr: string }>((res) => {
        const child2 = spawn('git', ['clone', ...extraArgs, cloneUrl, input.targetPath], {
          shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: authEnv(pat)
        });
        let se = '';
        child2.stderr?.on('data', (c: Buffer) => { se += c.toString('utf-8'); });
        child2.on('error', (err) => res({ code: null, stderr: err.message }));
        child2.on('close', (c) => res({ code: c, stderr: se }));
      });
    const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const b64 = Buffer.from(`:${pat}`, 'utf-8').toString('base64');
    const sanitise = (s: string) =>
      s.replace(new RegExp(esc(encodeURIComponent(pat)), 'g'), '<PAT>')
       .replace(new RegExp(esc(pat), 'g'), '<PAT>')
       .replace(new RegExp(esc(b64), 'g'), '<PAT>');

    void (async () => {
      // Attempt 1: requested branch (e.g. "develop"). Drop --single-branch so
      // other branches' refs are also fetched — user can git-checkout any
      // branch locally without re-fetching.
      const first = await spawnClone(['--branch', input.branch]);
      if (first.code === 0) {
        webContents.send('clone:event', { repoName: input.repoName, status: 'done' });
        resolve({ ok: true, message: `Cloned branch: ${input.branch}` });
        return;
      }

      // Attempt 2: branch not found → clone the remote's default branch
      const branchMissing = /Remote branch .+ not found/i.test(first.stderr) ||
                            /fatal: Remote branch/i.test(first.stderr);
      if (branchMissing) {
        webContents.send('clone:event', {
          repoName: input.repoName, status: 'cloning',
          message: `Branch "${input.branch}" not found — cloning default branch…`
        });
        const second = await spawnClone([]);   // no --branch = remote default (main/master/etc.)
        if (second.code === 0) {
          webContents.send('clone:event', {
            repoName: input.repoName, status: 'done',
            message: `Cloned default branch ("${input.branch}" not found on remote)`
          });
          resolve({ ok: true, message: 'Cloned default branch.' });
          return;
        }
        const m2 = `Fallback failed (code ${second.code}): ${sanitise(second.stderr).slice(-300)}`;
        webContents.send('clone:event', { repoName: input.repoName, status: 'failed', message: m2 });
        resolve({ ok: false, message: m2 });
        return;
      }

      // Any other error (auth, network)
      const msg = `git clone exited with code ${first.code}. ${sanitise(first.stderr).slice(-300)}`;
      webContents.send('clone:event', { repoName: input.repoName, status: 'failed', message: msg });
      resolve({ ok: false, message: msg });
    })();
  });
}

/** Run a set of clones with bounded parallelism. Returns when all complete.
 *  Pre-creates the workspace folder if missing. */
export async function runClones(
  webContents: WebContents,
  inputs: CloneInput[],
  pat: string,
  cloneUrlFor: (repoName: string) => string = buildCloneUrl,
): Promise<CloneSpawnResult> {
  // Ensure each parent directory exists. git clone will fail if the
  // immediate parent doesn't exist; it WILL fail-soft if the target dir
  // already exists, so callers should pre-detect and skip those.
  for (const i of inputs) {
    await fs.mkdir(path.dirname(i.targetPath), { recursive: true });
  }

  // All start as queued. Renderer paints them in queued state immediately.
  for (const i of inputs) {
    webContents.send('clone:event', {
      repoName: i.repoName,
      status: 'queued'
    } satisfies CloneEvent);
  }

  const succeeded: string[] = [];
  const failed: { repoName: string; message: string }[] = [];

  // Bounded parallel: a sliding window of size MAX_PARALLEL. Each completed
  // promise frees a slot for the next input. This is simpler and more
  // predictable than spinning up all N promises and hoping the OS queues them.
  let cursor = 0;
  const workers: Promise<void>[] = [];

  const launchWorker = async (): Promise<void> => {
    while (cursor < inputs.length) {
      const i = cursor++;
      const result = await cloneOne(webContents, inputs[i], pat, cloneUrlFor);
      if (result.ok) succeeded.push(inputs[i].repoName);
      else failed.push({ repoName: inputs[i].repoName, message: result.message });
    }
  };

  const parallelism = Math.min(MAX_PARALLEL, inputs.length);
  for (let n = 0; n < parallelism; n++) workers.push(launchWorker());
  await Promise.all(workers);

  return {
    ok: failed.length === 0,
    succeeded,
    failed
  };
}

/** Retry a single failed repo. Same code path as a fresh clone. */
export function retryClone(
  webContents: WebContents,
  input: CloneInput,
  pat: string,
  cloneUrlFor: (repoName: string) => string = buildCloneUrl,
): Promise<{ ok: boolean; message: string }> {
  return cloneOne(webContents, input, pat, cloneUrlFor);
}
