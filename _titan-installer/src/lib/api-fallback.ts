// Browser-only fallback for window.api.
// When the renderer is loaded in a regular browser (e.g. just `npm run dev`
// without `npm run dev:electron`), Electron's preload script never runs and
// window.api stays undefined. Every screen would crash on first effect.
//
// This shim installs a fully-typed no-op / mock api so the wizard remains
// clickable in a browser for visual review. Every method returns a
// "looks-plausible" mock so the UI renders normally.
//
// IMPORTANT: this shim NEVER touches real systems. It can't — browsers
// can't run subprocess, can't access keytar, can't hit the filesystem.

import type { TitanApi, TitanConfigForRenderer } from '../global';

// Mock config — mirrors titan.config.example.json's shape closely enough for
// browser-preview screens (RolePicker/CloneRepos/TelemetrySetup/ConfigEditor)
// to render something plausible without a real Electron main process.
const MOCK_TITAN_CONFIG: TitanConfigForRenderer = {
  configured: true,
  org: { name: 'Mock Org', short_name: 'Mock', display_name: 'Mock Org (browser preview)', email_domain: 'example.com', harness_brand: 'Titan' },
  contacts: { people: { 'toolkit-owner': { name: 'Mock Toolkit Owner', email: 'owner@example.com' } } },
  repos: [
    { id: 'app-core', dir: 'app-core', display: 'App Core', kind: 'generic' },
    { id: 'app-frontend', dir: 'app-frontend', display: 'App Frontend', kind: 'generic' },
  ],
  roles: { governance_owner: 'toolkit-owner', definitions: {} },
  platforms: {
    scm: { kind: 'azure-devops', collection: 'mock-org' },
    issue_tracker: { kind: 'jira', site: 'mock-org.atlassian.net' },
  },
  telemetry: { salt: 'mock-salt', enabled: false, upload: { kind: 'none' } },
  branding: { logo_path: 'assets/titan-mark.svg', product_name: 'Titan', accent: '#2F6FED' },
};

export function installApiFallback(): void {
  if (typeof window === 'undefined') return;
  if (window.api) return;                     // real Electron preload won

  // eslint-disable-next-line no-console
  console.warn(
    '[Titan] window.api missing — installing browser-only mock. ' +
    'Run `npm run dev:electron` for full functionality.'
  );

  const shim: TitanApi = {
    app: {
      getVersion:  async () => '0.1.0-browser-mock',
      resetWizard: async () => {
        localStorage.clear();
        window.location.reload();
        return { ok: true };
      },
    },
    config: {
      getTitan:  async () => MOCK_TITAN_CONFIG,
      saveTitan: async () => ({ ok: true, message: 'Mock save (browser mode) — not persisted.' }),
    },
    shell: {
      openExternal: async (url) => {
        // In a real browser we just window.open it.
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    dialog: {
      pickFolder: async () =>
        ({ ok: true, data: { folderPath: 'C:\\codebase\\ecom-webapp' } })
    },
    fs: {
      freeSpace: async () =>
        ({ ok: true, data: { freeBytes: 50 * 1024 ** 3, totalBytes: 500 * 1024 ** 3 } })
    },
    prereqs: {
      detect: async () => ({
        ok: true,
        data: {
          checks: [
            { name: 'node',   detected: true,  version: 'v20.18.0 (mocked)' },
            { name: 'java',   detected: true,  version: 'openjdk 17 (mocked)' },
            { name: 'python', detected: true,  version: 'Python 3.11 (mocked)' },
            { name: 'git',    detected: true,  version: 'git 2.50.1 (mocked)' },
            { name: 'claude', detected: false, version: '' }
          ]
        }
      }),
      wingetAvailable: async () => ({ available: true }),
      install: async (name) => ({ ok: true, message: `Mock-installed ${name}.`, needsRestart: true }),
      onInstallEvent: () => () => { /* no-op */ },
      onDetectEvent: () => () => { /* no-op */ },
    },
    token: {
      testAdo: async (pat) => {
        if (pat.length < 20) {
          return { ok: false, status: 0, message: 'PAT looks too short (browser mock).', testedAt: new Date().toISOString() };
        }
        return { ok: true, status: 200, message: '✓ Mock validation passed (browser, no real ADO call).', testedAt: new Date().toISOString() };
      },
      storeAdo: async () => ({ ok: true, message: 'Stored in browser memory only (mock).' }),
      hasAdo:   async () => ({ ok: false }),
      clearAdo: async () => ({ ok: true }),
      testJira: async (email, token) => {
        if (!email.includes('@') || token.length < 20) {
          return { ok: false, status: 0, message: 'Email or token looks invalid (browser mock).' };
        }
        return { ok: true, status: 200, message: `✓ Connected as ${email} (browser mock — no real Jira call).` };
      },
      testFigma: async (pat) => {
        if (pat.length < 20) return { ok: false, status: 0, message: 'Figma PAT looks too short (browser mock).' };
        return { ok: true, status: 200, message: '✓ Mock Figma validation passed (browser, no real call).' };
      },
      storeFigma:      async () => ({ ok: true, message: 'Stored in browser memory only (mock).' }),
      hasFigma:        async () => ({ ok: false }),
      clearFigma:      async () => ({ ok: true }),
    },
    ado: {
      listReleaseBranches: async () => ({
        ok: true,
        branches: ['release/R2026-03', 'release/R2026-02', 'release/R2026-01'],
        message: 'Mock branches (browser mode).'
      })
    },
    clone: {
      start: async (specs) => {
        // Simulate clone events on a timer so the UI animates.
        for (const s of specs) {
          window.dispatchEvent(new CustomEvent('mock-clone-event', { detail: { repoName: s.repoName, status: 'cloning' } }));
          await new Promise<void>((r) => setTimeout(r, 600));
          window.dispatchEvent(new CustomEvent('mock-clone-event', { detail: { repoName: s.repoName, status: 'done' } }));
        }
        return { ok: true, data: { succeeded: specs.map((s) => s.repoName), failed: [] } };
      },
      retry: async () => ({ ok: true, message: 'Mock retry.' }),
      onEvent: (cb) => {
        const handler = (e: Event) => cb((e as CustomEvent).detail);
        window.addEventListener('mock-clone-event', handler);
        return () => window.removeEventListener('mock-clone-event', handler);
      }
    },
    installer: {
      // `run` mock removed (2.4.1 audit) along with the real run() bridge —
      // setup.runNative's mock below already dispatches 'mock-install-event',
      // so onEvent's mock here stays fully fed with no separate source needed.
      onEvent: (cb) => {
        const handler = (e: Event) => cb((e as CustomEvent).detail);
        window.addEventListener('mock-install-event', handler);
        return () => window.removeEventListener('mock-install-event', handler);
      }
    },
    framework: {
      lastReview: async () => ({
        ok: true,
        data: {
          filename: '2026-Q2.md',
          healthEmoji: '🟡',
          healthText: 'Amber' as const,
          lastReviewDate: '2026-05-19',
          nextReviewDate: '2026-08-19',
          p1Count: 0,
          p2Count: 9
        }
      }),
      costSummary: async () => ({
        totalUsd: 23.40,
        byModel: [
          { model: 'claude-sonnet-4-6', usd: 18.20, percent: 0.78 },
          { model: 'claude-opus-4-7',   usd:  4.50, percent: 0.19 },
          { model: 'claude-haiku-4-5',  usd:  0.70, percent: 0.03 }
        ],
        byMode: [
          { mode: '/dev-mode',  usd: 14.00, percent: 0.60 },
          { mode: '/arch-mode', usd:  6.50, percent: 0.28 },
          { mode: '/lead-review', usd: 2.90, percent: 0.12 }
        ],
        budgetUsd: 100,
        utilization: 0.234,
        alertLevel: 'OK'
      }),
      activeProject: async () => ({ projectId: null, activatedAt: null })
    },
    setup: {
      runNative: async (payload) => {
        const steps = [
          'Checking prerequisites…', `Writing settings for role: ${payload.role}`,
          'Workspace verified (mock)', 'Setup complete (browser mock)'
        ];
        for (const s of steps) {
          window.dispatchEvent(new CustomEvent('mock-install-event', {
            detail: { protocol: '1.0', phase: 'step', progress: 0, message: s, level: 'info' }
          }));
          await new Promise<void>((r) => setTimeout(r, 400));
        }
        return { ok: true, exitCode: 0, message: 'Done.', eventCount: steps.length };
      }
    },
    claude: {
      // initialPrompt already includes its leading slash (e.g. "/arch-mode",
      // "/ops/framework-review") — see electron/claude-launcher.ts.
      launch: async (_workspacePath, initialPrompt) => ({
        ok: true,
        message: `Mock launch — would have started Claude Code with ${initialPrompt}.`
      })
    },
    repo: {
      listBranches: async () => ({
        ok: true,
        current: 'release/R2026-01',
        branches: ['release/R2026-03', 'release/R2026-02', 'release/R2026-01', 'develop', 'main', 'feature/auth-redesign', 'feature/checkout-v2'],
        message: 'Mock branches (browser mode).'
      }),
      checkoutBranch: async (_repoPath, branch) => ({
        ok: true, dirty: false, message: `[mock] Switched to ${branch}`
      }),
      syncBranches: async () => ({
        ok: true, message: 'Mock — 23 branches visible locally.', branchesAdded: 23
      })
    },
    doctor: {
      run: async () => ({
        ok: true,
        ranAt: new Date().toISOString(),
        checks: [
          { id: 'node',      label: 'Node.js ≥ 18',                 status: 'pass' as const, detail: 'v20.x (mock)' },
          { id: 'npx',       label: 'npx available',                status: 'pass' as const, detail: 'mock' },
          { id: 'ado',       label: 'Azure DevOps connection',      status: 'pass' as const, detail: 'Authenticated (mock)' },
          { id: 'jira',      label: 'Atlassian Jira connection',    status: 'pass' as const, detail: 'Authenticated (mock)' },
          { id: 'git-creds', label: 'No embedded git credentials',  status: 'pass' as const, detail: 'Clean (mock)' },
        ],
      })
    },
    status: {
      checkAll: async () => ({
        ado:       { state: 'ok',      detail: 'Mock — token valid' },
        atlassian: { state: 'ok',      detail: 'Mock — token valid' },
        figma:     { state: 'missing', detail: 'Mock — no Figma PAT (OAuth may still work)' },
        checkedAt: new Date().toISOString()
      })
    },
    telemetry: {
      getSummary: async () => ({
        totalEvents: 247,
        unUploadedFiles: 3,
        oldestUnUploadedDate: '2026-06-01',
        newestUnUploadedDate: '2026-06-03',
        byMode: { 'dev-mode': 78, 'lead-review': 32, 'arch-mode': 21, 'qa-mode': 8, 'po-mode': 3 },
        bySkill: { 'caveman': 120, 'common/missing-scenarios': 22, 'common/cost-report': 14, 'common/pr-create': 11 },
        byBashProgram: { 'git': 142, 'mvn': 38, 'npm': 27, 'yarn': 11 },
        byTool: { 'Bash': 218, 'Edit': 145, 'Read': 287, 'Skill': 142, 'Write': 18 },
        sessions: 12,
      }),
      getStatus: async () => ({
        enabled: true,
        hasSasUrl: true,
        configuredContainer: 'claude-price-dashboard',
        containerMismatch: false,
        expectedContainer: 'claude-price-dashboard',
        sasExpiresAt: '2031-01-01T04:59:00Z',
        sasExpired: false,
        lastUploadAt: null,
        lastUploadResult: null,
        userHash: 'a3f9b1c2d4e5f6a7',
      }),
      verifySas: async () => ({ ok: true, userHash: 'a3f9b1c2d4e5f6a7', blobPath: 'a3f9b1c2d4e5f6a7/2026-01-01/0-install.jsonl' }),
      setEnabled: async () => ({ ok: true }),
      setSasUrl: async () => ({ ok: true, message: 'Mock SAS stored.' }),
      uploadNow: async () => ({ ok: true, filesUploaded: 3, bytesUploaded: 8421, lastError: null, uploadedAt: new Date().toISOString() }),
      purgeLocal: async () => ({ ok: true, deleted: 5, errors: 0 }),
    },
    cost: {
      getRollup: async () => ({
        today:        { estimates: 14, estMinUsd: 0.32, estMaxUsd: 0.48, redirects: 2 },
        thisSession:  { estimates: 4,  estMinUsd: 0.08, estMaxUsd: 0.12 },
        last7Days:    { estimates: 82, estMinUsd: 2.10, estMaxUsd: 3.40, redirects: 11, estimatedSavingsUsd: 0.62 },
        byClass: {
          code_generation: { count: 28, estMidUsd: 1.20 },
          code_review:     { count: 19, estMidUsd: 0.85 },
          qa_short:        { count: 22, estMidUsd: 0.35 },
          architecture:    { count: 8,  estMidUsd: 0.45 },
          default:         { count: 5,  estMidUsd: 0.10 },
        },
        byModel: {
          'claude-sonnet-4-6': { count: 70, estMidUsd: 2.30 },
          'claude-opus-4-7':   { count: 8,  estMidUsd: 0.65 },
          'claude-haiku-4-5':  { count: 4,  estMidUsd: 0.05 },
        },
      })
    }
  };

  // Inject. The renderer code reads `window.api` and gets these mocks.
  (window as unknown as { api: TitanApi }).api = shim;
}
