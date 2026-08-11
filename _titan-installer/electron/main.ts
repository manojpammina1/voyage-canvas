import { app, BrowserWindow, dialog, ipcMain, shell, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { runClones, retryClone, authEnv, type CloneInput } from './repo-cloner';
import { setAdoPat, getAdoPat, clearAdoPat, hasAdoPat, setFigmaPat, getFigmaPat, clearFigmaPat, hasFigmaPat,
         getTelemetrySasUrl, clearTelemetrySasUrl } from './token-vault';
import { readLocalSummary, uploadBatch, purgeLocal, readConfig, writeConfig, computeUserHash, readCostRollup,
         parseContainerFromSasUrl, EXPECTED_TELEMETRY_CONTAINER, verifySasWithRegistration,
         parseSasExpiry } from './telemetry-uploader';
import { runDoctor } from './doctor';
import { readCostSummary, readActiveProject } from './framework-state';
import { launchClaude, isClaudeInstalled } from './claude-launcher';
import { loadTitanConfig, saveTitanConfig, type TitanConfig } from './titan-config';
import { getScmProvider } from './providers/scm';
import { getIssueTrackerProvider } from './providers/tracker/jira';
import { getTelemetrySink } from './providers/telemetry-sink';

// Resolve the Titan config for a given (possibly not-yet-chosen) workspace.
// See titan-config.ts's resolveTitanConfigPath doc comment for why this
// falls back to the bundled harness copy before a workspace exists.
async function resolveConfig(workspacePath?: string | null): Promise<TitanConfig> {
  return loadTitanConfig(workspacePath ?? null, bundledHarnessPath() || null);
}

// Electron main process — fully wired Week 2 / Week 3 build.
//
// Two IPC patterns in use:
//   1. Request/response: ipcMain.handle(channel, fn) — for one-shot calls
//      like token validation, framework state reads.
//   2. Event push: webContents.send(channel, payload) — for long-running
//      operations (install.py, git clone) where the renderer needs a
//      stream of progress updates, not a single return value.
//
// Both patterns are exposed to the renderer via preload.ts contextBridge.

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#F5F6F8',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,                          // needed for keytar native module
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (IS_DEV) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // DevTools intentionally NOT auto-opened. End users (POs, managers) should
    // see only the install wizard, not a developer panel.
    // To debug during development, press F12 or Ctrl+Shift+I inside the
    // Electron window — that opens DevTools on demand.
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    registerIpcHandlers();
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────────────────────────────────────────────────────
// IPC handlers — every channel here has a matching surface in preload.ts.
// ─────────────────────────────────────────────────────────────────────────

/** Return the path to the install.py bundled with this installer app.
 *  In dev, assets/ is relative to the installer repo root.
 *  In a packaged build it lives in resources/assets/. */
function bundledInstallPyPath(): string {
  const packed = path.join(process.resourcesPath ?? '', 'assets', 'install.py');
  const dev1 = path.resolve(__dirname, '..', '..', 'assets', 'install.py');
  const dev2 = path.resolve(__dirname, '..', '..', '..', 'assets', 'install.py');
  for (const p of [packed, dev1, dev2]) {
    try { require('node:fs').accessSync(p); return p; } catch { /* try next */ }
  }
  return '';
}

/** Return the path to the bundled harness/ directory.
 *  Contains CLAUDE.md, .mcp.json, settings.json, commands/, hooks/,
 *  scripts/, subagents/, agents/ — the complete framework for any workspace.
 *  Packaged: resources/harness/   Dev: <repo-root>/harness/ */
function bundledHarnessPath(): string {
  const packed = path.join(process.resourcesPath ?? '', 'harness');
  const dev1 = path.resolve(__dirname, '..', 'harness');           // dist-electron/../harness
  const dev2 = path.resolve(__dirname, '..', '..', 'harness');     // src-relative fallback
  for (const p of [packed, dev1, dev2]) {
    try { require('node:fs').accessSync(p); return p; } catch { /* try next */ }
  }
  return '';
}

/** Write <targetRoot>/.claude/.harness-version from harness/VERSION.
 *  Always overwrites — a version marker should reflect current truth on
 *  every install AND every re-run, unlike the managed content set which is
 *  skip-if-exists on first install. Added in the 2.4.1 pre-ship audit —
 *  /ops/check-version previously read a TOOLKIT_VERSION from a
 *  setup-claude-toolkit.sh that doesn't exist in this repo. Mirrors the
 *  same write in deploy-harness.sh — keep the two in sync. */
async function writeHarnessVersion(harnessDir: string, targetRoot: string): Promise<void> {
  try {
    const version = (await fs.readFile(path.join(harnessDir, 'VERSION'), 'utf-8')).trim();
    await fs.mkdir(path.join(targetRoot, '.claude'), { recursive: true });
    await fs.writeFile(path.join(targetRoot, '.claude', '.harness-version'), version + '\n', 'utf-8');
  } catch { /* VERSION file missing from a dev harness checkout — non-fatal */ }
}

/** Recursively copy a directory tree. Emits a step event per sub-dir copied. */
async function copyDir(
  src: string,
  dst: string,
  emit: (phase: string, msg: string, level?: string) => void
): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const dstPath = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(srcPath, dstPath, emit);
    } else if (e.isFile()) {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

/** Deploy the harness into one git repo (per-repo plug-and-play). Skip-if-exists
 *  per item, never overwrites. Also writes .git/info/exclude entries so the
 *  harness (incl. settings.local.json holding PATs) can never be committed —
 *  none of the workspace repos gitignore .claude/. Returns the number of items
 *  deployed (0 = everything already present).
 *  Called from Phase 3b for every repo found at install time, AND from
 *  clone:retry so a repo the user gains access to later (failed clone →
 *  retry after setup) still gets the harness without re-running the wizard.
 *  Mirrors harness/scripts/deploy-harness.sh — keep the two in sync. */
async function deployHarnessIntoRepo(
  harnessDir: string,
  repoPath: string,
  wsSettingsLocalPath?: string,
): Promise<number> {
  const copyIfAbsent = async (src: string, dst: string): Promise<boolean> => {
    const srcOk = await fs.access(src).then(() => true).catch(() => false);
    if (!srcOk) return false;
    const dstExists = await fs.access(dst).then(() => true).catch(() => false);
    if (dstExists) return false;
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    return true;
  };
  const copyTreeIfAbsent = async (src: string, dst: string): Promise<boolean> => {
    const srcOk = await fs.access(src).then(() => true).catch(() => false);
    if (!srcOk) return false;
    const dstExists = await fs.access(dst).then(() => true).catch(() => false);
    if (dstExists) return false;
    await copyDir(src, dst, () => { /* silent — caller reports the summary */ });
    return true;
  };

  let deployed = 0;
  if (await copyIfAbsent(path.join(harnessDir, 'CLAUDE.md'), path.join(repoPath, 'CLAUDE.md'))) deployed++;
  if (await copyIfAbsent(path.join(harnessDir, '.mcp.json'), path.join(repoPath, '.mcp.json'))) deployed++;
  if (await copyIfAbsent(path.join(harnessDir, 'settings.json'), path.join(repoPath, '.claude', 'settings.json'))) deployed++;
  if (await copyIfAbsent(path.join(harnessDir, 'pricing.json'), path.join(repoPath, '.claude', 'pricing.json'))) deployed++;
  for (const sub of ['commands', 'hooks', 'scripts', 'subagents', 'data', 'runbooks', 'telemetry']) {
    const src1 = path.join(harnessDir, '.claude', sub);
    const src2 = path.join(harnessDir, sub);
    const dst  = path.join(repoPath, '.claude', sub);
    if (await copyTreeIfAbsent(src1, dst) || await copyTreeIfAbsent(src2, dst)) deployed++;
  }
  if (await copyTreeIfAbsent(path.join(harnessDir, 'agents', 'skills'), path.join(repoPath, '.claude', 'skills'))) deployed++;

  // Per-repo env: PATs for MCP ${VAR} expansion + CLAUDE_ROLE. Safe only
  // because of the exclude entries below.
  if (wsSettingsLocalPath &&
      await copyIfAbsent(wsSettingsLocalPath, path.join(repoPath, '.claude', 'settings.local.json'))) deployed++;

  const excludePath = path.join(repoPath, '.git', 'info', 'exclude');
  let excl = '';
  try { excl = await fs.readFile(excludePath, 'utf-8'); } catch { /* absent */ }
  // Marker string MUST match deploy-harness.sh's ("Titan harness") — see
  // that script's IDEMPOTENCY KEY comment (Titan extraction plan Residual
  // Risk #2, docs/HARNESS-UPDATE.md) for why this cannot be changed without
  // a one-time duplicate-block consequence for already-deployed repos.
  if (!excl.includes('Titan harness')) {
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.appendFile(excludePath,
      '\n# Titan harness (deployed locally by the installer) — never commit\n.claude/\nCLAUDE.md\n.mcp.json\ninstall.py\ntitan-configure.py\n');
    deployed++;
  }
  await writeHarnessVersion(harnessDir, repoPath);
  return deployed;
}

/** True if a harness looks already deployed at targetRoot — used to choose
 *  between deployHarnessIntoRepo (skip-if-exists, first install) and
 *  updateHarnessTree (force-overwrite + prune, re-run). Same signal
 *  deploy-harness.sh implicitly relies on (settings.json existing is what
 *  makes its default skip-if-exists mode a no-op). */
async function hasExistingHarness(targetRoot: string): Promise<boolean> {
  return fs.access(path.join(targetRoot, '.claude', 'settings.json')).then(() => true).catch(() => false);
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === '__pycache__') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFilesRecursive(abs)).map((r) => path.join(e.name, r)));
    else if (e.isFile()) out.push(e.name);
  }
  return out;
}

/** Force-overwrite + prune the managed harness content set into targetRoot
 *  (workspace root OR a single per-repo checkout — same relative layout
 *  either way, so one function serves both call sites). Mirrors
 *  harness/scripts/deploy-harness.sh --update --prune:
 *    - NEVER touches settings.local.json (not in the managed set at all).
 *    - Snapshots anything about to be overwritten or pruned into
 *      <targetRoot>/.claude/update-backups/<UTC-timestamp>/ FIRST, in the
 *      same files/ + NEW_FILES.txt shape the bash script's --rollback reads
 *      — so that tool can restore a GUI-triggered update too.
 *    - Excludes telemetry/ from both update and prune (live local data, per
 *      tools/ota/lib/harness-layout.js).
 *  This is what makes "reinstall the .exe to update" a real procedure
 *  instead of folklore (2.4.1 pre-ship audit finding): before this,
 *  deployHarnessIntoRepo's skip-if-exists behavior meant re-running the
 *  installer over an already-deployed workspace silently updated nothing. */
async function updateHarnessTree(
  harnessDir: string,
  targetRoot: string,
  emit: (phase: string, msg: string, level?: string) => void
): Promise<{ updated: number; pruned: number }> {
  const backupDir = path.join(targetRoot, '.claude', 'update-backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const filesBackupDir = path.join(backupDir, 'files');
  const newFiles: string[] = [];
  let updated = 0;
  let pruned = 0;

  const backupBeforeChange = async (dst: string, rel: string): Promise<void> => {
    const exists = await fs.access(dst).then(() => true).catch(() => false);
    if (exists) {
      const backupPath = path.join(filesBackupDir, rel);
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(dst, backupPath);
    } else {
      newFiles.push(rel);
    }
  };

  const copyFileForce = async (src: string, dst: string, rel: string): Promise<void> => {
    const srcOk = await fs.access(src).then(() => true).catch(() => false);
    if (!srcOk) return;
    await backupBeforeChange(dst, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    updated++;
  };

  const copyTreeForce = async (src: string, dst: string, relBase: string): Promise<void> => {
    const srcOk = await fs.access(src).then(() => true).catch(() => false);
    if (!srcOk) return;
    for (const rel of await listFilesRecursive(src)) {
      await copyFileForce(path.join(src, rel), path.join(dst, rel), path.join(relBase, rel));
    }
  };

  const pruneTree = async (src: string, dst: string, relBase: string): Promise<void> => {
    const srcOk = await fs.access(src).then(() => true).catch(() => false);
    if (!srcOk) return;   // never prune a dir this harness version doesn't ship at all
    for (const rel of await listFilesRecursive(dst)) {
      const stillInSource = await fs.access(path.join(src, rel)).then(() => true).catch(() => false);
      if (!stillInSource) {
        await backupBeforeChange(path.join(dst, rel), path.join(relBase, rel));
        await fs.rm(path.join(dst, rel));
        pruned++;
      }
    }
  };

  await copyFileForce(path.join(harnessDir, 'CLAUDE.md'), path.join(targetRoot, 'CLAUDE.md'), 'CLAUDE.md');
  await copyFileForce(path.join(harnessDir, '.mcp.json'), path.join(targetRoot, '.mcp.json'), '.mcp.json');
  await copyFileForce(path.join(harnessDir, 'settings.json'), path.join(targetRoot, '.claude', 'settings.json'), path.join('.claude', 'settings.json'));
  await copyFileForce(path.join(harnessDir, 'pricing.json'), path.join(targetRoot, '.claude', 'pricing.json'), path.join('.claude', 'pricing.json'));

  // telemetry/ deliberately excluded — live local data, never patched.
  for (const sub of ['commands', 'hooks', 'scripts', 'subagents', 'data', 'runbooks', 'cost-tracking', 'projects']) {
    const src1 = path.join(harnessDir, '.claude', sub);
    const src2 = path.join(harnessDir, sub);
    const srcDir = (await fs.access(src1).then(() => true).catch(() => false)) ? src1 : src2;
    const dstDir = path.join(targetRoot, '.claude', sub);
    await copyTreeForce(srcDir, dstDir, path.join('.claude', sub));
    await pruneTree(srcDir, dstDir, path.join('.claude', sub));
  }

  const skillsSrc = path.join(harnessDir, 'agents', 'skills');
  const skillsDst = path.join(targetRoot, '.claude', 'skills');
  await copyTreeForce(skillsSrc, skillsDst, path.join('.claude', 'skills'));
  await pruneTree(skillsSrc, skillsDst, path.join('.claude', 'skills'));

  if (newFiles.length > 0 || updated > 0 || pruned > 0) {
    await fs.mkdir(backupDir, { recursive: true }).catch(() => { /* best-effort */ });
    if (newFiles.length > 0) {
      await fs.writeFile(path.join(backupDir, 'NEW_FILES.txt'), newFiles.join('\n') + '\n', 'utf-8').catch(() => { /* best-effort */ });
    }
    emit('step', `Harness update snapshot: ${backupDir}`);
  }

  await writeHarnessVersion(harnessDir, targetRoot);
  return { updated, pruned };
}

function registerIpcHandlers(): void {
  // ── App info ──────────────────────────────────────────────────────────
  ipcMain.handle('app:get-version', () => app.getVersion());

  // ── Titan config — read/write titan.config.json ───────────────────────
  // Backs CloneRepos/RolePicker/AtlassianSetup/TelemetrySetup (config-driven
  // per §Phase 6 step 21) and the in-app Config Editor screen (step 22).
  ipcMain.handle('config:get-titan', async (_e, workspacePath?: string) => {
    return resolveConfig(workspacePath ?? null);
  });

  ipcMain.handle('config:save-titan', async (_e, workspacePath: string, patch: Partial<TitanConfig>) => {
    return saveTitanConfig(workspacePath, patch);
  });

  // ── App reset — clears all localStorage/session data and reloads ──────
  // Used by "Start over / Fresh install" button. Clears wizard state so
  // the onboarding screens show again after uninstall+reinstall.
  ipcMain.handle('app:reset-wizard', async () => {
    try {
      await session.defaultSession.clearStorageData({ storages: ['localstorage', 'indexdb', 'cookies'] });
      mainWindow?.webContents.reload();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  // ── Shell — open external URLs in default browser ────────────────────
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (!/^https?:\/\//.test(url)) {
      throw new Error(`Refusing to open non-http(s) URL: ${url}`);
    }
    await shell.openExternal(url);
  });

  // ── Folder picker for WorkspaceLocation screen ────────────────────────
  ipcMain.handle('dialog:pick-folder', async (_e, defaultPath?: string) => {
    if (!mainWindow) return { ok: false, message: 'No window' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a workspace folder',
      defaultPath: defaultPath ?? 'C:\\codebase',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: 'No folder selected' };
    }
    return { ok: true, data: { folderPath: result.filePaths[0] } };
  });

  // ── Free-space check ──────────────────────────────────────────────────
  ipcMain.handle('fs:free-space', async (_e, folderPath: string) => {
    try {
      const stats = await fs.statfs?.(folderPath);
      if (!stats) return { ok: false, message: 'statfs unavailable' };
      const freeBytes = stats.bavail * stats.bsize;
      const totalBytes = stats.blocks * stats.bsize;
      return { ok: true, data: { freeBytes, totalBytes } };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  // ── Prereq detection — which/where for node/java/python/git ──────────
  // Emits 'prereqs:detect-event' as EACH check genuinely finishes (not a
  // simulated/staggered reveal — these are real child_process spawns that
  // resolve at different real times) so the renderer can show a live log
  // instead of one opaque "Detecting tools…" line. Final return shape is
  // unchanged for back-compat with anything still awaiting the promise alone.
  ipcMain.handle('prereqs:detect', async (e, role?: string) => {
    // QA Tester never touches AEM/Maven — Java is a dev/lead/architect-only
    // prereq. Node/Python/Git/Claude stay: Node runs the Claude CLI + the
    // later `npx playwright install` step, Python runs the governance hooks.
    const isQa = role === 'qa';
    const specs: { name: string; run: () => Promise<{ name: string; detected: boolean; version: string }> }[] = [
      { name: 'node',   run: () => detectCmd('node', ['--version']) },
      ...(isQa ? [] : [{ name: 'java', run: () => detectCmd('java', ['-version']) }]),   // java prints to stderr
      { name: 'python', run: () => detectCmd('python', ['--version']) },
      { name: 'git',    run: () => detectCmd('git',    ['--version']) },
      { name: 'claude', run: () => isClaudeInstalled().then((ok) => ({ name: 'claude', detected: ok, version: '' })) },
    ];
    e.sender.send('prereqs:detect-event', { phase: 'start', total: specs.length });
    const checks = await Promise.all(specs.map((s) =>
      s.run().then((result) => {
        e.sender.send('prereqs:detect-event', { phase: 'result', name: s.name, result });
        return result;
      })
    ));
    e.sender.send('prereqs:detect-event', { phase: 'done' });
    return { ok: true, data: { checks } };
  });

  // ── Winget availability check (Windows 10 1809+ ships winget) ────────
  ipcMain.handle('prereqs:winget-available', async () => {
    return new Promise<{ available: boolean }>((resolve) => {
      const c = spawn('winget', ['--version'], { shell: false });
      c.on('error', () => resolve({ available: false }));
      c.on('close', (code) => resolve({ available: code === 0 }));
    });
  });

  // ── Per-prereq installer ─────────────────────────────────────────────
  // Spawns winget (or npm for Claude Code) with the right package ID.
  // Streams output back via 'prereqs:install-event' so the UI can show progress.
  // Returns final result. PATH refresh for the spawning process won't propagate
  // — caller surfaces "restart installer" banner if detect still fails after install.
  const WINGET_PACKAGES: Record<string, { type: 'winget' | 'npm'; id: string; label: string }> = {
    node:   { type: 'winget', id: 'OpenJS.NodeJS.LTS',     label: 'Node.js LTS' },
    java:   { type: 'winget', id: 'Microsoft.OpenJDK.17',  label: 'OpenJDK 17' },
    python: { type: 'winget', id: 'Python.Python.3.12',    label: 'Python 3.12' },
    git:    { type: 'winget', id: 'Git.Git',               label: 'Git' },
    claude: { type: 'npm',    id: '@anthropic-ai/claude-code', label: 'Claude Code' },
  };

  ipcMain.handle('prereqs:install', async (e, name: string) => {
    const pkg = WINGET_PACKAGES[name];
    if (!pkg) return { ok: false, message: `Unknown prereq: ${name}` };

    return new Promise<{ ok: boolean; message: string; needsRestart: boolean }>((resolve) => {
      let cmd: string;
      let args: string[];
      if (pkg.type === 'winget') {
        cmd = 'winget';
        args = ['install', '--id', pkg.id, '--accept-package-agreements', '--accept-source-agreements', '--silent'];
      } else {
        cmd = 'npm';
        args = ['install', '-g', pkg.id];
      }

      const child = spawn(cmd, args, { shell: true });
      let combined = '';
      child.stdout?.on('data', (b: Buffer) => {
        const text = b.toString('utf-8');
        combined += text;
        e.sender.send('prereqs:install-event', { name, line: text });
      });
      child.stderr?.on('data', (b: Buffer) => {
        const text = b.toString('utf-8');
        combined += text;
        e.sender.send('prereqs:install-event', { name, line: text });
      });
      child.on('error', (err: Error) => {
        resolve({ ok: false, message: err.message, needsRestart: false });
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            ok: true,
            message: `${pkg.label} installed. If detection still fails, close + reopen the Titan installer so PATH refreshes.`,
            needsRestart: pkg.type === 'winget',  // PATH-changing tools need session restart
          });
        } else {
          // Trim noisy combined to last 300 chars
          const tail = combined.slice(-300).trim();
          resolve({ ok: false, message: `Install exited code ${code}.\n${tail}`, needsRestart: false });
        }
      });
    });
  });

  // ── SCM PAT — vault + validation ──────────────────────────────────────
  // Routed through providers/scm/*, selected by config.platforms.scm.kind.
  // Channel name (token:test-ado) kept for backward IPC compatibility even
  // though it now also covers GitHub — renaming the channel would require
  // touching preload.ts + global.d.ts + every call site for no behavioural
  // gain.
  ipcMain.handle('token:test-ado', async (_e, pat: string, workspacePath?: string) => {
    const config = await resolveConfig(workspacePath);
    const scm = getScmProvider(config);
    const result = await scm.validatePat(pat);
    return { ...result, testedAt: new Date().toISOString() };
  });

  ipcMain.handle('token:store-ado', async (_e, pat: string) => {
    try {
      await setAdoPat(pat);
      return { ok: true, message: 'Stored.' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  ipcMain.handle('token:has-ado', async () => {
    try { return { ok: await hasAdoPat() }; }
    catch { return { ok: false }; }
  });

  ipcMain.handle('token:clear-ado', async () => {
    try { return { ok: await clearAdoPat() }; }
    catch { return { ok: false }; }
  });

  // ── Figma PAT — vault + validation ───────────────────────────────────
  // Validates a Figma Personal Access Token against the public /v1/me
  // endpoint. Returns 200 with handle on success, 401/403 on auth failure.
  ipcMain.handle('token:test-figma', async (_e, pat: string) => {
    const https = require('node:https') as typeof import('node:https');
    return new Promise<{ ok: boolean; status: number; message: string }>((resolve) => {
      const req = https.request({
        hostname: 'api.figma.com',
        path: '/v1/me',
        method: 'GET',
        headers: {
          'X-Figma-Token': pat,
          'Accept': 'application/json'
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status === 200) {
            try {
              const data = JSON.parse(body) as { handle?: string; email?: string };
              resolve({ ok: true, status, message: `✓ Connected as ${data.handle ?? data.email ?? 'Figma user'}` });
            } catch { resolve({ ok: true, status, message: '✓ Connected' }); }
          } else if (status === 401 || status === 403) {
            resolve({ ok: false, status, message: `${status} — token invalid or lacks file_read scope` });
          } else {
            resolve({ ok: false, status, message: `HTTP ${status} — try again` });
          }
        });
      });
      req.on('error', (err: Error) => resolve({ ok: false, status: 0, message: err.message }));
      req.end();
    });
  });

  ipcMain.handle('token:store-figma', async (_e, pat: string) => {
    try { await setFigmaPat(pat); return { ok: true, message: 'Stored.' }; }
    catch (err) { return { ok: false, message: (err as Error).message }; }
  });

  ipcMain.handle('token:has-figma', async () => {
    try { return { ok: await hasFigmaPat() }; }
    catch { return { ok: false }; }
  });

  ipcMain.handle('token:clear-figma', async () => {
    try { return { ok: await clearFigmaPat() }; }
    catch { return { ok: false }; }
  });

  // ── Jira/Atlassian test connection (PO/Manager path) ─────────────────
  // Routed through providers/tracker/jira.ts, selected by
  // config.platforms.issue_tracker.kind, instead of a hardcoded
  // company Atlassian-site hostname. workspacePath is optional —
  // this screen can run before a workspace is chosen (see
  // titan-config.ts:resolveTitanConfigPath), in which case the bundled
  // harness's titan.config.json is used.
  ipcMain.handle('token:test-jira', async (_e, email: string, token: string, workspacePath?: string) => {
    const config = await resolveConfig(workspacePath);
    const tracker = getIssueTrackerProvider(config.platforms.issue_tracker);
    if (tracker.kind === 'none') {
      return { ok: false, status: 0, message: 'No issue tracker configured (platforms.issue_tracker.kind = "none") — skip this step.' };
    }
    return tracker.validateToken(email, token);
  });

  // ── ADO refs API — list branches for a repo ───────────────────────────
  // Hit /_apis/git/repositories/{repo}/refs?filter=heads/ to enumerate every
  // branch. Used by the wizard's per-repo branch dropdown.
  // PAT is taken from the in-session wizard value to avoid a keytar round-trip.
  //
  // Fixed in the 2.4.1 pre-ship audit: previously filtered server-side to
  // `heads/release` only, so a repo on a feature/* or main/master branch
  // (both real, e.g. an active feature/* branch in a webapp-style repo)
  // never appeared in the dropdown — the only way to pick
  // a non-release branch was the free-text fallback shown when the list
  // errors. Now fetches all branches and ranks release/* first (still
  // reverse-sorted so the latest release sorts to the top), everything else
  // alphabetically after, capped so a very active repo doesn't produce an
  // unusable multi-hundred-item dropdown.
  // Routed through providers/scm/*, selected by config.platforms.scm.kind —
  // works for Azure DevOps or GitHub, not just a hardcoded ADO org.
  ipcMain.handle('ado:list-release-branches', async (_e, repoName: string, pat: string, workspacePath?: string) => {
    const config = await resolveConfig(workspacePath);
    const scm = getScmProvider(config);
    return scm.listRepoBranches(repoName, pat);
  });

  // ── Repo clone ───────────────────────────────────────────────────────
  // Clone URLs are built by the config-selected SCM provider
  // (providers/scm/*) instead of the old hardcoded ADO org + REPO_URL_MAP.
  // targetPath is `<workspacePath>\<repoName>` (see CloneRepos.tsx's
  // joinPath call), so the workspace root is its parent directory — there's
  // no separate workspacePath param on this channel to avoid a preload/
  // global.d.ts signature change for a value already derivable here.
  ipcMain.handle('clone:start', async (e, inputs: CloneInput[]) => {
    let pat: string | null = null;
    try { pat = await getAdoPat(); } catch { /* keytar unavailable */ }
    if (!pat) return { ok: false, message: 'No ADO PAT stored — complete the ADO PAT screen first.' };
    const wsPath = inputs[0] ? path.dirname(inputs[0].targetPath) : null;
    const scm = getScmProvider(await resolveConfig(wsPath));
    const result = await runClones(e.sender, inputs, pat, (repoName) => scm.cloneUrl(repoName, pat as string));
    return result;
  });

  ipcMain.handle('clone:retry', async (e, input: CloneInput) => {
    let pat: string | null = null;
    try { pat = await getAdoPat(); } catch { /* keytar unavailable */ }
    if (!pat) return { ok: false, message: 'No ADO PAT stored' };
    const wsPath = path.dirname(input.targetPath);
    const scm = getScmProvider(await resolveConfig(wsPath));
    const result = await retryClone(e.sender, input, pat, (repoName) => scm.cloneUrl(repoName, pat as string));
    // Late-arriving repo (user lacked access at install time, or network
    // failure): a successful retry may happen AFTER Phase 3b already ran,
    // so deploy the harness into the fresh clone here. Fail-soft — a deploy
    // problem must not turn a successful clone into a reported failure.
    if (result.ok) {
      try {
        const harnessDir = bundledHarnessPath();
        if (harnessDir) {
          const wsSettingsLocal = path.join(path.dirname(input.targetPath), '.claude', 'settings.local.json');
          await deployHarnessIntoRepo(harnessDir, input.targetPath, wsSettingsLocal);
        }
      } catch { /* workspace-root harness still applies */ }
    }
    return result;
  });

  // ── Native auto-setup — writes settings.local.json + verifies structure ─
  // Replaces the Python install.py subprocess. Runs entirely in Node so
  // there are no Python PATH or keytar-hang issues.
  ipcMain.handle('setup:run-native', async (e, payload: {
    role: string;
    workspacePath: string;
    adoPat: string;       // passed directly from wizard state — no keytar read
    jiraEmail?: string;   // doctor REST check only — Rovo connector uses OAuth, not this
    jiraToken?: string;
    telemetrySasUrl?: string;  // optional — stored in keytar, never in any file
    displayName?: string;      // optional — local-only, written to roster-entry.json, never uploaded
  }) => {
    const emit = (phase: string, message: string, level = 'info'): void => {
      e.sender.send('installer:event', { protocol: '1.0', phase, progress: 0, message, level });
    };

    try {
      emit('phase', 'Phase 1 — Prerequisites');

      // Python check
      const py = await new Promise<string>((res) => {
        const c = spawn('python', ['--version'], { shell: false, stdio: ['ignore','pipe','pipe'] });
        let o = ''; c.stdout.on('data', (d: Buffer) => { o += d; }); c.stderr.on('data', (d: Buffer) => { o += d; });
        c.on('close', () => res(o.trim())); c.on('error', () => res(''));
      });
      if (py) emit('step', `Python: ${py}`);
      else emit('step', 'Python not found — install Python 3.8+', 'warn');

      // Node check
      const nd = await new Promise<string>((res) => {
        const c = spawn('node', ['--version'], { shell: false, stdio: ['ignore','pipe','pipe'] });
        let o = ''; c.stdout.on('data', (d: Buffer) => { o += d; });
        c.on('close', () => res(o.trim())); c.on('error', () => res(''));
      });
      emit('step', nd ? `Node.js: ${nd}` : 'Node.js not found');

      // git check
      const git = await new Promise<string>((res) => {
        const c = spawn('git', ['--version'], { shell: false, stdio: ['ignore','pipe','pipe'] });
        let o = ''; c.stdout.on('data', (d: Buffer) => { o += d; });
        c.on('close', () => res(o.trim())); c.on('error', () => res(''));
      });
      emit('step', git ? `git: ${git}` : 'git not found');

      emit('phase', 'Phase 2 — Writing Settings');

      // Map installer role → CLAUDE_ROLE value
      const claudeRole = payload.role === 'dev' ? 'developer' : payload.role;

      const claudeDir = path.join(payload.workspacePath, '.claude');
      await fs.mkdir(claudeDir, { recursive: true });

      // Local-only display-name mapping (SLING-PHASE2 v2.4.1). Written ONLY to
      // this machine's disk — never uploaded, never touches the anonymous
      // telemetry blob. The dashboard maintainer collects roster-entry.json
      // fragments out-of-band (Teams/email/shared drive) and merges them with
      // build-user-map.mjs, which now accepts multiple fragment files. Skips
      // silently if the user left the field blank.
      const trimmedName = (payload.displayName ?? '').trim();
      if (trimmedName) {
        const rosterEntry = { username: os.userInfo().username, name: trimmedName };
        await fs.writeFile(
          path.join(claudeDir, 'roster-entry.json'),
          JSON.stringify(rosterEntry, null, 2) + '\n',
          'utf-8'
        );
        emit('step', `Local display-name mapping saved (${trimmedName}) — not uploaded`);
      }

      // Read existing settings.local.json if present (preserve existing keys)
      const localPath = path.join(claudeDir, 'settings.local.json');
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(await fs.readFile(localPath, 'utf-8')) as Record<string, unknown>;
      } catch { /* first run */ }

      const existingEnv = (existing.env as Record<string, unknown>) ?? {};
      const newEnv: Record<string, string> = {
        ...existingEnv as Record<string, string>,
        CLAUDE_ROLE: claudeRole,
      };

      // ADO org URL — derived from config.platforms.scm (collection/base_url)
      // instead of a hardcoded org. Only meaningful for the azure-devops MCP
      // server; skipped entirely for a GitHub-configured workspace (its MCP
      // wiring is templated by .mcp.json, not this env block — see Phase 5
      // item 19 of the Titan extraction plan).
      const configForEnv = await resolveConfig(payload.workspacePath);
      if (configForEnv.platforms.scm.kind === 'azure-devops') {
        const org = getScmProvider(configForEnv).baseUrl();
        newEnv.AZURE_DEVOPS_URL     = org;
        newEnv.AZURE_DEVOPS_ORG_URL = org;
      }

      // ADO credentials — dev/lead/architect path
      if (payload.adoPat) {
        newEnv.AZURE_DEVOPS_PAT   = payload.adoPat;
        newEnv.AZURE_DEVOPS_TOKEN = payload.adoPat;
      }

      // Atlassian credentials — all roles.
      // NOTE: these are NOT read by any MCP server. Jira/Confluence access is
      // the built-in Atlassian Rovo connector (claude.ai connector settings,
      // OAuth on first use) — it is not in .mcp.json. JIRA_EMAIL/JIRA_API_TOKEN
      // are used only by the doctor's REST identity check + REST-based scripts.
      if (payload.jiraEmail) newEnv.JIRA_EMAIL     = payload.jiraEmail;
      if (payload.jiraToken) newEnv.JIRA_API_TOKEN = payload.jiraToken;

      // Figma PAT — dev/lead/architect path (optional)
      try {
        const figmaPat = await getFigmaPat();
        if (figmaPat) newEnv.FIGMA_PERSONAL_ACCESS_TOKEN = figmaPat;
      } catch { /* keytar unavailable */ }

      // Telemetry SAS — also written to settings.local.json env so the
      // out-of-band scheduled uploader (Node script via .bat) can read it
      // without needing Credential Manager access. settings.local.json is
      // gitignored — same security posture as ADO PAT / Jira token here.
      if (payload.telemetrySasUrl && payload.telemetrySasUrl.startsWith('https://')) {
        newEnv.TITAN_TELEMETRY_SAS_URL = payload.telemetrySasUrl;
      }

      const newSettings = { ...existing, env: newEnv };

      await fs.writeFile(localPath, JSON.stringify(newSettings, null, 2) + '\n', 'utf-8');
      emit('step', `.claude/settings.local.json written (role: ${claudeRole})`);

      // NOTE (2.4.1 pre-ship audit): this used to ALSO write the SAS to
      // keytar here, which put the install flow out of step with
      // telemetry:set-sas-url's documented single-source-of-truth policy
      // (main.ts, see the comment above that handler) — settings.local.json
      // is the one write target for new values; keytar is read-only legacy
      // fallback for pre-migration installs. Every new install now agrees
      // with every later edit instead of leaving a keytar copy that only
      // this one code path created. clearTelemetrySasUrl() is still called
      // from telemetry:set-sas-url on an explicit clear, so a stale keytar
      // value from an install predating this fix still gets cleaned up once
      // the user touches the field.

      emit('phase', 'Phase 3 — Deploying Framework Files');

      // All harness files (CLAUDE.md, .mcp.json, settings.json, commands/,
      // hooks/, scripts/, subagents/, agents/) are bundled in harness/.
      // This makes the installer fully self-contained — no dependency on
      // C:\codebase\ecom-webapp or any other machine-specific path.
      const harnessDir = bundledHarnessPath();
      if (!harnessDir) {
        emit('step', 'Bundled harness not found — framework files cannot be deployed', 'error');
      } else {
        emit('step', `Harness source: ${harnessDir}`);

        // ── install.py ─────────────────────────────────────────────────────
        // Manual-fallback file, not part of the managed/patchable set —
        // always skip-if-exists regardless of update vs fresh install.
        const bundledPy = bundledInstallPyPath();
        const targetInstallPy = path.join(payload.workspacePath, 'install.py');
        if (bundledPy) {
          try { await fs.access(targetInstallPy); emit('step', 'install.py already present ✓'); }
          catch { await fs.copyFile(bundledPy, targetInstallPy); emit('step', 'install.py deployed ✓'); }
        }

        // Fixed in the 2.4.1 pre-ship audit: re-running the installer over an
        // already-deployed workspace used to hit skip-if-exists at every step
        // below and update nothing — "reinstall to update" was folklore, not
        // a real procedure. Now: existing harness → force-update + prune via
        // updateHarnessTree (mirrors deploy-harness.sh --update --prune);
        // first install → the original skip-if-exists sequence, unchanged.
        const workspaceHasHarness = await hasExistingHarness(payload.workspacePath);
        if (workspaceHasHarness) {
          emit('step', 'Existing harness detected — updating in place (force-overwrite + prune)…');
          const { updated, pruned } = await updateHarnessTree(harnessDir, payload.workspacePath, emit);
          emit('step', `Workspace harness updated: ${updated} file(s) updated, ${pruned} pruned.`);
        } else {
        // ── Root files: CLAUDE.md, .mcp.json ──────────────────────────────
        for (const f of ['CLAUDE.md', '.mcp.json']) {
          const src = path.join(harnessDir, f);
          const dst = path.join(payload.workspacePath, f);
          try {
            await fs.access(src);
            try { await fs.access(dst); emit('step', `${f} already present ✓`); continue; } catch { /* copy */ }
            await fs.copyFile(src, dst);
            emit('step', `${f} deployed ✓`);
          } catch { emit('step', `${f} not in harness — skipping`, 'warn'); }
        }

        // ── .claude/settings.json (framework permissions) ─────────────────
        const srcSettings = path.join(harnessDir, 'settings.json');
        const dstSettings = path.join(payload.workspacePath, '.claude', 'settings.json');
        try {
          await fs.access(srcSettings);
          try { await fs.access(dstSettings); emit('step', '.claude/settings.json already present ✓'); }
          catch { await fs.copyFile(srcSettings, dstSettings); emit('step', '.claude/settings.json deployed ✓'); }
        } catch { /* not in harness */ }

        // ── .claude/pricing.json (cost-estimator pricing table) ───────────
        const srcPricing = path.join(harnessDir, 'pricing.json');
        const dstPricing = path.join(payload.workspacePath, '.claude', 'pricing.json');
        try {
          await fs.access(srcPricing);
          try { await fs.access(dstPricing); emit('step', '.claude/pricing.json already present ✓'); }
          catch { await fs.copyFile(srcPricing, dstPricing); emit('step', '.claude/pricing.json deployed ✓'); }
        } catch { /* not in harness */ }

        // ── .claude/commands/, hooks/, scripts/, subagents/, data/, cost-tracking/, projects/, runbooks/, telemetry/ ───
        // data/ = deterministic lookup tables for the answer-cache hook (aem-build-map, reviewer-map)
        for (const sub of ['commands', 'hooks', 'scripts', 'subagents', 'data', 'cost-tracking', 'projects', 'runbooks', 'telemetry']) {
          const srcDir = path.join(harnessDir, '.claude', sub);
          const fallbackSrc = path.join(harnessDir, sub);
          const dstDir = path.join(payload.workspacePath, '.claude', sub);
          // commands/hooks/scripts/subagents/runbooks live at harness root;
          // cost-tracking/projects live under harness/.claude/
          let chosenSrc = '';
          try { await fs.access(srcDir); chosenSrc = srcDir; }
          catch {
            try { await fs.access(fallbackSrc); chosenSrc = fallbackSrc; }
            catch { /* not in harness */ }
          }
          if (!chosenSrc) continue;
          try { await fs.access(dstDir); emit('step', `.claude/${sub}/ already present ✓`); continue; } catch { /* copy */ }
          await copyDir(chosenSrc, dstDir, emit);
          emit('step', `.claude/${sub}/ deployed ✓`);
        }

        // ── .claude/skills/ (caveman + any other installable skills) ──────
        // Source lives at harnessDir/agents/skills — a different root than the
        // commands/hooks/etc. list above, so it needs its own copy step. This
        // was previously omitted here entirely (deploy-harness.sh mirrors it too).
        {
          const srcSkills = path.join(harnessDir, 'agents', 'skills');
          const dstSkills = path.join(payload.workspacePath, '.claude', 'skills');
          try {
            await fs.access(srcSkills);
            try { await fs.access(dstSkills); emit('step', '.claude/skills/ already present ✓'); }
            catch { await copyDir(srcSkills, dstSkills, emit); emit('step', '.claude/skills/ deployed ✓'); }
          } catch { /* not in harness */ }
        }
        await writeHarnessVersion(harnessDir, payload.workspacePath);
        }

        // ── .claude-projects/ (Titan project registry + framework reviews) ──
        const srcClaudeProjects = path.join(harnessDir, '.claude-projects');
        const dstClaudeProjects = path.join(payload.workspacePath, '.claude-projects');
        try {
          await fs.access(srcClaudeProjects);
          try { await fs.access(dstClaudeProjects); emit('step', '.claude-projects/ already present ✓'); }
          catch { await copyDir(srcClaudeProjects, dstClaudeProjects, emit); emit('step', '.claude-projects/ deployed ✓'); }
        } catch { /* not in harness */ }

        // ── .agents/ (skills: caveman, etc.) ──────────────────────────────
        const srcAgents = path.join(harnessDir, 'agents');
        const dstAgents = path.join(payload.workspacePath, '.agents');
        try {
          await fs.access(srcAgents);
          try { await fs.access(dstAgents); emit('step', '.agents/ (skills) already present ✓'); }
          catch { await copyDir(srcAgents, dstAgents, emit); emit('step', '.agents/ (skills) deployed ✓'); }
        } catch { emit('step', '.agents/ not in harness', 'warn'); }

        // ── Phase 3b — per-repo harness deploy ─────────────────────────────
        // Each cloned repo has its own .git, so a Claude Code session opened at
        // a REPO root (not the workspace root) anchors there and sees none of
        // the workspace harness — no skills, no CLAUDE.md, and critically no
        // secret-protection hooks (the Ecommerce/Hybris repo holds irrotatable
        // credentials). Deploy the same harness into every git repo found in
        // the workspace, skip-if-exists per file, so sessions are plug-and-play
        // regardless of where the developer opens Claude Code.
        // Mirrors harness/scripts/deploy-harness.sh — keep the two in sync.
        emit('phase', 'Phase 3b — Per-Repo Harness Deploy');
        try {
          const wsEntries = await fs.readdir(payload.workspacePath, { withFileTypes: true });
          const repoDirs: string[] = [];
          for (const e of wsEntries) {
            if (!e.isDirectory() || e.name.startsWith('.')) continue;
            const gitDir = path.join(payload.workspacePath, e.name, '.git');
            const hasGit = await fs.access(gitDir).then(() => true).catch(() => false);
            if (hasGit) repoDirs.push(e.name);
          }
          // Repos the user could NOT clone (no ADO access, network) simply have
          // no directory/.git here and are skipped without error. When access
          // arrives later, the clone Retry path (clone:retry) deploys the
          // harness into that repo on success — no wizard re-run needed.
          const wsSettingsLocal = path.join(payload.workspacePath, '.claude', 'settings.local.json');
          for (const repo of repoDirs) {
            const repoPath = path.join(payload.workspacePath, repo);
            try {
              // Same fresh-install vs re-run branch as the workspace root above.
              if (await hasExistingHarness(repoPath)) {
                const { updated, pruned } = await updateHarnessTree(harnessDir, repoPath, emit);
                emit('step', `${repo}: harness updated (${updated} updated, ${pruned} pruned) ✓`);
              } else {
                const deployed = await deployHarnessIntoRepo(harnessDir, repoPath, wsSettingsLocal);
                emit('step', deployed > 0
                  ? `${repo}: harness deployed (${deployed} item(s)) ✓`
                  : `${repo}: harness already present ✓`);
              }
            } catch (repoErr) {
              emit('step', `${repo}: per-repo deploy failed — ${(repoErr as Error).message} (workspace-root harness still applies)`, 'warn');
            }
          }
          if (repoDirs.length === 0) emit('step', 'No git repos found in workspace — nothing to deploy per-repo');

          // ── Phase 3c — Playwright browser install (QA Tester only) ──────
          // Browsers are a per-repo devDependency, not a globally-detectable
          // prereq (PrereqCheck has nothing meaningful to check before the
          // repo exists) — so this runs here, post-clone, gated to role=qa.
          if (payload.role === 'qa') {
            emit('phase', 'Phase 3c — Playwright Browsers');
            const pwRepoPath = path.join(payload.workspacePath, 'Playwright');
            const pwRepoExists = repoDirs.includes('Playwright');
            if (!pwRepoExists) {
              emit('step', 'Playwright repo not found in workspace — skipping browser install (clone it first, then re-run from the dashboard)', 'warn');
            } else {
              emit('step', 'Running npx playwright install (downloads browser binaries — may take a few minutes)…');
              await new Promise<void>((resolve) => {
                const child = spawn('npx', ['playwright', 'install'], {
                  cwd: pwRepoPath, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe']
                });
                let tail = '';
                child.stdout?.on('data', (b: Buffer) => { tail = (tail + b.toString('utf-8')).slice(-500); });
                child.stderr?.on('data', (b: Buffer) => { tail = (tail + b.toString('utf-8')).slice(-500); });
                child.on('error', (err) => {
                  emit('step', `Could not run npx playwright install: ${err.message} — run it manually from the Playwright repo`, 'warn');
                  resolve();
                });
                child.on('close', (code) => {
                  emit('step', code === 0
                    ? 'Playwright browsers installed ✓'
                    : `npx playwright install exited code ${code} — run it manually from the Playwright repo.\n${tail.trim()}`,
                    code === 0 ? 'info' : 'warn');
                  resolve();
                });
              });
            }
          }
        } catch (err) {
          emit('step', `Per-repo deploy skipped: ${(err as Error).message}`, 'warn');
        }
      }

      emit('phase', 'Phase 4 — Verifying Setup');

      const settingsJson = path.join(claudeDir, 'settings.json');
      try { await fs.access(settingsJson); emit('step', '.claude/settings.json ✓'); }
      catch { emit('step', '.claude/settings.json missing — run install.py manually to complete setup', 'warn'); }

      const claudeMd = path.join(payload.workspacePath, 'CLAUDE.md');
      try { await fs.access(claudeMd); emit('step', 'CLAUDE.md ✓'); }
      catch { emit('step', 'CLAUDE.md missing', 'warn'); }

      // Register Windows Scheduled Task for periodic telemetry upload.
      // Only if SAS was provided. Idempotent — safe to re-register.
      if (payload.telemetrySasUrl && payload.telemetrySasUrl.startsWith('https://')) {
        try {
          const taskScript = path.join(payload.workspacePath, '.claude', 'scripts', 'install-telemetry-task.bat');
          const taskScriptExists = await fs.access(taskScript).then(() => true).catch(() => false);
          if (taskScriptExists) {
            await new Promise<void>((resolve) => {
              const child = spawn('cmd.exe', ['/c', taskScript, payload.workspacePath], { shell: false });
              let out = '';
              child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
              child.stderr?.on('data', (b: Buffer) => { out += b.toString(); });
              child.on('close', (code) => {
                emit('step', code === 0
                  ? 'Scheduled task registered — telemetry uploads every 4 h ✓'
                  : `Scheduled task registration returned code ${code} (telemetry will still upload via Dashboard)`,
                  code === 0 ? 'info' : 'warn');
                resolve();
              });
              child.on('error', () => {
                emit('step', 'Could not register scheduled task — telemetry uploads via Dashboard only', 'warn');
                resolve();
              });
            });
          } else {
            emit('step', 'install-telemetry-task.bat not in workspace yet — skipping scheduled task', 'warn');
          }
        } catch (err) {
          emit('step', `Scheduled task registration error: ${(err as Error).message}`, 'warn');
        }
      }

      emit('phase', 'Phase 5 — Complete');
      emit('step', `Role: ${claudeRole}`);
      emit('step', `Workspace: ${payload.workspacePath}`);
      emit('step', 'Open Claude Code in this workspace and type /<role>-mode to activate');

      return { ok: true, exitCode: 0, message: 'Workspace fully configured.', eventCount: 20 };

    } catch (err) {
      emit('step', `Setup error: ${(err as Error).message}`, 'error');
      return { ok: false, exitCode: 1, message: (err as Error).message, eventCount: 0 };
    }
  });

  // ── Framework state for the Dashboard ────────────────────────────────
  ipcMain.handle('framework:last-review', async (_e, workspacePath: string) => {
    const reviewDir = path.join(workspacePath, '.claude-projects', 'framework-reviews');
    try {
      const files = await fs.readdir(reviewDir);
      const reports = files.filter((f) => f.endsWith('.md')).sort().reverse();
      if (reports.length === 0) return { ok: true, data: null };

      const latest = reports[0];
      const content = await fs.readFile(path.join(reviewDir, latest), 'utf-8');

      // Regexes matched against the ACTUAL template in
      // harness/commands/ops/framework-review.md "Output format" (fenced,
      // plain text — no pipe-delimited fields, no bold markers). Previous
      // versions of these regexes expected `Framework health […] | 🟢` and
      // `**Generated:**` / `**Next review…**`, which the skill has never
      // emitted — the health card showed "Unknown" even after a successful
      // review. Keep this block and the template in the .md in sync; a unit
      // test pins the two together (dashboard/src/lib — see PR notes).
      const healthMatch  = content.match(/Framework health:\s*\[?\s*(🟢|🟡|🔴|Green|Amber|Red)/);
      const dateMatch    = content.match(/^Generated:\s*([^\n]+)/m);
      const nextMatch    = content.match(/NEXT REVIEW DATE\s*\n\s*([^\n]+)/);
      const p1Match      = content.match(/P1:\s*(\d+)/);
      const p2Match      = content.match(/P2:\s*(\d+)/);

      const healthRaw    = healthMatch?.[1] ?? 'Unknown';
      const healthText   = healthRaw.includes('🟢') || healthRaw === 'Green'  ? 'Green'
                         : healthRaw.includes('🔴') || healthRaw === 'Red'    ? 'Red'
                         : 'Amber';
      const healthEmoji  = healthText === 'Green' ? '🟢' : healthText === 'Red' ? '🔴' : '🟡';

      return {
        ok: true,
        data: {
          filename:       latest,
          healthEmoji,
          healthText,
          lastReviewDate: dateMatch?.[1]?.trim() ?? 'Unknown',
          nextReviewDate: nextMatch?.[1]?.trim() ?? 'Unknown',
          p1Count:        parseInt(p1Match?.[1] ?? '0', 10),
          p2Count:        parseInt(p2Match?.[1] ?? '0', 10)
        }
      };
    } catch {
      return { ok: true, data: null };
    }
  });

  ipcMain.handle('framework:cost-summary', async (_e, workspacePath: string) => {
    return readCostSummary(workspacePath);
  });

  ipcMain.handle('framework:active-project', async (_e, workspacePath: string) => {
    return readActiveProject(workspacePath);
  });

  // Post-install environment self-check ("doctor") — Node/npx/ADO/Jira/embedded-creds.
  // role gates QA-only checks (Playwright browsers, qa-mode skill presence).
  ipcMain.handle('doctor:run', async (_e, workspacePath: string, role?: string) => {
    return runDoctor(workspacePath, role);
  });

  // ── Connection status — parallel ADO/Atlassian/Figma health check ────
  // Reads stored tokens (keytar for ADO/Figma; settings.local.json env for
  // Atlassian) and hits each provider's "who am I" endpoint. Three-state
  // result so the Dashboard can render colour-coded pills.
  ipcMain.handle('status:check-all', async (_e, workspacePath: string) => {
    const https = require('node:https') as typeof import('node:https');

    // Confirm the azure-devops MCP server actually registered in Claude Code
    // (project-scoped → cwd must be the workspace). A valid PAT does NOT mean the
    // MCP server loaded: if .mcp.json is rejected (e.g. an invalid entry), the
    // server is absent here even with a perfect PAT. This closes the gap that
    // let the pill show green while ADO was dead in-session (RCA 2026-07-06).
    const probeAdoMcpLoaded = (): Promise<boolean | null> => {
      return new Promise((resolve) => {
        const cp = require('node:child_process') as typeof import('node:child_process');
        let out = '';
        let done = false;
        const finish = (v: boolean | null) => { if (!done) { done = true; resolve(v); } };
        try {
          const c = cp.spawn('claude', ['mcp', 'list'], {
            shell: process.platform === 'win32',   // npm/npx/claude are .cmd shims on Windows
            cwd: workspacePath, stdio: ['ignore', 'pipe', 'pipe'],
          });
          const timer = setTimeout(() => { try { c.kill(); } catch { /* gone */ } finish(null); }, 30000);
          c.stdout?.on('data', (b: Buffer) => { out += b.toString('utf-8'); });
          c.stderr?.on('data', (b: Buffer) => { out += b.toString('utf-8'); });
          c.on('error', () => { clearTimeout(timer); finish(null); });   // claude CLI not on PATH
          c.on('close', () => { clearTimeout(timer); finish(/azure-devops/i.test(out)); });
        } catch { finish(null); }
      });
    };

    const doctorConfig = await resolveConfig(workspacePath);

    const probeAdo = async (): Promise<{ state: 'ok' | 'missing' | 'expired'; detail: string }> => {
      let pat: string | null = null;
      try { pat = await getAdoPat(); } catch { /* keytar unavailable */ }
      if (!pat) return { state: 'missing', detail: 'No ADO PAT stored' };
      const scm = getScmProvider(doctorConfig);
      const patResult = await scm.probeConnectivity(pat);
      if (!patResult.ok) return { state: 'expired', detail: patResult.detail };
      // PAT is valid — now the part that actually matters for Claude Code:
      const mcpLoaded = await probeAdoMcpLoaded();
      if (mcpLoaded === true)  return { state: 'ok',      detail: '✓ PAT valid + MCP server registered' };
      if (mcpLoaded === false) return { state: 'expired', detail: '⚠ PAT valid, but azure-devops MCP NOT loaded — check .mcp.json (invalid entry discards the whole file), then restart Claude Code' };
      return { state: 'ok', detail: '✓ PAT valid — MCP registration unverified (claude CLI not on PATH)' };
    };

    const probeAtlassian = async (): Promise<{ state: 'ok' | 'missing' | 'expired'; detail: string }> => {
      if (doctorConfig.platforms.issue_tracker.kind === 'none') {
        return { state: 'missing', detail: 'No issue tracker configured (platforms.issue_tracker.kind = "none")' };
      }
      // Read JIRA_EMAIL / JIRA_API_TOKEN from settings.local.json env
      let email = '';
      let token = '';
      try {
        const raw = await fs.readFile(path.join(workspacePath, '.claude', 'settings.local.json'), 'utf-8');
        const cfg = JSON.parse(raw) as { env?: { JIRA_EMAIL?: string; JIRA_API_TOKEN?: string } };
        email = cfg.env?.JIRA_EMAIL ?? '';
        token = cfg.env?.JIRA_API_TOKEN ?? '';
      } catch { /* settings missing or unreadable */ }
      if (!email || !token) return { state: 'missing', detail: 'No Atlassian credentials in settings.local.json' };
      const tracker = getIssueTrackerProvider(doctorConfig.platforms.issue_tracker);
      const result = await tracker.validateToken(email, token);
      if (result.ok) return { state: 'ok', detail: '✓ Connected' };
      if (result.status === 401 || result.status === 403) return { state: 'expired', detail: `${result.status} — token invalid or expired` };
      return { state: 'expired', detail: result.message };
    };
    // The old inline https.request bodies for both probes above (each
    // hardcoded to one specific ADO org and Atlassian site) are now owned
    // by providers/scm/* and providers/tracker/jira.ts.

    const probeFigma = async (): Promise<{ state: 'ok' | 'missing' | 'expired'; detail: string }> => {
      let pat: string | null = null;
      try { pat = await getFigmaPat(); } catch { /* keytar unavailable */ }
      if (!pat) return { state: 'missing', detail: 'No Figma PAT stored (OAuth via Claude may still work)' };
      return new Promise((resolve) => {
        const req = https.request({
          hostname: 'api.figma.com',
          path: '/v1/me',
          method: 'GET',
          headers: { 'X-Figma-Token': pat, 'Accept': 'application/json' }
        }, (res) => {
          const status = res.statusCode ?? 0;
          res.on('data', () => { /* drain */ });
          res.on('end', () => {
            if (status === 200) resolve({ state: 'ok', detail: '✓ Connected' });
            else if (status === 401 || status === 403) resolve({ state: 'expired', detail: `${status} — token invalid or expired` });
            else resolve({ state: 'expired', detail: `HTTP ${status}` });
          });
        });
        req.on('error', (err: Error) => resolve({ state: 'expired', detail: err.message }));
        req.end();
      });
    };

    const [ado, atlassian, figma] = await Promise.all([probeAdo(), probeAtlassian(), probeFigma()]);
    return { ado, atlassian, figma, checkedAt: new Date().toISOString() };
  });

  // ── Launch Claude Code from the Dashboard / Done screen ──────────────
  // `initialPrompt` is the exact slash command to start the session with
  // (e.g. "/arch-mode" for a role launcher, "/ops/framework-review" for a
  // specific skill) — the renderer decides what to send, this just launches.
  ipcMain.handle('claude:launch', async (_e, workspacePath: string, initialPrompt: string) => {
    return launchClaude(workspacePath, initialPrompt);
  });

  // ── Repo branch list (local + remote, deduped) ───────────────────────
  // Returns names with origin/ prefix stripped. Reads `git branch -a` so the
  // dashboard can populate a typeahead without a fresh fetch (which would
  // need the PAT). If the user wants newer branches they can hit Refresh.
  ipcMain.handle('repo:list-branches', async (_e, repoPath: string) => {
    return new Promise<{ ok: boolean; current: string; branches: string[]; message: string }>((resolve) => {
      const child = spawn('git', ['-C', repoPath, 'branch', '-a', '--format=%(refname:short)'], { shell: false });
      let out = ''; let err = '';
      child.stdout.on('data', (c: Buffer) => { out += c.toString('utf-8'); });
      child.stderr.on('data', (c: Buffer) => { err += c.toString('utf-8'); });
      child.on('error', (e: Error) => resolve({ ok: false, current: '', branches: [], message: e.message }));
      child.on('close', (code) => {
        if (code !== 0) { resolve({ ok: false, current: '', branches: [], message: err.trim() || `git exit ${code}` }); return; }
        const names = new Set<string>();
        for (const raw of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
          if (raw.startsWith('origin/HEAD')) continue;
          names.add(raw.replace(/^origin\//, ''));
        }
        // Current branch
        const cur = spawn('git', ['-C', repoPath, 'branch', '--show-current'], { shell: false });
        let cOut = '';
        cur.stdout.on('data', (c: Buffer) => { cOut += c.toString('utf-8'); });
        cur.on('close', () => {
          resolve({ ok: true, current: cOut.trim(), branches: [...names].sort(), message: `${names.size} branches` });
        });
      });
    });
  });

  // ── Repo sync-branches — expand refs from origin ─────────────────────
  // For existing clones that were originally fetched with --single-branch,
  // running `remote set-branches origin "*"` + `fetch --no-tags` adds all
  // remote branch refs locally so `git checkout <any-branch>` works.
  // No history is pulled for non-active branches until the user checks out.
  ipcMain.handle('repo:sync-branches', async (_e, repoPath: string) => {
    // Fixed in the 2.4.1 pre-ship audit: this spawned git with no PAT and no
    // GIT_TERMINAL_PROMPT=0, unlike clone-repo's authEnv()-backed spawns. On
    // a machine with no credential helper configured, `git fetch` here could
    // hang on an interactive credential prompt or fail with no useful error.
    let pat: string | null = null;
    try { pat = await getAdoPat(); } catch { /* keytar unavailable */ }
    const gitEnv = pat ? authEnv(pat) : { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    const runGit = (args: string[]): Promise<{ code: number | null; out: string }> => {
      return new Promise((resolve) => {
        const c = spawn('git', ['-C', repoPath, ...args], { shell: false, env: gitEnv });
        let o = '';
        c.stdout.on('data', (b: Buffer) => { o += b.toString('utf-8'); });
        c.stderr.on('data', (b: Buffer) => { o += b.toString('utf-8'); });
        c.on('error', (e: Error) => resolve({ code: -1, out: e.message }));
        c.on('close', (code) => resolve({ code, out: o }));
      });
    };
    let log = '';
    const set = await runGit(['remote', 'set-branches', 'origin', '*']);
    log += `[set-branches]\n${set.out}\n`;
    if (set.code !== 0) return { ok: false, message: `set-branches failed: ${log}`, branchesAdded: 0 };
    const fetch = await runGit(['fetch', 'origin', '--no-tags', '--prune']);
    log += `[fetch]\n${fetch.out}\n`;
    if (fetch.code !== 0) return { ok: false, message: `fetch failed: ${log}`, branchesAdded: 0 };
    // Count branches now visible
    const list = await runGit(['branch', '-a', '--format=%(refname:short)']);
    const total = list.out.split('\n').filter((l) => l.trim() && !l.includes('HEAD')).length;
    return { ok: true, message: `Synced. ${total} branches visible locally.`, branchesAdded: total };
  });

  // ── Repo branch checkout ─────────────────────────────────────────────
  // Safety: refuses to checkout if there are uncommitted changes UNLESS
  // stashIfDirty=true (which runs `git stash push -u` first). Streams the
  // git output back as a single string so the UI can show it.
  ipcMain.handle('repo:checkout-branch', async (_e, repoPath: string, branch: string, stashIfDirty: boolean) => {
    // Same fix as repo:sync-branches — PAT + GIT_TERMINAL_PROMPT=0 so
    // `git fetch` here can't hang or silently fail on a machine with no
    // credential helper configured.
    let pat: string | null = null;
    try { pat = await getAdoPat(); } catch { /* keytar unavailable */ }
    const gitEnv = pat ? authEnv(pat) : { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    const runGit = (args: string[]): Promise<{ code: number | null; out: string }> => {
      return new Promise((resolve) => {
        const c = spawn('git', ['-C', repoPath, ...args], { shell: false, env: gitEnv });
        let o = '';
        c.stdout.on('data', (b: Buffer) => { o += b.toString('utf-8'); });
        c.stderr.on('data', (b: Buffer) => { o += b.toString('utf-8'); });
        c.on('error', (e: Error) => resolve({ code: -1, out: e.message }));
        c.on('close', (code) => resolve({ code, out: o }));
      });
    };

    const status = await runGit(['status', '--porcelain']);
    const dirty = status.out.trim().length > 0;
    if (dirty && !stashIfDirty) {
      return { ok: false, dirty: true, message: 'Working tree has uncommitted changes. Stash or commit first.' };
    }
    let log = '';
    if (dirty) {
      const stash = await runGit(['stash', 'push', '-u', '-m', `titan pre-checkout ${branch}`]);
      log += `[stash]\n${stash.out}\n`;
      if (stash.code !== 0) return { ok: false, dirty: true, message: `Stash failed:\n${log}` };
    }
    const fetch = await runGit(['fetch', 'origin', branch]);
    log += `[fetch]\n${fetch.out}\n`;
    const checkout = await runGit(['checkout', branch]);
    log += `[checkout]\n${checkout.out}\n`;
    if (checkout.code !== 0) return { ok: false, dirty: false, message: log };
    return { ok: true, dirty: false, message: log };
  });

  // ── Telemetry — Phase 2 central upload ───────────────────────────────
  ipcMain.handle('telemetry:get-summary', async (_e, workspacePath: string) => {
    return readLocalSummary(workspacePath);
  });

  ipcMain.handle('telemetry:get-status', async (_e, workspacePath: string) => {
    const cfg = await readConfig(workspacePath);
    // Single source of truth = settings.local.json (TITAN_PHASE2 v2.4.3).
    // Same file + same env key the scheduled-task uploader already reads, so
    // editing it ANYWHERE (this Dashboard, TelemetrySetup, or by hand) is one
    // change that both consumers see. Keytar is checked only as a fallback for
    // installs from before this change that have a keytar value but nothing
    // in settings.local.json yet.
    let sasUrlForCheck: string | null = await readLocalSasUrl(workspacePath);
    if (!sasUrlForCheck) {
      try { sasUrlForCheck = await getTelemetrySasUrl(); } catch { /* keytar unavailable */ }
    }
    const hasUserSas = !!sasUrlForCheck;

    // Container-name check (2.4.1 fix) — see EXPECTED_TELEMETRY_CONTAINER's
    // comment in telemetry-uploader.ts for why this can only warn, not
    // definitively confirm a match with the dashboard's actual read SAS.
    const configuredContainer = sasUrlForCheck ? parseContainerFromSasUrl(sasUrlForCheck) : null;
    const containerMismatch = configuredContainer !== null && configuredContainer !== EXPECTED_TELEMETRY_CONTAINER;

    // First-sight auto-enable (2.4.1 fix): TelemetrySetup.tsx presents
    // telemetry as mandatory during onboarding, so a completed install has a
    // SAS configured. Auto-enable it the first time this is checked — but
    // ONLY if the user has never explicitly touched the toggle, so an
    // explicit "Disable upload" is never silently reverted. Replaces the old
    // path gated on a maintainer-baked "default SAS" that could never exist
    // (SAS lives only in keytar/settings.local.json, by design) and so could
    // never auto-enable anything.
    let effectiveEnabled = cfg.enabled;
    if (!cfg.enabledExplicitlySet && hasUserSas && !cfg.enabled) {
      cfg.enabled = true;
      effectiveEnabled = true;
      await writeConfig(workspacePath, cfg);
    }

    // Passive expiry surfacing. Installs made before onboarding verified the
    // SAS — and any install whose SAS expired after it was entered — have no
    // way to learn about it except lastUploadResult.lastError, which is a raw
    // Azure XML blob nobody reads. Compare se= against now so the Dashboard
    // can state it plainly.
    const sasExpiry = sasUrlForCheck ? parseSasExpiry(sasUrlForCheck) : null;
    const sasExpiresAt = sasExpiry ? sasExpiry.toISOString() : null;
    const sasExpired = sasExpiry !== null && sasExpiry.getTime() <= Date.now();

    return {
      enabled: effectiveEnabled,
      hasSasUrl: hasUserSas,
      configuredContainer,
      containerMismatch,
      expectedContainer: EXPECTED_TELEMETRY_CONTAINER,
      sasExpiresAt,
      sasExpired,
      lastUploadAt: cfg.lastUploadAt,
      lastUploadResult: cfg.lastUploadResult,
      userHash: computeUserHash((await resolveConfig(workspacePath)).telemetry.salt),
    };
  });

  ipcMain.handle('telemetry:set-enabled', async (_e, workspacePath: string, enabled: boolean) => {
    const cfg = await readConfig(workspacePath);
    cfg.enabled = enabled;
    cfg.enabledExplicitlySet = true;
    await writeConfig(workspacePath, cfg);
    return { ok: true };
  });

  // Writes to settings.local.json — the SAME file + env key the scheduled-task
  // uploader (harness/scripts/telemetry-upload.js) reads. This is what makes
  // "edit in one place, both consumers see it" true: no separate keytar write
  // for new values, so the two stores can no longer drift apart. Clearing
  // removes it from both (belt-and-suspenders — a stale keytar leftover from
  // before this change should not resurface once the user has cleared it).
  // Onboarding gate: prove the pasted SAS actually works by writing a real
  // registration blob under the user's real hashed id, before the install is
  // allowed to finish. Format validation alone let an expired or read-only SAS
  // through, producing an install that 403'd silently on every upload forever.
  ipcMain.handle('telemetry:verify-sas', async (_e, sasUrl: string, role: string) => {
    try {
      return await verifySasWithRegistration(sasUrl, role);
    } catch (err) {
      return { ok: false, userHash: '', error: (err as Error).message };
    }
  });

  ipcMain.handle('telemetry:set-sas-url', async (_e, workspacePath: string, url: string) => {
    try {
      if (!url) {
        await writeLocalSasUrl(workspacePath, null);
        try { await clearTelemetrySasUrl(); } catch { /* keytar unavailable — fine */ }
        return { ok: true, message: 'SAS URL cleared.' };
      }
      // Same gate as onboarding. An already-installed user updating their SAS
      // here (e.g. after a rotation) previously got no validation at all, so a
      // pasted expired or read-only URL was saved happily and then 403'd on
      // every scheduled upload with nothing surfaced. Verify before persisting
      // so a bad paste can never become the saved value.
      const verified = await verifySasWithRegistration(url, await readLocalRole(workspacePath), (await resolveConfig(workspacePath)).telemetry.salt);
      if (!verified.ok) {
        return { ok: false, message: `Not saved — ${verified.error ?? 'verification failed.'}` };
      }
      await writeLocalSasUrl(workspacePath, url);
      return { ok: true, message: `Verified and saved — a registration event was uploaded under your ID ${verified.userHash}. Used by this Dashboard AND the scheduled upload task.` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  ipcMain.handle('telemetry:upload-now', async (_e, workspacePath: string) => {
    // Selected by config.telemetry.upload.kind — default is "none" (no
    // egress), so an adopter who never configured a sink gets a clean no-op
    // here instead of an implicit Azure Blob upload firing.
    const titanConfig = await resolveConfig(workspacePath);
    if (titanConfig.telemetry.upload.kind === 'none') {
      return getTelemetrySink(titanConfig).upload(workspacePath);
    }
    const cfg = await readConfig(workspacePath);
    if (!cfg.enabled) {
      return { ok: false, filesUploaded: 0, bytesUploaded: 0, lastError: 'Telemetry upload is disabled. Toggle it on first.', uploadedAt: new Date().toISOString() };
    }
    // Resolve effective SAS: settings.local.json (single source of truth,
    // same file the scheduled task reads) > legacy keytar value. There is no
    // pricing.json fallback — SAS is never baked into that file (security:
    // it lives only in keytar/settings.local.json), so that branch could
    // never fire and was removed in the 2.4.1 pre-ship audit.
    let sas: string | null = await readLocalSasUrl(workspacePath);
    if (!sas) {
      try { sas = await getTelemetrySasUrl(); } catch { /* keytar unavailable */ }
    }
    if (!sas) {
      return { ok: false, filesUploaded: 0, bytesUploaded: 0, lastError: 'No SAS URL configured. Paste one in the Usage tab.', uploadedAt: new Date().toISOString() };
    }
    const userHash = computeUserHash(titanConfig.telemetry.salt);
    const result = await uploadBatch(workspacePath, sas, userHash);
    cfg.lastUploadAt = result.uploadedAt;
    cfg.lastUploadResult = result;
    await writeConfig(workspacePath, cfg);
    return result;
  });

  ipcMain.handle('telemetry:purge-local', async (_e, workspacePath: string) => {
    const r = await purgeLocal(workspacePath);
    return { ok: r.errors === 0, ...r };
  });

  // ── Cost rollup — reads _cost_estimate events for Dashboard widget ────
  ipcMain.handle('cost:get-rollup', async (_e, workspacePath: string, sessionId: string) => {
    return readCostRollup(workspacePath, sessionId || '');
  });

}

/** Telemetry SAS single source of truth (SLING-PHASE2 v2.4.3). Reads/writes
 *  the SAME <workspace>/.claude/settings.local.json env key
 *  (TITAN_TELEMETRY_SAS_URL) that harness/scripts/telemetry-upload.js
 *  already reads for the scheduled task. Before this, the Dashboard's own
 *  uploader read a SEPARATE keytar-stored value that could silently drift
 *  from the one actually in use — editing the SAS anywhere now updates the
 *  one file both consumers read, so it can no longer go out of sync. This
 *  token is a shared team-wide write-only upload credential distributed to
 *  every pilot user via Confluence/Teams (see TelemetrySetup.tsx) — it was
 *  never a secretive per-user value, so keytar's isolation added no real
 *  protection over the plaintext copy the scheduled task already required. */
/** Role recorded for this workspace, for tagging the registration event.
 *  Best-effort only — the event's value is the proof of upload, not the role. */
async function readLocalRole(workspacePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, '.claude', 'settings.local.json'), 'utf-8');
    const cfg = JSON.parse(raw) as { env?: Record<string, unknown> };
    const v = cfg.env?.CLAUDE_ROLE;
    return typeof v === 'string' && v ? v : 'developer';
  } catch {
    return 'developer';
  }
}

async function readLocalSasUrl(workspacePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, '.claude', 'settings.local.json'), 'utf-8');
    const cfg = JSON.parse(raw) as { env?: Record<string, unknown> };
    const v = cfg.env?.TITAN_TELEMETRY_SAS_URL;
    return typeof v === 'string' && v.startsWith('https://') ? v : null;
  } catch {
    return null;
  }
}

async function writeLocalSasUrl(workspacePath: string, url: string | null): Promise<void> {
  const claudeDir = path.join(workspacePath, '.claude');
  await fs.mkdir(claudeDir, { recursive: true });
  const localPath = path.join(claudeDir, 'settings.local.json');
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await fs.readFile(localPath, 'utf-8')) as Record<string, unknown>; } catch { /* first run */ }
  const env = { ...((existing.env as Record<string, unknown>) ?? {}) };
  if (url) env.TITAN_TELEMETRY_SAS_URL = url;
  else delete env.TITAN_TELEMETRY_SAS_URL;
  const next = { ...existing, env };
  await fs.writeFile(localPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
}

/** Small helper for prereqs:detect — runs `<cmd> <args>` and returns
 *  whether it succeeded plus the first stdout/stderr line as the version
 *  string. */
function detectCmd(cmd: string, args: string[]): Promise<{ name: string; detected: boolean; version: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf-8'); });
    child.stderr.on('data', (c: Buffer) => { out += c.toString('utf-8'); });
    child.on('error',  () => resolve({ name: cmd, detected: false, version: '' }));
    child.on('close', (code) => {
      const first = (out.split('\n')[0] || '').trim();
      resolve({ name: cmd, detected: code === 0, version: first });
    });
  });
}
