// Global TypeScript declaration of the window.api surface exposed by
// electron/preload.ts. Renderer code reads from this; preload writes to it.

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

// Mirrors electron/preload.ts PrereqDetectEvent — live progress from a real
// prereqs:detect run, one 'result' event per tool as its child_process
// spawn actually resolves (not simulated/staggered).
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

export interface NativeSetupResult {
  ok: boolean;
  exitCode: number | null;
  message: string;
  eventCount: number;
}

// Titan config — mirrors electron/preload.ts's TitanConfigForRenderer.
// Everything CloneRepos/RolePicker/AtlassianSetup/TelemetrySetup/ConfigEditor
// need to render/edit without hand-editing titan.config.json.
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

export interface TitanApi {
  app: {
    getVersion(): Promise<string>;
    resetWizard(): Promise<{ ok: boolean; message?: string }>;
  };
  config: {
    getTitan(workspacePath?: string): Promise<TitanConfigForRenderer>;
    saveTitan(workspacePath: string, patch: Partial<TitanConfigForRenderer>): Promise<{ ok: boolean; message?: string }>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  dialog: {
    pickFolder(defaultPath?: string): Promise<IpcResult<{ folderPath: string }>>;
  };
  fs: {
    freeSpace(folderPath: string): Promise<IpcResult<{ freeBytes: number; totalBytes: number }>>;
  };
  prereqs: {
    detect(role?: string): Promise<IpcResult<{ checks: PrereqCheckEntry[] }>>;
    wingetAvailable(): Promise<{ available: boolean }>;
    install(name: string): Promise<{ ok: boolean; message: string; needsRestart: boolean }>;
    onInstallEvent(cb: (evt: { name: string; line: string }) => void): () => void;
    onDetectEvent(cb: (evt: PrereqDetectEvent) => void): () => void;
  };
  token: {
    testAdo(pat: string, workspacePath?: string): Promise<AdoTestResult>;
    storeAdo(pat: string):                       Promise<IpcResult>;
    hasAdo():                                    Promise<IpcResult>;
    clearAdo():                                  Promise<IpcResult>;
    testJira(email: string, token: string, workspacePath?: string): Promise<{ ok: boolean; status: number; message: string }>;
    testFigma(pat: string):                      Promise<{ ok: boolean; status: number; message: string }>;
    storeFigma(pat: string):                     Promise<IpcResult>;
    hasFigma():                                  Promise<IpcResult>;
    clearFigma():                                Promise<IpcResult>;
  };
  ado: {
    listReleaseBranches(repoName: string, pat: string, workspacePath?: string): Promise<{ ok: boolean; branches: string[]; message: string }>;
  };
  clone: {
    start(inputs: CloneRepoSpec[]): Promise<IpcResult<{ succeeded: string[]; failed: { repoName: string; message: string }[] }>>;
    retry(input: CloneRepoSpec):    Promise<{ ok: boolean; message: string }>;
    onEvent(cb: (evt: CloneEvent) => void): () => void;
  };
  setup: {
    runNative(payload: { role: string; workspacePath: string; adoPat: string; jiraEmail?: string; jiraToken?: string; telemetrySasUrl?: string; displayName?: string }): Promise<NativeSetupResult>;
  };
  installer: {
    // `run` removed (2.4.1 audit) — nothing called it; see preload.ts's
    // installer.onEvent comment for why onEvent stays.
    onEvent(cb: (evt: InstallEvent) => void): () => void;
  };
  framework: {
    costSummary(workspacePath: string):             Promise<CostSummary>;
    activeProject(workspacePath: string):           Promise<ActiveProject>;
    lastReview(workspacePath: string):              Promise<IpcResult<LastReviewData>>;
  };
  claude: {
    // initialPrompt: exact slash command the launched session starts with —
    // a ClaudeMode value ("/arch-mode") or an exact skill command
    // ("/ops/framework-review"). See electron/claude-launcher.ts header.
    launch(workspacePath: string, initialPrompt: string): Promise<IpcResult>;
  };
  repo: {
    listBranches(repoPath: string): Promise<{ ok: boolean; current: string; branches: string[]; message: string }>;
    checkoutBranch(repoPath: string, branch: string, stashIfDirty: boolean): Promise<{ ok: boolean; dirty: boolean; message: string }>;
    syncBranches(repoPath: string): Promise<{ ok: boolean; message: string; branchesAdded: number }>;
  };
  doctor: {
    run(workspacePath: string, role?: string): Promise<{
      ok: boolean;
      ranAt: string;
      checks: { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string; fix?: string }[];
    }>;
  };
  status: {
    checkAll(workspacePath: string): Promise<{
      ado:       { state: 'ok' | 'missing' | 'expired'; detail: string };
      atlassian: { state: 'ok' | 'missing' | 'expired'; detail: string };
      figma:     { state: 'ok' | 'missing' | 'expired'; detail: string };
      checkedAt: string;
    }>;
  };
  telemetry: {
    getSummary(workspacePath: string): Promise<{
      totalEvents: number;
      unUploadedFiles: number;
      oldestUnUploadedDate: string | null;
      newestUnUploadedDate: string | null;
      byMode: Record<string, number>;
      bySkill: Record<string, number>;
      byBashProgram: Record<string, number>;
      byTool: Record<string, number>;
      sessions: number;
    }>;
    getStatus(workspacePath: string): Promise<{
      enabled: boolean;
      hasSasUrl: boolean;
      // Parsed from the configured SAS URL's path — null if no SAS or unparseable.
      configuredContainer: string | null;
      // True when configuredContainer is set AND doesn't match expectedContainer.
      // Best-effort check only — see telemetry-uploader.ts
      // EXPECTED_TELEMETRY_CONTAINER for why this can't be a definitive
      // cross-process assertion against the dashboard's actual read SAS.
      containerMismatch: boolean;
      expectedContainer: string;
      sasExpiresAt: string | null;
      sasExpired: boolean;
      lastUploadAt: string | null;
      lastUploadResult: { ok: boolean; filesUploaded: number; bytesUploaded: number; lastError: string | null; uploadedAt: string } | null;
      userHash: string;
    }>;
    setEnabled(workspacePath: string, enabled: boolean): Promise<{ ok: boolean }>;
    setSasUrl(workspacePath: string, url: string): Promise<{ ok: boolean; message: string }>;
    verifySas(sasUrl: string, role: string): Promise<{ ok: boolean; userHash: string; blobPath?: string; error?: string }>;
    uploadNow(workspacePath: string): Promise<{ ok: boolean; filesUploaded: number; bytesUploaded: number; lastError: string | null; uploadedAt: string }>;
    purgeLocal(workspacePath: string): Promise<{ ok: boolean; deleted: number; errors: number }>;
  };
  cost: {
    getRollup(workspacePath: string, sessionId: string): Promise<{
      today: { estimates: number; estMinUsd: number; estMaxUsd: number; redirects: number };
      thisSession: { estimates: number; estMinUsd: number; estMaxUsd: number };
      last7Days: { estimates: number; estMinUsd: number; estMaxUsd: number; redirects: number; estimatedSavingsUsd: number };
      byClass: Record<string, { count: number; estMidUsd: number }>;
      byModel: Record<string, { count: number; estMidUsd: number }>;
    }>;
  };
}

declare global {
  interface Window {
    api: TitanApi;
  }
}

// Vite-style side-effect imports for non-TS asset types. Vite handles the
// runtime; TypeScript just needs to know these import paths are legal.
declare module '*.css';
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}

export {};
