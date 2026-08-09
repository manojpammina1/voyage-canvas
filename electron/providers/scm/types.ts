// SCM provider interface — selected at runtime by `config.platforms.scm.kind`.
//
// This is the abstraction the Titan extraction plan (§E) calls for: the
// reference implementation this was extracted from hardcoded one specific
// `dev.azure.com/<org>` URL in three places in electron/main.ts.
// Everything that used to reach out to ADO directly now goes through one of
// these implementations instead.

export interface ScmBranchResult {
  ok: boolean;
  branches: string[];
  message: string;
}

export interface ScmPatTestResult {
  ok: boolean;
  status: number;
  message: string;
}

export interface ScmProjectsProbeResult {
  ok: boolean;
  detail: string;
}

export interface ScmProvider {
  readonly kind: 'azure-devops' | 'github';

  /** Human-facing URL to create/manage a personal access token for this SCM. */
  patCreateUrl(): string;

  /** Base org/collection URL, e.g. `https://dev.azure.com/<org>` — used for
   *  MCP server env wiring (AZURE_DEVOPS_URL) and anywhere else that needs
   *  "the org" without the token-creation-specific suffix. */
  baseUrl(): string;

  /** Validate a PAT by hitting a cheap authenticated endpoint. Used by the
   *  wizard's "Test connection" button (renamed from testAdo). */
  validatePat(pat: string): Promise<ScmPatTestResult>;

  /** List branches for a single repo, most-relevant-first (today: release/*
   *  branches reverse-sorted, then everything else alphabetically). */
  listRepoBranches(repoName: string, pat: string): Promise<ScmBranchResult>;

  /** Build the clone URL for a repo, PAT baked in via basic auth (matches
   *  today's repo-cloner.ts behaviour — see authEnv()). */
  cloneUrl(repoName: string, pat: string): string;

  /** Doctor/status-check probe — "is this PAT alive and does it see
   *  projects/repos" without needing a specific repo name. */
  probeConnectivity(pat: string): Promise<ScmProjectsProbeResult>;
}
