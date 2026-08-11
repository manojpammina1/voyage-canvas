import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Preload — bridges the sandboxed renderer to the Node-privileged main
// process via a typed, restricted surface.
//
// Two patterns:
//   1. Request/response (.invoke / .handle):
//        const r = await window.api.token.testAdo(pat);
//   2. Event subscription (.on / webContents.send):
//        const off = window.api.installer.onEvent((evt) => ...);
//        ...
//        off();   // unsubscribe before unmount

// Types — duplicated from the renderer's src/global.d.ts. Keeping them
// here means preload is self-contained and doesn't reach into src/.

export type ClaudeMode =
  | 'po-mode'
  | 'dev-mode'
  | 'lead-review'
  | 'arch-mode'
  | 'grill-me'
  | 'qa-mode'
  | 'security-mode'
  | 'sre-mode'
  | 'designer-mode'
  | 'prodsupport-mode';

export interface CloneRepoSpec {
  repoName: string;
  branch: string;
  targetPath: string;
}

export interface IpcResult<T = unknown> {
  ok: boolean;
  message?: string;
  data?: T;
}

export interface InstallEvent {
  protocol: string;
  phase: string;
  progress: number;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface CloneEvent {
  repoName: string;
  status: 'queued' | 'cloning' | 'done' | 'failed';
  message?: string;
}

export interface AdoTestResult {
  ok: boolean;
  status: number;
  message: string;
  testedAt: string;
}

export interface PrereqCheckEntry {
  name: string;
  detected: boolean;
  version: string;
}

// Live progress from prereqs:detect — one 'result' event per tool as its real
// child_process spawn resolves, so the UI can render an honest running log
// instead of a single opaque "Detecting tools…" line.
export type PrereqDetectEvent =
  | { phase: 'start'; total: number }
  | { phase: 'result'; name: string; result: PrereqCheckEntry }
  | { phase: 'done' };

export interface CostSummary {
  totalUsd: number;
  byModel: { model: string; usd: number; percent: number }[];
  byMode:  { mode:  string; usd: number; percent: number }[];
  budgetUsd: number | null;
  utilization: number | null;
  alertLevel: 'OK' | 'INFO' | 'WARNING' | 'CRITICAL' | 'HARD_STOP' | 'UNKNOWN';
}

export interface ActiveProject {
  projectId: string | null;
  activatedAt: string | null;
}

export interface LastReviewData {
  filename:       string;
  healthEmoji:    string;
  healthText:     'Green' | 'Amber' | 'Red';
  lastReviewDate: string;
  nextReviewDate: string;
  p1Count:        number;
  p2Count:        number;
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}
export interface DoctorReport {
  checks: DoctorCheck[];
  ranAt: string;
  ok: boolean;
}

/** Helper to wire an event subscription with a guaranteed unsubscribe.
 *  Returns the unsubscribe function — callers should invoke it on cleanup
 *  (e.g. React useEffect's return). */
function onChannel<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Minimal shape of titan.config.json needed by the renderer. Kept in sync by
// hand with electron/titan-config.ts's TitanConfig — this file stays
// self-contained (see the header note above) rather than importing it.
export interface TitanConfigRepo {
  id: string;
  dir: string;
  display: string;
  kind: string;
  role_in_stack?: string[];
  branches?: { base?: string; release_pattern?: string };
}
export interface TitanConfigRoleDefinition {
  hidden?: boolean;
  default_mode?: string;
}
export interface TitanConfigForRenderer {
  configured: boolean;
  org: { name: string; short_name: string; display_name: string; email_domain: string; harness_brand: string };
  contacts?: { people: Record<string, { name: string; email?: string }> };
  repos: TitanConfigRepo[];
  roles: { governance_owner: string; definitions: Record<string, TitanConfigRoleDefinition> };
  platforms: {
    scm: { kind: 'azure-devops' | 'github'; base_url?: string; collection?: string; pat_url?: string };
    issue_tracker: { kind: 'jira' | 'none'; site?: string; ticket_regex?: string };
  };
  telemetry: { salt: string; enabled: boolean; upload: { kind: 'none' | 'azure-blob' } };
  branding?: { logo_path: string; product_name: string; accent: string };
}

contextBridge.exposeInMainWorld('api', {
  app: {
    getVersion:   () => ipcRenderer.invoke('app:get-version')    as Promise<string>,
    resetWizard:  () => ipcRenderer.invoke('app:reset-wizard')   as Promise<{ ok: boolean; message?: string }>,
  },
  config: {
    // workspacePath is optional — screens that run before a workspace is
    // chosen get the bundled harness's titan.config.json (see
    // titan-config.ts:resolveTitanConfigPath).
    getTitan: (workspacePath?: string) =>
      ipcRenderer.invoke('config:get-titan', workspacePath) as Promise<TitanConfigForRenderer>,
    saveTitan: (workspacePath: string, patch: Partial<TitanConfigForRenderer>) =>
      ipcRenderer.invoke('config:save-titan', workspacePath, patch) as Promise<{ ok: boolean; message?: string }>,
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>
  },
  dialog: {
    pickFolder: (defaultPath?: string) =>
      ipcRenderer.invoke('dialog:pick-folder', defaultPath) as Promise<IpcResult<{ folderPath: string }>>
  },
  fs: {
    freeSpace: (folderPath: string) =>
      ipcRenderer.invoke('fs:free-space', folderPath) as Promise<IpcResult<{ freeBytes: number; totalBytes: number }>>
  },
  prereqs: {
    detect: (role?: string) => ipcRenderer.invoke('prereqs:detect', role) as Promise<IpcResult<{ checks: PrereqCheckEntry[] }>>,
    wingetAvailable: () => ipcRenderer.invoke('prereqs:winget-available') as Promise<{ available: boolean }>,
    install: (name: string) =>
      ipcRenderer.invoke('prereqs:install', name) as Promise<{ ok: boolean; message: string; needsRestart: boolean }>,
    onInstallEvent: (cb: (evt: { name: string; line: string }) => void) =>
      onChannel<{ name: string; line: string }>('prereqs:install-event', cb),
    onDetectEvent: (cb: (evt: PrereqDetectEvent) => void) =>
      onChannel<PrereqDetectEvent>('prereqs:detect-event', cb),
  },
  token: {
    testAdo:         (pat: string, workspacePath?: string) => ipcRenderer.invoke('token:test-ado',  pat, workspacePath)         as Promise<AdoTestResult>,
    storeAdo:        (pat: string)                   => ipcRenderer.invoke('token:store-ado',        pat)          as Promise<IpcResult>,
    hasAdo:          ()                              => ipcRenderer.invoke('token:has-ado')                        as Promise<IpcResult>,
    clearAdo:        ()                              => ipcRenderer.invoke('token:clear-ado')                      as Promise<IpcResult>,
    testJira:        (email: string, token: string, workspacePath?: string) => ipcRenderer.invoke('token:test-jira', email, token, workspacePath) as Promise<{ ok: boolean; status: number; message: string }>,
    testFigma:       (pat: string)                   => ipcRenderer.invoke('token:test-figma',       pat)          as Promise<{ ok: boolean; status: number; message: string }>,
    storeFigma:      (pat: string)                   => ipcRenderer.invoke('token:store-figma',      pat)          as Promise<IpcResult>,
    hasFigma:        ()                              => ipcRenderer.invoke('token:has-figma')                      as Promise<IpcResult>,
    clearFigma:      ()                              => ipcRenderer.invoke('token:clear-figma')                    as Promise<IpcResult>,
  },
  ado: {
    listReleaseBranches: (repoName: string, pat: string, workspacePath?: string) =>
      ipcRenderer.invoke('ado:list-release-branches', repoName, pat, workspacePath) as Promise<{ ok: boolean; branches: string[]; message: string }>
  },
  clone: {
    start: (inputs: CloneRepoSpec[]) =>
      ipcRenderer.invoke('clone:start', inputs) as Promise<IpcResult<{ succeeded: string[]; failed: { repoName: string; message: string }[] }>>,
    retry: (input: CloneRepoSpec) =>
      ipcRenderer.invoke('clone:retry', input) as Promise<{ ok: boolean; message: string }>,
    onEvent: (cb: (evt: CloneEvent) => void) => onChannel<CloneEvent>('clone:event', cb)
  },
  setup: {
    runNative: (payload: { role: string; workspacePath: string; adoPat: string; jiraEmail?: string; jiraToken?: string; telemetrySasUrl?: string; displayName?: string }) =>
      ipcRenderer.invoke('setup:run-native', payload) as Promise<{ ok: boolean; exitCode: number | null; message: string; eventCount: number }>
  },
  installer: {
    // `run` (spawned Python install.py) removed in the 2.4.1 pre-ship audit
    // de-complication pass — nothing called it; InstallProgress.tsx uses
    // setup.runNative instead. onEvent stays: setup:run-native (main.ts)
    // reuses this SAME 'installer:event' channel/shape for its own progress
    // stream, so this listener is very much still live.
    onEvent: (cb: (evt: InstallEvent) => void) => onChannel<InstallEvent>('installer:event', cb)
  },
  framework: {
    costSummary:   (workspacePath: string) => ipcRenderer.invoke('framework:cost-summary',   workspacePath) as Promise<CostSummary>,
    activeProject: (workspacePath: string) => ipcRenderer.invoke('framework:active-project', workspacePath) as Promise<ActiveProject>,
    lastReview:    (workspacePath: string) => ipcRenderer.invoke('framework:last-review',    workspacePath) as Promise<IpcResult<LastReviewData>>
  },
  claude: {
    // initialPrompt is the exact slash command the new session should start
    // with — "/arch-mode" (a ClaudeMode value) for the role launchers, or an
    // exact skill command like "/ops/framework-review" for a specific skill.
    // Not typed as ClaudeMode: forcing framework-review's real command into
    // that union would be a lie (see electron/claude-launcher.ts header).
    launch: (workspacePath: string, initialPrompt: string) =>
      ipcRenderer.invoke('claude:launch', workspacePath, initialPrompt) as Promise<IpcResult>
  },
  repo: {
    listBranches: (repoPath: string) =>
      ipcRenderer.invoke('repo:list-branches', repoPath) as Promise<{ ok: boolean; current: string; branches: string[]; message: string }>,
    checkoutBranch: (repoPath: string, branch: string, stashIfDirty: boolean) =>
      ipcRenderer.invoke('repo:checkout-branch', repoPath, branch, stashIfDirty) as Promise<{ ok: boolean; dirty: boolean; message: string }>,
    syncBranches: (repoPath: string) =>
      ipcRenderer.invoke('repo:sync-branches', repoPath) as Promise<{ ok: boolean; message: string; branchesAdded: number }>
  },
  doctor: {
    run: (workspacePath: string, role?: string) =>
      ipcRenderer.invoke('doctor:run', workspacePath, role) as Promise<DoctorReport>
  },
  status: {
    checkAll: (workspacePath: string) =>
      ipcRenderer.invoke('status:check-all', workspacePath) as Promise<{
        ado:       { state: 'ok' | 'missing' | 'expired'; detail: string };
        atlassian: { state: 'ok' | 'missing' | 'expired'; detail: string };
        figma:     { state: 'ok' | 'missing' | 'expired'; detail: string };
        checkedAt: string;
      }>
  },
  telemetry: {
    getSummary: (workspacePath: string) =>
      ipcRenderer.invoke('telemetry:get-summary', workspacePath) as Promise<{
        totalEvents: number;
        unUploadedFiles: number;
        oldestUnUploadedDate: string | null;
        newestUnUploadedDate: string | null;
        byMode: Record<string, number>;
        bySkill: Record<string, number>;
        byBashProgram: Record<string, number>;
        byTool: Record<string, number>;
        sessions: number;
      }>,
    getStatus: (workspacePath: string) =>
      ipcRenderer.invoke('telemetry:get-status', workspacePath) as Promise<{
        enabled: boolean;
        hasSasUrl: boolean;
        hasUserSas: boolean;
        hasDefaultSas: boolean;
        userCanOverride: boolean;
        lastUploadAt: string | null;
        lastUploadResult: { ok: boolean; filesUploaded: number; bytesUploaded: number; lastError: string | null; uploadedAt: string } | null;
        userHash: string;
      }>,
    setEnabled: (workspacePath: string, enabled: boolean) =>
      ipcRenderer.invoke('telemetry:set-enabled', workspacePath, enabled) as Promise<{ ok: boolean }>,
    setSasUrl: (workspacePath: string, url: string) =>
      ipcRenderer.invoke('telemetry:set-sas-url', workspacePath, url) as Promise<{ ok: boolean; message: string }>,
    verifySas: (sasUrl: string, role: string) =>
      ipcRenderer.invoke('telemetry:verify-sas', sasUrl, role) as Promise<{ ok: boolean; userHash: string; blobPath?: string; error?: string }>,
    uploadNow: (workspacePath: string) =>
      ipcRenderer.invoke('telemetry:upload-now', workspacePath) as Promise<{ ok: boolean; filesUploaded: number; bytesUploaded: number; lastError: string | null; uploadedAt: string }>,
    purgeLocal: (workspacePath: string) =>
      ipcRenderer.invoke('telemetry:purge-local', workspacePath) as Promise<{ ok: boolean; deleted: number; errors: number }>
  },
  cost: {
    getRollup: (workspacePath: string, sessionId: string) =>
      ipcRenderer.invoke('cost:get-rollup', workspacePath, sessionId) as Promise<{
        today: { estimates: number; estMinUsd: number; estMaxUsd: number; redirects: number };
        thisSession: { estimates: number; estMinUsd: number; estMaxUsd: number };
        last7Days: { estimates: number; estMinUsd: number; estMaxUsd: number; redirects: number; estimatedSavingsUsd: number };
        byClass: Record<string, { count: number; estMidUsd: number }>;
        byModel: Record<string, { count: number; estMidUsd: number }>;
      }>
  }
});
