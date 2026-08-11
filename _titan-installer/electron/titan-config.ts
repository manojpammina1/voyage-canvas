// Titan config loader — main-process side.
//
// Reads `<workspace>/.claude/titan.config.json`, the single source of truth
// described in `harness/titan.config.schema.json`. The provider layer
// (providers/scm/*, providers/tracker/*, providers/telemetry-sink/*) reads
// `platforms.scm.kind` / `platforms.issue_tracker.kind` /
// `telemetry.upload.kind` from this file to pick an implementation instead
// of the old hardcoded org / `dev.azure.com` literals.
//
// Fails open with a minimal, clearly-fake default so a missing/invalid
// config degrades to "nothing configured" rather than crashing the wizard.
// The default's `configured: false` mirrors the schema's own convention.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface TitanScmConfig {
  kind: 'azure-devops' | 'github';
  base_url?: string;
  collection?: string;
  pat_url?: string;
}

export interface TitanIssueTrackerConfig {
  kind: 'jira' | 'none';
  site?: string;
  ticket_regex?: string;
}

export interface TitanRepoConfig {
  id: string;
  dir: string;
  display: string;
  kind: string;
  role_in_stack?: string[];
  branches?: { base?: string; release_pattern?: string };
}

export interface TitanRoleDefinition {
  code?: boolean;
  deploy?: boolean;
  pr_review?: boolean;
  edit_governance?: boolean;
  default_mode?: string;
  hidden?: boolean;
  holders?: string[];
}

export interface TitanBrandingConfig {
  logo_path: string;
  product_name: string;
  accent: string;
}

export interface TitanConfig {
  configured: boolean;
  org: { name: string; short_name: string; display_name: string; email_domain: string; harness_brand: string };
  contacts?: { people: Record<string, { name: string; email?: string }> };
  repos: TitanRepoConfig[];
  roles: { governance_owner: string; definitions: Record<string, TitanRoleDefinition> };
  platforms: {
    scm: TitanScmConfig;
    issue_tracker: TitanIssueTrackerConfig;
    general_chat_alternative?: string;
  };
  telemetry: { salt: string; enabled: boolean; upload: { kind: 'none' | 'azure-blob'; sas_url?: string } };
  branding?: TitanBrandingConfig;
}

// Minimal "nothing configured yet" default. Deliberately NOT a real org —
// callers should treat `configured: false` as "prompt the adopter to fill
// titan.config.json", not silently proceed as if this were real data.
export const DEFAULT_TITAN_CONFIG: TitanConfig = {
  configured: false,
  org: { name: 'Unconfigured Org', short_name: 'Org', display_name: 'Unconfigured Org', email_domain: 'example.com', harness_brand: 'Titan' },
  contacts: { people: {} },
  repos: [],
  roles: { governance_owner: '', definitions: {} },
  platforms: {
    scm: { kind: 'azure-devops' },
    issue_tracker: { kind: 'none' },
  },
  telemetry: { salt: 'titan-default-salt', enabled: false, upload: { kind: 'none' } },
  branding: { logo_path: 'assets/titan-mark.svg', product_name: 'Titan', accent: '#2F6FED' },
};

// Tiny in-process cache — this is read on nearly every IPC round-trip that
// touches ADO/Jira/telemetry, and re-reading + re-parsing the file each time
// is wasted work. Keyed by workspace path so multiple workspaces (unlikely
// in this app, but cheap to support) don't collide.
const cache = new Map<string, { mtimeMs: number; config: TitanConfig }>();

/** Resolve the best available titan.config.json path.
 *
 *  Before a workspace is chosen (Welcome/RolePicker/AdoPat/AtlassianSetup
 *  screens all run before WorkspaceLocation in SCREEN_ORDER), there is no
 *  `<workspace>/.claude/` yet to read from — the config an adopter filled
 *  in lives bundled with the installer itself (harnessDir, resolved by
 *  main.ts's bundledHarnessPath()). Once a workspace exists and the harness
 *  has been deployed into it, `<workspace>/.claude/titan.config.json` is
 *  preferred (it may have been hand-edited via the in-app config editor,
 *  §Phase 6 step 22, since the bundled copy was written). */
export function resolveTitanConfigPath(workspacePath: string | null, harnessDir: string | null): string | null {
  if (workspacePath) {
    const deployed = path.join(workspacePath, '.claude', 'titan.config.json');
    return deployed; // existence checked by the caller via fs.stat in loadTitanConfig
  }
  if (harnessDir) return path.join(harnessDir, 'titan.config.json');
  return null;
}

/** Load a titan.config.json from an explicit workspace path, falling back
 *  to the bundled harness copy (pre-deploy) if the workspace copy doesn't
 *  exist yet. Returns DEFAULT_TITAN_CONFIG (fail open) if neither is
 *  present or valid — the caller decides whether `configured: false`
 *  should block or just warn. */
export async function loadTitanConfig(workspacePath: string | null, harnessDir: string | null = null): Promise<TitanConfig> {
  const candidates = [
    workspacePath ? path.join(workspacePath, '.claude', 'titan.config.json') : null,
    harnessDir ? path.join(harnessDir, 'titan.config.json') : null,
  ].filter((p): p is string => !!p);

  for (const configPath of candidates) {
    const result = await loadTitanConfigFile(configPath);
    if (result) return result;
  }
  return DEFAULT_TITAN_CONFIG;
}

async function loadTitanConfigFile(configPath: string): Promise<TitanConfig | null> {
  try {
    const stat = await fs.stat(configPath);
    const cached = cache.get(configPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.config;

    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TitanConfig>;
    const merged: TitanConfig = {
      ...DEFAULT_TITAN_CONFIG,
      ...parsed,
      org: { ...DEFAULT_TITAN_CONFIG.org, ...parsed.org },
      platforms: {
        scm: { ...DEFAULT_TITAN_CONFIG.platforms.scm, ...parsed.platforms?.scm },
        issue_tracker: { ...DEFAULT_TITAN_CONFIG.platforms.issue_tracker, ...parsed.platforms?.issue_tracker },
        general_chat_alternative: parsed.platforms?.general_chat_alternative,
      },
      telemetry: {
        ...DEFAULT_TITAN_CONFIG.telemetry,
        ...parsed.telemetry,
        upload: { ...DEFAULT_TITAN_CONFIG.telemetry.upload, ...parsed.telemetry?.upload },
      },
      roles: { ...DEFAULT_TITAN_CONFIG.roles, ...parsed.roles },
      contacts: { people: { ...parsed.contacts?.people } },
      repos: parsed.repos ?? [],
      branding: { ...DEFAULT_TITAN_CONFIG.branding, ...parsed.branding } as TitanBrandingConfig,
    };
    cache.set(configPath, { mtimeMs: stat.mtimeMs, config: merged });
    return merged;
  } catch {
    return null; // missing/invalid at this candidate path — caller tries the next one
  }
}

/** Persist a (partial) config back to disk — used by the in-app config
 *  editor screen (§Phase 6 step 22) so adopters never hand-edit JSON.
 *  Merges shallowly onto whatever is already on disk (or the default). */
export async function saveTitanConfig(workspacePath: string, patch: Partial<TitanConfig>): Promise<{ ok: boolean; message?: string }> {
  const claudeDir = path.join(workspacePath, '.claude');
  const configPath = path.join(claudeDir, 'titan.config.json');
  try {
    const existing = await loadTitanConfig(workspacePath);
    const next: TitanConfig = {
      ...existing,
      ...patch,
      org: { ...existing.org, ...patch.org },
      platforms: {
        scm: { ...existing.platforms.scm, ...patch.platforms?.scm },
        issue_tracker: { ...existing.platforms.issue_tracker, ...patch.platforms?.issue_tracker },
        general_chat_alternative: patch.platforms?.general_chat_alternative ?? existing.platforms.general_chat_alternative,
      },
      telemetry: {
        ...existing.telemetry,
        ...patch.telemetry,
        upload: { ...existing.telemetry.upload, ...patch.telemetry?.upload },
      },
      roles: { ...existing.roles, ...patch.roles },
      contacts: { people: { ...existing.contacts?.people, ...patch.contacts?.people } },
      repos: patch.repos ?? existing.repos,
    };
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    cache.delete(configPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
