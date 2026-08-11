// Framework-state reader — surfaces `.claude/cost-tracking/*.jsonl`,
// `.claude/cost-tracking/budget.json`, and `.claude/projects/current.json`
// to the Dashboard.
//
// All file reads are tolerant of missing files: a missing usage log just
// means no Claude calls have been tracked yet, not an error. We resolve
// to sensible defaults so the Dashboard never crashes on a fresh install.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Titan pricing snapshot. Keep in sync with `.claude/commands/common/cost-report.md`.
// Cents per million tokens, by model + token type.
const PRICING_PER_MILLION_USD: Record<string, { input: number; output: number; cache_w: number; cache_r: number }> = {
  'claude-opus-4-7':       { input: 15.00, output: 75.00, cache_w: 18.75, cache_r: 1.50 },
  'claude-sonnet-4-6':     { input:  3.00, output: 15.00, cache_w:  3.75, cache_r: 0.30 },
  'claude-haiku-4-5':      { input:  1.00, output:  5.00, cache_w:  1.25, cache_r: 0.10 }
};

function normaliseModelName(raw: string): string {
  // Strip vendor suffixes like "[1m]" or "-20251001".
  const base = raw.replace(/\[[^\]]*\]/g, '').replace(/-\d{8}.*$/, '');
  if (base.startsWith('claude-opus-4-7'))    return 'claude-opus-4-7';
  if (base.startsWith('claude-sonnet-4'))    return 'claude-sonnet-4-6';
  if (base.startsWith('claude-haiku-4'))     return 'claude-haiku-4-5';
  return base;
}

export interface UsageRecord {
  timestamp: string;
  model: string;
  mode: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  session_id?: string;
}

export interface BudgetConfig {
  monthly_budget_usd: number;
  per_session_warning_usd: number;
  alert_thresholds: number[];
}

export interface CostSummary {
  totalUsd: number;
  byModel: { model: string; usd: number; percent: number }[];
  byMode:  { mode:  string; usd: number; percent: number }[];
  budgetUsd: number | null;
  utilization: number | null;     // 0..1 or null if no budget
  alertLevel: 'OK' | 'INFO' | 'WARNING' | 'CRITICAL' | 'HARD_STOP' | 'UNKNOWN';
}

const DEFAULT_BUDGET: BudgetConfig = {
  monthly_budget_usd: 100,
  per_session_warning_usd: 5,
  alert_thresholds: [0.5, 0.75, 0.9, 1.0]
};

/** Map utilization (0..1) to the matching alert level. */
function utilizationToAlert(u: number): CostSummary['alertLevel'] {
  if (u >= 1.00) return 'HARD_STOP';
  if (u >= 0.90) return 'CRITICAL';
  if (u >= 0.75) return 'WARNING';
  if (u >= 0.50) return 'INFO';
  return 'OK';
}

/** Read all usage-*.jsonl files for the current month and aggregate them. */
export async function readCostSummary(workspacePath: string): Promise<CostSummary> {
  const trackingDir = path.join(workspacePath, '.claude', 'cost-tracking');
  let files: string[] = [];
  try {
    const entries = await fs.readdir(trackingDir);
    files = entries.filter((f) => f.startsWith('usage-') && f.endsWith('.jsonl'));
  } catch {
    // No tracking dir = no usage yet. Return zero-state, not an error.
    return zeroCostSummary();
  }

  // Filter to current month — usage-YYYY-MM-DD.jsonl filename pattern.
  const monthPrefix = new Date().toISOString().slice(0, 7);     // YYYY-MM
  const monthFiles = files.filter((f) => f.startsWith(`usage-${monthPrefix}`));

  let totalCents = 0;
  const byModelCents = new Map<string, number>();
  const byModeCents  = new Map<string, number>();

  for (const f of monthFiles) {
    let content = '';
    try {
      content = await fs.readFile(path.join(trackingDir, f), 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let rec: UsageRecord;
      try { rec = JSON.parse(trimmed) as UsageRecord; }
      catch { continue; }

      const model = normaliseModelName(rec.model);
      const price = PRICING_PER_MILLION_USD[model];
      if (!price) continue;     // unknown model — skip rather than guess

      const cents =
        (rec.input_tokens                    / 1_000_000) * price.input   * 100 +
        (rec.output_tokens                   / 1_000_000) * price.output  * 100 +
        ((rec.cache_creation_input_tokens ?? 0) / 1_000_000) * price.cache_w * 100 +
        ((rec.cache_read_input_tokens     ?? 0) / 1_000_000) * price.cache_r * 100;

      totalCents += cents;
      byModelCents.set(model, (byModelCents.get(model) ?? 0) + cents);
      const mode = rec.mode || '(none)';
      byModeCents.set(mode, (byModeCents.get(mode) ?? 0) + cents);
    }
  }

  const totalUsd = totalCents / 100;

  // Budget
  let budget: BudgetConfig | null = null;
  try {
    const txt = await fs.readFile(path.join(trackingDir, 'budget.json'), 'utf-8');
    budget = JSON.parse(txt) as BudgetConfig;
  } catch {
    budget = null;
  }

  const budgetUsd  = budget?.monthly_budget_usd ?? null;
  const utilization = budgetUsd ? totalUsd / budgetUsd : null;
  const alertLevel  = utilization == null ? 'UNKNOWN' : utilizationToAlert(utilization);

  // Convert maps to sorted arrays with percent shares.
  const toArr = (m: Map<string, number>, key: 'model' | 'mode') =>
    [...m.entries()]
      .map(([k, c]) => ({
        [key]: k,
        usd: c / 100,
        percent: totalCents > 0 ? (c / totalCents) : 0
      }))
      .sort((a, b) => b.usd - a.usd) as unknown as CostSummary['byModel'];

  return {
    totalUsd,
    byModel: toArr(byModelCents, 'model'),
    byMode:  toArr(byModeCents,  'mode') as unknown as CostSummary['byMode'],
    budgetUsd,
    utilization,
    alertLevel
  };
}

function zeroCostSummary(): CostSummary {
  return {
    totalUsd: 0,
    byModel: [],
    byMode:  [],
    budgetUsd: DEFAULT_BUDGET.monthly_budget_usd,
    utilization: 0,
    alertLevel: 'OK'
  };
}

export interface ActiveProject {
  projectId: string | null;
  activatedAt: string | null;
}

/** Read `.claude/projects/current.json` for the active /ops/project-activate
 *  selection. Returns nulls if no project is active. */
export async function readActiveProject(workspacePath: string): Promise<ActiveProject> {
  const file = path.join(workspacePath, '.claude', 'projects', 'current.json');
  try {
    const txt = await fs.readFile(file, 'utf-8');
    const obj = JSON.parse(txt) as { project_id?: string; activated_at?: string };
    return {
      projectId:   obj.project_id   ?? null,
      activatedAt: obj.activated_at ?? null
    };
  } catch {
    return { projectId: null, activatedAt: null };
  }
}

export interface RepoStatus {
  repoName: string;
  branch:   string;
  aheadCount:  number;
  behindCount: number;
  hasUncommitted: boolean;
  exists: boolean;
}

/** Run `git status` + `git rev-list` to report ahead/behind state per repo.
 *  Used by the Dashboard to show whether the workspace is current with origin. */
export function readRepoStatus(repoPath: string): Promise<RepoStatus> {
  return new Promise<RepoStatus>((resolve) => {
    const repoName = path.basename(repoPath);
    const result: RepoStatus = {
      repoName, branch: 'unknown', aheadCount: 0, behindCount: 0, hasUncommitted: false, exists: false
    };

    // Probe the .git directory first to bail fast if the repo isn't cloned.
    fs.access(path.join(repoPath, '.git')).then(
      () => { result.exists = true; runStatus(); },
      () => { resolve(result); }
    );

    function runStatus(): void {
      // Single porcelain call gets us branch + ahead/behind + clean flag.
      const child = spawn('git', ['-C', repoPath, 'status', '-b', '--porcelain'], { shell: false });
      let out = '';
      child.stdout.on('data', (c: Buffer) => { out += c.toString('utf-8'); });
      child.on('close', () => {
        // First line: `## branch...origin/branch [ahead N, behind M]`
        const lines = out.split('\n');
        const header = lines[0] || '';
        const branchMatch = header.match(/^## ([^\s.]+)/);
        if (branchMatch) result.branch = branchMatch[1];
        const aheadMatch  = header.match(/ahead (\d+)/);
        const behindMatch = header.match(/behind (\d+)/);
        if (aheadMatch)  result.aheadCount  = parseInt(aheadMatch[1], 10);
        if (behindMatch) result.behindCount = parseInt(behindMatch[1], 10);
        // Remaining lines are uncommitted-change indicators.
        result.hasUncommitted = lines.slice(1).some((l) => l.trim().length > 0);
        resolve(result);
      });
      child.on('error', () => resolve(result));
    }
  });
}
