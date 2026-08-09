import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TitanConfigForRenderer } from '../global';

// Wizard state machine. Single source of truth for:
//   - Which screen is currently shown
//   - Every user-supplied value collected so far (role, workspace path, etc.)
//   - The completion flag that flips the app to Dashboard mode on next launch
//
// We deliberately do NOT use react-router. The wizard is linear with strict
// validation between steps; a state-machine-with-current-step model is
// simpler than URL routing inside an Electron window with no browser bar.

// Screens, in canonical order. PrereqCheck / AdoPat / CloneRepos /
// InstallProgress are conditionally skipped based on role — see canSkip().
export type Screen =
  | 'welcome'
  | 'role-picker'
  | 'onboarding'
  | 'atlassian-setup'     // All roles — Jira email + API token
  | 'telemetry-setup'     // All roles — Azure Blob SAS URL (optional)
  | 'figma-info'          // dev / lead / arch — Figma connector acknowledgment
  | 'prereq-check'
  | 'ado-pat'
  | 'workspace-location'
  | 'clone-repos'
  | 'install-progress'
  | 'done'
  | 'dashboard'
  // Not part of the linear wizard flow / SCREEN_ORDER — reached only via an
  // explicit "Edit config" action from the Dashboard (Phase 6 step 22).
  | 'config-editor';

export type Role =
  | 'po'
  | 'manager'
  | 'lead'
  | 'architect'
  | 'dev'
  | 'qa'             // QA / test architect — full repos for test work
  | 'security'       // AppSec reviewer — full repos for read-only review
  | 'sre'            // Site reliability / Cloud Manager — full repos + deploy context
  | 'designer'       // Frontend / design engineer — full repos + Figma emphasis
  | 'prodsupport';   // L2/L3 customer ticket triage — read-only, no repos

// Roles with NO repos at all (Atlassian-only install path).
const NO_CODE_ROLES: Role[] = ['prodsupport'];

// PAT stored in wizard state so the auto-setup step can use it directly
// without going through keytar (which can hang on some Windows configs).
// This is session-memory only; keytar remains the at-rest store.

// Status per repo during cloning. Drives the per-repo row UI in CloneRepos.
export type CloneStatus = 'queued' | 'cloning' | 'done' | 'failed';

export interface CloneRepoEntry {
  repoName: string;
  selected: boolean;
  branch: string;
  status: CloneStatus;
  message?: string;
}

interface WizardState {
  currentScreen: Screen;
  // Loaded once (main.tsx) from window.api.config.getTitan() — the single
  // source of truth for repos[], roles.definitions, and platforms.*. null
  // until the first load resolves; screens fall back to the pre-Titan
  // hardcoded defaults below when it's null OR its repos[] is empty, so
  // an unconfigured install (configured: false) still renders something.
  titanConfig: TitanConfigForRenderer | null;
  role: Role | null;
  workspacePath: string;
  adoPatStored: boolean;
  adoPatLastTestOk: boolean | null;
  adoPatValue: string;             // in-session PAT value (avoids keytar on install)
  jiraEmail: string;               // Atlassian API auth (all roles)
  jiraToken: string;
  displayName: string;             // optional — local-only dashboard name mapping, never uploaded
  telemetrySasUrl: string;         // Azure Blob SAS URL — optional, stored in keytar on install
  releaseBranch: string;           // shared release branch — applies to all selected repos
  repos: CloneRepoEntry[];
  installComplete: boolean;

  setScreen: (s: Screen) => void;
  loadTitanConfig: () => Promise<void>;
  setRole: (r: Role) => void;
  setWorkspacePath: (p: string) => void;
  setAdoPatStored: (v: boolean) => void;
  setAdoPatTestOk: (v: boolean | null) => void;
  setAdoPatValue: (v: string) => void;
  setJiraEmail: (v: string) => void;
  setJiraToken: (v: string) => void;
  setDisplayName: (v: string) => void;
  setTelemetrySasUrl: (v: string) => void;
  setReleaseBranch: (b: string) => void;   // updates state + propagates to every repo entry
  setRepos: (r: CloneRepoEntry[]) => void;
  updateRepo: (repoName: string, patch: Partial<CloneRepoEntry>) => void;
  markInstallComplete: () => void;

  // Derived navigation. Given the current screen and the user's role,
  // return the next screen the wizard should advance to. Keeping the
  // skip logic here means each screen component just calls `nextScreen()`
  // without knowing about branching.
  nextScreen: () => Screen;
}

// The default repo list for dev/lead/architect roles. PO/manager get an
// empty list (no repos to clone).
// Default branch: release/R2026-01 — the current active release branch.
// The clone screen lets users change this per-repo before starting.
const DEFAULT_BRANCH = 'release/R2026-01';

// Playwright repo's own working branch — NOT release/RYYYY-NN (that naming
// is AEM-only). Confirmed with the QA/Playwright repo owner: 'main'.
const PLAYWRIGHT_BRANCH = 'main';

// These fire ONLY when titanConfig.repos[] is empty — i.e. an adopter who
// hasn't filled in titan.config.json yet (configured: false). Placeholder
// names on purpose (renamed off the reference implementation's real repo
// names in the Titan de-branding pass) so an unconfigured install never
// shows a real company's repo name to a third-party adopter.
const DEFAULT_DEV_REPOS: CloneRepoEntry[] = [
  { repoName: 'example-storefront-ui',      selected: true,  branch: DEFAULT_BRANCH, status: 'queued' },
  { repoName: 'example-webapp',             selected: true,  branch: DEFAULT_BRANCH, status: 'queued' },
  { repoName: 'example-migration',          selected: true,  branch: DEFAULT_BRANCH, status: 'queued' },
  { repoName: 'example-integration-layer',  selected: true,  branch: DEFAULT_BRANCH, status: 'queued' },
  { repoName: 'example-commerce-platform',  selected: false, branch: DEFAULT_BRANCH, status: 'queued' }
];

// PO/manager repos — same codebase but no commerce-platform repo (irrotatable
// secrets). Read-only access: no build tools required, only git + SCM PAT.
const DEFAULT_PO_REPOS: CloneRepoEntry[] = [
  { repoName: 'example-storefront-ui',      selected: true, branch: DEFAULT_BRANCH, status: 'queued' },
  { repoName: 'example-webapp',             selected: true, branch: DEFAULT_BRANCH, status: 'queued' },
  { repoName: 'example-migration',          selected: true, branch: DEFAULT_BRANCH, status: 'queued' },
  { repoName: 'example-integration-layer',  selected: true, branch: DEFAULT_BRANCH, status: 'queued' },
  // example-commerce-platform intentionally excluded — contains irrotatable secrets
];

// QA Tester repos — Playwright ONLY. The AEM/Hybris repos (incl. the
// irrotatable Hybris secrets) are never cloned onto a QA machine; that is
// the whole point of this role having its own repo set instead of falling
// through to DEFAULT_DEV_REPOS (the pre-fix behaviour).
const DEFAULT_QA_REPOS: CloneRepoEntry[] = [
  { repoName: 'Playwright', selected: true, branch: PLAYWRIGHT_BRANCH, status: 'queued' }
];

// Canonical ordering for nextScreen() routing.
const SCREEN_ORDER: Screen[] = [
  'welcome',
  'role-picker',
  'onboarding',
  'atlassian-setup',    // ALL roles — Jira/Confluence credentials
  'telemetry-setup',    // ALL roles — optional Azure Blob SAS for central upload
  'figma-info',         // dev/lead/arch only — Figma OAuth acknowledgment
  'prereq-check',       // dev/lead/arch only
  'ado-pat',            // dev/lead/arch only
  'workspace-location',
  'clone-repos',        // dev/lead/arch only
  'install-progress',
  'done',
  'dashboard'
];

// Per-role: which screens are SKIPPED.
//
// PO / Manager: get ADO PAT + clone (read-only codebase) but skip
//   dev tooling prereqs and Figma.
// ProdSupport: no repos, no ADO PAT, no Figma.
// QA: no skips — keeps Figma (UI design reference for exact labels/copy) and
//   the full prereq/PAT/clone flow, same as dev. The repo SET differs
//   (DEFAULT_QA_REPOS, set in setRole below), not which screens are shown.
// All other code-touching roles: no skips.
function isScreenSkippedForRole(screen: Screen, role: Role | null): boolean {
  if (!role) return false;

  if (role === 'po' || role === 'manager') {
    return screen === 'prereq-check' || screen === 'figma-info';
  }

  if (NO_CODE_ROLES.includes(role)) {          // prodsupport
    return screen === 'prereq-check'
        || screen === 'ado-pat'
        || screen === 'clone-repos'
        || screen === 'figma-info';
  }

  return false;
}

// Build a role's repo list from config.repos[] (Titan) when available,
// falling back to the pre-Titan hardcoded lists otherwise. Config-driven
// path: role_in_stack tags a repo for specific roles; an untagged repo (no
// role_in_stack, or an empty array) is treated as relevant to every
// code-touching role. QA-tagged repos (role_in_stack includes 'qa') are
// used ONLY for the qa role — mirrors the old DEFAULT_QA_REPOS isolation
// (no AEM/Hybris source on a QA machine) without hardcoding repo names.
function reposFromConfig(config: TitanConfigForRenderer | null, role: Role): CloneRepoEntry[] | null {
  if (!config || !config.repos || config.repos.length === 0) return null;
  const relevant = config.repos.filter((r) => {
    const tags = r.role_in_stack ?? [];
    if (tags.length === 0) return role !== 'qa'; // untagged repos = "everyone but QA", matching old isolation intent
    return tags.includes(role);
  });
  if (relevant.length === 0) return [];
  return relevant.map((r) => ({
    repoName: r.dir,
    selected: true,
    branch: r.branches?.release_pattern ?? r.branches?.base ?? DEFAULT_BRANCH,
    status: 'queued' as const,
  }));
}

export const useWizard = create<WizardState>()(persist((set, get) => ({
  currentScreen: 'welcome',
  titanConfig: null,
  role: null,
  workspacePath: 'C:\\codebase\\ecom-webapp',
  adoPatStored: false,
  adoPatLastTestOk: null,
  adoPatValue: '',
  jiraEmail: '',
  jiraToken: '',
  displayName: '',
  telemetrySasUrl: '',
  releaseBranch: DEFAULT_BRANCH,
  repos: [],
  installComplete: false,

  setScreen: (s) => set({ currentScreen: s }),
  loadTitanConfig: async () => {
    try {
      const config = await window.api.config.getTitan();
      set({ titanConfig: config });
    } catch {
      // Fail open — screens fall back to the hardcoded defaults below.
      set({ titanConfig: null });
    }
  },
  setRole: (r) => {
    const fromConfig = NO_CODE_ROLES.includes(r) ? [] : reposFromConfig(get().titanConfig, r);
    const repos = fromConfig !== null
      ? fromConfig
      : NO_CODE_ROLES.includes(r)
        ? []
        : (r === 'po' || r === 'manager')
          ? DEFAULT_PO_REPOS.map(x => ({ ...x }))
          : r === 'qa'
            ? DEFAULT_QA_REPOS.map(x => ({ ...x }))
            : DEFAULT_DEV_REPOS.map(x => ({ ...x }));
    // QA's release-branch field must match Playwright's own branch (main),
    // not the AEM release/RYYYY-NN default — CloneRepos' text/dropdown reads
    // this field directly.
    set({ role: r, repos, releaseBranch: r === 'qa' ? PLAYWRIGHT_BRANCH : DEFAULT_BRANCH });
  },
  setWorkspacePath: (p) => set({ workspacePath: p }),
  setAdoPatStored: (v) => set({ adoPatStored: v }),
  setAdoPatTestOk: (v) => set({ adoPatLastTestOk: v }),
  setAdoPatValue: (v) => set({ adoPatValue: v }),
  setJiraEmail: (v) => set({ jiraEmail: v }),
  setJiraToken: (v) => set({ jiraToken: v }),
  setDisplayName: (v) => set({ displayName: v }),
  setTelemetrySasUrl: (v) => set({ telemetrySasUrl: v }),
  setReleaseBranch: (b) =>
    set((state) => ({
      releaseBranch: b,
      repos: state.repos.map((r) => ({ ...r, branch: b }))
    })),
  setRepos: (r) => set({ repos: r }),
  updateRepo: (repoName, patch) =>
    set((state) => ({
      repos: state.repos.map((r) => (r.repoName === repoName ? { ...r, ...patch } : r))
    })),
  markInstallComplete: () => set({ installComplete: true }),

  nextScreen: () => {
    const { currentScreen, role } = get();
    const idx = SCREEN_ORDER.indexOf(currentScreen);
    if (idx === -1 || idx === SCREEN_ORDER.length - 1) return currentScreen;
    // Walk forward skipping role-irrelevant screens.
    for (let i = idx + 1; i < SCREEN_ORDER.length; i++) {
      const candidate = SCREEN_ORDER[i];
      if (!isScreenSkippedForRole(candidate, role)) return candidate;
    }
    return 'dashboard';
  }
}), {
  name: 'titan-wizard',
  storage: createJSONStorage(() => localStorage),
  // Persist ONLY non-secret state. Tokens / PATs / SAS live in keytar +
  // settings.local.json env; they are never written to localStorage.
  partialize: (state) => ({
    currentScreen: state.currentScreen,
    role: state.role,
    workspacePath: state.workspacePath,
    releaseBranch: state.releaseBranch,
    installComplete: state.installComplete,
    // Persist Jira email (not the token) — it's not a secret + makes Back nav work
    jiraEmail: state.jiraEmail,
    // Display name — local-only, never uploaded (see roster-entry.json write in main.ts)
    displayName: state.displayName,
    // Repo selections survive reopen — but status fields reset
    repos: state.repos.map((r) => ({ ...r, status: 'queued' as const, message: undefined })),
  }),
  // On hydrate, if installComplete=true AND user is mid-wizard somewhere, jump
  // them straight to Dashboard. They can re-enter the wizard via a Reconfigure button.
  onRehydrateStorage: () => (state) => {
    if (state?.installComplete) {
      state.currentScreen = 'dashboard';
    }
  },
}));
