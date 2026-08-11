import { subDays, format, parseISO, differenceInMinutes } from 'date-fns';
import type { TelemetryEvent, AggPeriod, Aggregations, PrStats, CorrectionStats, CorrectionMetrics } from './types';
import { getLabel } from './pricing';
import {
  CAVEMAN_SESSION_COMPRESSION_FACTOR,
  CAVEMAN_ACTIVE_MODES,
  ANTHROPIC_COST_PER_DEV_DAY_USD,
} from './caveman-config';
import {
  CORRECTION_IDLE_CAP_SECONDS,
  CORRECTION_TOOL_ERROR_CLASSES,
  CORRECTION_THRESHOLD,
} from './correction-config';

// Full list of skills in the harness catalog (used for "dead skills" detection).
const SKILL_CATALOG = [
  'caveman','aem-build','arch-decision','arch-doc','branch','branch-close','branch-merge',
  'check-conventions','cif-check','compound','contract-review','cost-report','debug',
  'diff-risk','i18n-check','mcp-audit','migration-check','missing-scenarios','new-module',
  'parallel-review','phi-guard','review-fix-loop','schema-drift','security-check',
  'task-progress','tech-debt','test-impact','worktree-agent','usage-report',
  'offshore-brief','pr-create','unit-test','estimate','copilot',
  'check-version','framework-review','incident-response','project-activate',
  'project-audit','project-status','release-notes','plugin-policy',
  'hybris-logs','aem-logs',
];

// A real user hash is always sha256(...).slice(0,16) — 16 lowercase hex chars
// (see harness/scripts/telemetry-upload.js computeUserHash / electron
// telemetry-uploader.ts). Any event whose `user` field doesn't match this
// shape (missing, empty, malformed) must never be counted as a distinct
// user — one bad record should not inflate "active users" or produce a
// blank-labeled phantom row in the per-user table.
const isValidUserHash = (u: unknown): u is string => typeof u === 'string' && /^[0-9a-f]{16}$/.test(u);

const ROLE_MODES = [
  'dev-mode','lead-review','arch-mode','po-mode','grill-me',
  'qa-mode','security-mode','sre-mode','designer-mode','prodsupport-mode',
];

// Install-time CLAUDE_ROLE → closest mode (module-level; also used by the
// caveman savings computation). Unmapped roles (e.g. "super") intentionally
// resolve to '' — conservative: their output is NOT counted as compressed.
const ROLE_TO_MODE_STATIC: Record<string, string> = {
  architect:    'arch-mode',
  developer:    'dev-mode',
  dev:          'dev-mode',
  lead:         'lead-review',
  po:           'po-mode',
  manager:      'po-mode',
  qa:           'qa-mode',
  security:     'security-mode',
  sre:          'sre-mode',
  designer:     'designer-mode',
  prodsupport:  'prodsupport-mode',
};

function cutoff(daysBack: number): Date {
  return subDays(new Date(), daysBack);
}

function dateStr(ts: string): string {
  try { return format(parseISO(ts), 'yyyy-MM-dd'); } catch { return ts.slice(0, 10); }
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Section 2f — Correction cost ("cost of AI hallucinations") ─────────────
// EVERY value below is a measured fact: real billed cost_usd, measured minutes
// (idle-capped), counts, and git/ADO records. No monetary assumption exists.
//
// A "correction episode" is reconstructed per session from the real event stream:
// it opens on a correction prompt (_correction explicit_flag/followup_phrase) or a
// counted tool failure (Claude hallucinated a file/code — Edit/Read errored), and
// closes on a clean (non-correction) user prompt or session end. Assistant turns
// inside the episode are the "wasted" turns — their real cost_usd/tokens are summed.
const _CORR_TOOLS = new Set(['Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit', 'Bash']);

export function computeCorrection(
  events: TelemetryEvent[],
  period: AggPeriod,
  correctionStats?: CorrectionStats | null,
): CorrectionMetrics {
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const since = cutoff(period.daysBack);
  const pe = events.filter((e) => new Date(e.ts) >= since);

  const usage = pe.filter((e) => e.tool === '_actual_usage');
  const totalPeriodTokens = usage.reduce((s, e) => s + num(e.meta?.total_tokens), 0);
  const assistantTurns = usage.length;

  // ── Tool-failure signal (the primary in-session hallucination fact) ──────
  const toolCalls = pe.filter((e) => _CORR_TOOLS.has(e.tool));
  const countedErrors = toolCalls.filter((e) =>
    CORRECTION_TOOL_ERROR_CLASSES.has(String(e.meta?.error_class ?? '')));
  const toolErrorRate = toolCalls.length ? countedErrors.length / toolCalls.length : 0;
  const toolErrClass = new Map<string, number>();
  for (const e of countedErrors) {
    const c = String(e.meta?.error_class);
    toolErrClass.set(c, (toolErrClass.get(c) ?? 0) + 1);
  }

  // ── Correction + avoided events ──────────────────────────────────────────
  const corrEvents = pe.filter((e) => e.tool === '_correction');
  const signalMap = new Map<string, number>();
  for (const e of corrEvents) {
    const s = String(e.meta?.signal ?? 'unknown');
    signalMap.set(s, (signalMap.get(s) ?? 0) + 1);
  }
  const isPromptCorrection = (e: TelemetryEvent) =>
    e.tool === '_correction' &&
    (e.meta?.signal === 'explicit_flag' || e.meta?.signal === 'followup_phrase');
  const correctionCount = corrEvents.filter(isPromptCorrection).length;
  const correctionRate = assistantTurns ? correctionCount / assistantTurns : 0;

  const blocks = pe.filter((e) => e.tool === '_hook_block');
  const avoidedCount = blocks.length;
  const refusalCount = blocks.filter((e) => String(e.meta?.category) === 'refusal-unverified').length;

  // ── Episode reconstruction (per raw session; correction bursts are short) ──
  const IDLE = CORRECTION_IDLE_CAP_SECONDS;
  const bySession = new Map<string, TelemetryEvent[]>();
  for (const e of pe) {
    const sid = e.session || 'noop';
    const arr = bySession.get(sid);
    if (arr) arr.push(e); else bySession.set(sid, [e]);
  }

  let wastedCostUsd = 0, wastedTokens = 0;
  const timeToCorrect: number[] = [];
  const byModelMap = new Map<string, { corrections: number; turns: number }>();
  const dailyWastedTok = new Map<string, number>();
  const dailyWastedUsd = new Map<string, number>();
  const dailyTotalTok = new Map<string, number>();
  const userWastedTok = new Map<string, number>();
  const userWastedUsd = new Map<string, number>();
  const userTotalTok = new Map<string, number>();
  const userCorrections = new Map<string, number>();

  for (const e of usage) {
    dailyTotalTok.set(dateStr(e.ts), (dailyTotalTok.get(dateStr(e.ts)) ?? 0) + num(e.meta?.total_tokens));
    userTotalTok.set(e.user, (userTotalTok.get(e.user) ?? 0) + num(e.meta?.total_tokens));
  }
  for (const e of corrEvents) {
    if (isPromptCorrection(e)) userCorrections.set(e.user, (userCorrections.get(e.user) ?? 0) + 1);
  }

  for (const [, evs] of bySession) {
    evs.sort((a, b) => a.ts.localeCompare(b.ts));
    // Correction-prompt timestamps (to the second) — a _cost_estimate at the same
    // instant is a correction prompt (its _correction fired from the same submit),
    // so it must NOT be treated as the clean prompt that closes the episode.
    const corrTs = new Set(
      evs.filter(isPromptCorrection).map((e) => e.ts.slice(0, 19)));
    let active = false, epGap = 0, lastTs: Date | null = null, lastModel = '';

    for (const e of evs) {
      const t = parseISO(e.ts);
      if (active && lastTs) {
        const gap = (t.getTime() - lastTs.getTime()) / 1000;
        epGap += Math.min(Math.max(gap, 0), IDLE); // idle-capped measured human time
      }
      lastTs = t;

      const countedErr = _CORR_TOOLS.has(e.tool) &&
        CORRECTION_TOOL_ERROR_CLASSES.has(String(e.meta?.error_class ?? ''));

      if (isPromptCorrection(e) || countedErr) {
        if (!active) { active = true; epGap = 0; }
        if (isPromptCorrection(e) && lastModel) {
          const b = byModelMap.get(lastModel) ?? { corrections: 0, turns: 0 };
          b.corrections += 1; byModelMap.set(lastModel, b);
        }
      }

      if (e.tool === '_actual_usage') {
        lastModel = String(e.meta?.model ?? 'default');
        const b = byModelMap.get(lastModel) ?? { corrections: 0, turns: 0 };
        b.turns += 1; byModelMap.set(lastModel, b);
        if (active) {
          const c = num(e.meta?.cost_usd), tk = num(e.meta?.total_tokens);
          wastedCostUsd += c; wastedTokens += tk;
          dailyWastedUsd.set(dateStr(e.ts), (dailyWastedUsd.get(dateStr(e.ts)) ?? 0) + c);
          dailyWastedTok.set(dateStr(e.ts), (dailyWastedTok.get(dateStr(e.ts)) ?? 0) + tk);
          userWastedUsd.set(e.user, (userWastedUsd.get(e.user) ?? 0) + c);
          userWastedTok.set(e.user, (userWastedTok.get(e.user) ?? 0) + tk);
        }
      }

      // Clean user prompt (a _cost_estimate with no paired _correction) resolves it.
      if (e.tool === '_cost_estimate' && !corrTs.has(e.ts.slice(0, 19)) && active) {
        timeToCorrect.push(epGap); active = false; epGap = 0;
      }
    }
    if (active) timeToCorrect.push(epGap); // session ended mid-correction
  }

  const reworkTokenRatio = totalPeriodTokens ? wastedTokens / totalPeriodTokens : 0;
  const medianTimeToCorrectSec = Math.round(median(timeToCorrect));

  const byModel = [...byModelMap.entries()]
    .map(([model, v]) => ({
      model: getLabel(model), corrections: v.corrections, assistantTurns: v.turns,
      ratePer100: v.turns ? (v.corrections / v.turns) * 100 : 0,
    }))
    .sort((a, b) => b.ratePer100 - a.ratePer100);

  // ── Per-day threshold band (fact-driven; no assumption in the alert) ──────
  const days = [...new Set([...dailyTotalTok.keys()])].sort();
  const ratioByDay = new Map<string, number>();
  for (const d of days) {
    const tot = dailyTotalTok.get(d) ?? 0;
    ratioByDay.set(d, tot ? (dailyWastedTok.get(d) ?? 0) / tot : 0);
  }
  const { rollingWindowDays, baselineMultiplier, minEventsForBaseline } = CORRECTION_THRESHOLD;
  const corrByDay = new Map<string, number>();
  for (const e of corrEvents) if (isPromptCorrection(e)) corrByDay.set(dateStr(e.ts), (corrByDay.get(dateStr(e.ts)) ?? 0) + 1);

  const perDay = days.map((d) => {
    const ratio = ratioByDay.get(d) ?? 0;
    const dt = parseISO(d + 'T00:00:00Z');
    const windowVals: number[] = [];
    let windowEvents = 0;
    for (const [wd, wr] of ratioByDay) {
      const wdt = parseISO(wd + 'T00:00:00Z');
      const diffDays = (dt.getTime() - wdt.getTime()) / 86_400_000;
      if (diffDays > 0 && diffDays <= rollingWindowDays) {
        windowVals.push(wr);
        windowEvents += corrByDay.get(wd) ?? 0;
      }
    }
    const baseline = windowVals.length ? median(windowVals) : null;
    const alert = baseline != null && windowEvents >= minEventsForBaseline &&
      ratio > baseline * baselineMultiplier;
    return { date: d, wastedUsd: dailyWastedUsd.get(d) ?? 0, reworkRatio: ratio, baseline, alert };
  });

  // ── Per-dev (partitioned by hashed user). Ratios are facts; the alert is a
  // vs-cohort comparison (heuristic threshold, not a $ assumption). ──────────
  const perDevAlerts = [...userTotalTok.keys()].map((hash) => {
    const tot = userTotalTok.get(hash) ?? 0;
    const ratio = tot ? (userWastedTok.get(hash) ?? 0) / tot : 0;
    const corrections = userCorrections.get(hash) ?? 0;
    const alert = corrections >= 3 && reworkTokenRatio > 0 &&
      ratio > reworkTokenRatio * baselineMultiplier;
    return { hash, corrections, wastedUsd: userWastedUsd.get(hash) ?? 0, reworkRatio: ratio, alert };
  }).filter((r) => r.corrections > 0).sort((a, b) => b.reworkRatio - a.reworkRatio);

  // ── Downstream records (Layer B). null = unknown; ADO pending until PAT. ──
  // Fixed in the 2.4.1 pre-ship audit: this used to fall back to
  // periods['30'] whenever the active period's key was missing (e.g. '365'
  // on an overlay built by an older build-correction-stats.mjs that only
  // emitted 7/30) — silently mixing an all-time numerator with a 30-day
  // denominator. Exact-key lookup only now; a missing period correctly
  // falls through to `adoPending` below instead of showing a wrong number.
  const key = String(period.daysBack);
  const cs = correctionStats?.periods?.[key];
  const adoPending = !correctionStats || !!correctionStats.reason || !cs ||
    (cs.prCount == null && cs.reworkIterations == null && cs.changesRequested == null && cs.ciFails == null);
  const records = {
    revertCount: null as number | null,   // git-local reverts — follow-up in the overlay script
    prIterations: cs?.reworkIterations ?? null,
    changesRequested: cs?.changesRequested ?? null,
    ciFails: cs?.ciFails ?? null,
    adoPending,
  };

  return {
    wastedCostUsd, wastedTokens, totalPeriodTokens, reworkTokenRatio, toolErrorRate,
    correctionCount, correctionRate, medianTimeToCorrectSec,
    toolErrorsByClass: [...toolErrClass.entries()].map(([errorClass, count]) => ({ errorClass, count })).sort((a, b) => b.count - a.count),
    correctionsBySignal: [...signalMap.entries()].map(([signal, count]) => ({ signal, count })).sort((a, b) => b.count - a.count),
    byModel,
    avoidedCount, refusalCount,
    spiralsContained: signalMap.get('spiral_break') ?? 0,
    spiralWarnings: signalMap.get('spiral_warn') ?? 0,
    perDay, perDevAlerts, records,
    hasData: correctionCount > 0 || countedErrors.length > 0 || avoidedCount > 0 || (signalMap.get('spiral_break') ?? 0) > 0,
  };
}

export function compute(events: TelemetryEvent[], period: AggPeriod, prStats?: PrStats | null, correctionStats?: CorrectionStats | null): Aggregations {
  const since   = cutoff(period.daysBack);
  const weekAgo = cutoff(7);
  const today   = format(new Date(), 'yyyy-MM-dd');

  // Period filter
  const pe = events.filter((e) => new Date(e.ts) >= since);

  // ── Section 1: Pilot snapshot ──────────────────────────────────────
  const users    = new Set(pe.map((e) => e.user).filter(isValidUserHash));
  const sessions = new Set(pe.map((e) => e.session).filter(Boolean));
  const prompts  = pe.filter((e) => e.tool === '_cost_estimate');

  // Per-session time span.
  // Claude Code doesn't reliably set CLAUDE_SESSION_ID, so many events arrive
  // with session="noop". For those, synthesise sessions by splitting on time
  // gaps > 60 min — a new burst of activity after a gap = a new session.
  const SESSION_GAP_MS = 60 * 60 * 1000;  // 60 min
  const syntheticSessions = new Map<string, { min: string; max: string }>();
  const sortedPe = [...pe].sort((a, b) => a.ts.localeCompare(b.ts));

  let synthIdx = 0;
  let lastTs: Date | null = null;

  for (const e of sortedPe) {
    const ts = parseISO(e.ts);
    const rawId = e.session && e.session !== 'noop' ? e.session : null;
    let sid: string;

    if (rawId) {
      sid = rawId;
    } else {
      // Time-gap synthetic session
      if (!lastTs || ts.getTime() - lastTs.getTime() > SESSION_GAP_MS) {
        synthIdx++;
      }
      sid = `synth_${synthIdx}`;
    }

    lastTs = ts;
    const cur = syntheticSessions.get(sid);
    if (!cur) syntheticSessions.set(sid, { min: e.ts, max: e.ts });
    else syntheticSessions.set(sid, {
      min: e.ts < cur.min ? e.ts : cur.min,
      max: e.ts > cur.max ? e.ts : cur.max,
    });
  }

  const sessionMap = syntheticSessions;
  const sessionLengths = [...sessionMap.values()].map(({ min, max }) =>
    differenceInMinutes(parseISO(max), parseISO(min))
  );
  const avgSessionMinutes = sessionLengths.length
    ? sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length
    : 0;

  // Prior period for deltas
  const priorSince = cutoff(period.daysBack * 2);
  const pe2  = events.filter((e) => new Date(e.ts) >= priorSince && new Date(e.ts) < since);
  const pu2  = new Set(pe2.map((e) => e.user).filter(isValidUserHash));
  const pp2  = pe2.filter((e) => e.tool === '_cost_estimate');

  // ── Section 2: Cost ────────────────────────────────────────────────
  //
  // Priority order for cost data:
  //   1. _actual_usage (tool === '_actual_usage', source: stop_hook or otel)
  //      → EXACT token counts from Claude Code's API response. Use these.
  //   2. _cost_estimate (tool === '_cost_estimate')
  //      → Pre-flight estimates. Used ONLY as fallback when no actual data.
  //
  const actualUsageEvents = pe.filter((e) => e.tool === '_actual_usage');
  const estimateEvents    = pe.filter((e) => e.tool === '_cost_estimate');
  const hasActualData     = actualUsageEvents.length > 0;

  // Per-day HYBRID: use exact _actual_usage for any day that HAS it; fall back to
  // _cost_estimate only for days with no actual data. This avoids (a) globally
  // discarding estimates the moment any actual exists (which would zero out
  // historical days), and (b) double-counting (a given day uses one source only).
  const daysWithActual = new Set(actualUsageEvents.map((e) => dateStr(e.ts)));
  const costEvents = pe.filter((e) =>
    e.tool === '_actual_usage' ||
    (e.tool === '_cost_estimate' && !daysWithActual.has(dateStr(e.ts)))
  );
  const getCost = (e: TelemetryEvent) =>
    Number((e.meta?.[e.tool === '_actual_usage' ? 'cost_usd' : 'cost_max_usd'] as number) ?? 0);

  const totalEst  = costEvents.reduce((s, e) => s + getCost(e), 0);
  const last7dEst = costEvents.filter((e) => new Date(e.ts) >= weekAgo).reduce((s, e) => s + getCost(e), 0);
  const todayEst  = costEvents.filter((e) => dateStr(e.ts) === today).reduce((s, e) => s + getCost(e), 0);

  // Token totals (only available from actual usage events)
  const totalInputTokens  = actualUsageEvents.reduce((s, e) => s + Number((e.meta?.input_tokens as number)  ?? 0), 0);
  const totalOutputTokens = actualUsageEvents.reduce((s, e) => s + Number((e.meta?.output_tokens as number) ?? 0), 0);
  const totalCacheRead    = actualUsageEvents.reduce((s, e) => s + Number((e.meta?.cache_read_tokens as number) ?? 0), 0);

  // By model
  const modelMap = new Map<string, number>();
  for (const e of costEvents) {
    const m = getLabel(String(e.meta?.model ?? 'default'));
    modelMap.set(m, (modelMap.get(m) ?? 0) + getCost(e));
  }
  const totalModelUsd = [...modelMap.values()].reduce((a, b) => a + b, 0) || 1;
  const byModel = [...modelMap.entries()]
    .map(([model, usd]) => ({ model, usd, pct: Math.round((usd / totalModelUsd) * 100) }))
    .sort((a, b) => b.usd - a.usd);

  // Daily cost
  const dailyCostMap = new Map<string, number>();
  for (const e of costEvents) {
    const d = dateStr(e.ts);
    dailyCostMap.set(d, (dailyCostMap.get(d) ?? 0) + getCost(e));
  }
  const dailyCost = [...dailyCostMap.entries()].sort().map(([date, usd]) => ({ date, usd }));

  const redirectEvents = pe.filter((e) => e.tool === '_copilot_redirect');
  const avgActual  = hasActualData && actualUsageEvents.length ? totalEst / actualUsageEvents.length : 0;
  const avgEst     = estimateEvents.length ? estimateEvents.reduce((s, e) => s + getCost(e), 0) / estimateEvents.length : 0;
  const savingsUsd = redirectEvents.length * (avgActual || avgEst) * 0.30;

  // ── Section 2b: Savings (exact + labeled — no inflation) ──────────────
  // Per-model list rates ($/1M), aligned with the Stop hook's cost math.
  const RATE = (model: string) => {
    const m = model.toLowerCase();
    if (m.includes('opus'))  return { i: 15,   o: 75,   cw: 15,   cr: 1.5  };
    if (m.includes('haiku')) return { i: 0.25, o: 1.25, cw: 0.30, cr: 0.03 };
    return { i: 3, o: 15, cw: 3.75, cr: 0.30 };   // sonnet / default
  };
  let cacheSavingsUsd = 0, routingSavingsUsd = 0, actualSpendUsd = 0;
  let cavemanUsd = 0;
  const dailySavings = new Map<string, { saved: number; spend: number }>();
  for (const e of actualUsageEvents) {
    const model = String(e.meta?.model ?? 'default');
    const r  = RATE(model);
    const inT  = Number(e.meta?.input_tokens          ?? 0);
    const outT = Number(e.meta?.output_tokens         ?? 0);
    const cc   = Number(e.meta?.cache_creation_tokens ?? 0);
    const cr   = Number(e.meta?.cache_read_tokens     ?? 0);
    const actualCost = Number(e.meta?.cost_usd ?? 0);
    actualSpendUsd += actualCost;
    // FACT — cache-read tokens are billed at the cache rate; savings vs full input rate.
    const evCache = cr * (r.i - r.cr) / 1_000_000;
    cacheSavingsUsd += evCache;
    // ASSUMPTION — what the SAME exact tokens would have cost on Opus (baseline).
    const opusCost = (inT * 15 + outT * 75 + cc * 15 + cr * 1.5) / 1_000_000;
    const evRouting = Math.max(0, opusCost - actualCost);
    routingSavingsUsd += evRouting;
    // ESTIMATE — caveman output compression. Session-level factor (0.39, the
    // measured multi-turn figure — NOT the 75% per-prompt claim). Only roles
    // whose mode auto-engages caveman; unmapped roles are NOT counted.
    const mode = ROLE_TO_MODE_STATIC[(e.role ?? '').toLowerCase()] ?? '';
    if (CAVEMAN_ACTIVE_MODES.has(mode)) {
      // observed output is assumed post-compression: saved = observed × f/(1−f)
      cavemanUsd += (outT * r.o / 1_000_000) *
        (CAVEMAN_SESSION_COMPRESSION_FACTOR / (1 - CAVEMAN_SESSION_COMPRESSION_FACTOR));
    }
    // Per-day trend accumulation (cache + routing only — copilot/caveman/cache-hit
    // lines are period-level estimates, excluded from the daily trend for honesty).
    const d = dateStr(e.ts);
    const cur = dailySavings.get(d) ?? { saved: 0, spend: 0 };
    cur.saved += evCache + evRouting;
    cur.spend += actualCost;
    dailySavings.set(d, cur);
  }
  // ESTIMATE — answer-cache: Σ avoided_cost_usd from _cache_hit events.
  // The hit COUNT is a fact; the dollar value uses the rolling avg prompt cost.
  const cacheHitEvents  = pe.filter((e) => e.tool === '_cache_hit');
  const answerCacheHits = cacheHitEvents.length;
  const answerCacheUsd  = cacheHitEvents.reduce(
    (s, e) => s + Number((e.meta?.avoided_cost_usd as number) ?? 0), 0);

  // Tool-output crush (v2.4): input compression by the PostToolUse hook.
  // Event count, bytes elided, and compression % are FACTS straight from
  // _crush telemetry (each event records the exact orig/crushed sizes) — shown
  // as-is in the standalone crush strip, never adjusted.
  // crushSavingsUsd is a SEPARATE, clearly-labeled ESTIMATE layered on top —
  // same pattern as answerCacheUsd (hit count fact, $/hit estimate) and
  // cavemanUsd (vendor claimed 75%, we book the measured 0.39 instead).
  // FORMULA: bytes ÷ 4 (chars-per-token heuristic) × default/Sonnet input
  // rate. Deliberately conservative: no Opus counterfactual, no cache-write
  // credit, priced at the cheapest common rate. Supersede with a measured
  // session-level A/B factor if/when one exists — until then this is the
  // documented-formula floor, not a vendor claim.
  const crushEventList  = pe.filter((e) => e.tool === '_crush');
  const crushHits       = crushEventList.length;
  const crushOrigBytes  = crushEventList.reduce(
    (s, e) => s + Math.max(0, Number(e.meta?.orig_bytes ?? 0)), 0);
  const crushSavedBytes = crushEventList.reduce(
    (s, e) => s + Math.max(0, Number(e.meta?.orig_bytes ?? 0) - Number(e.meta?.crushed_bytes ?? 0)), 0);
  const crushSavedPct   = crushOrigBytes > 0 ? (crushSavedBytes / crushOrigBytes) * 100 : 0;
  const crushSavingsUsd = (crushSavedBytes / 4) * RATE('default').i / 1_000_000;

  const copilotSavingsUsd    = savingsUsd;

  // Tiered totals. harnessAttributable = required a harness decision/build (routing
  // policy, answer-cache hook, caveman skill, Copilot redirect). platformInherent
  // = Anthropic prompt caching, which fires automatically for anyone using Claude
  // Code — zero Titan code involved. Leadership headline = harness tier only;
  // blending platform-inherent savings into "what the harness did" doesn't survive
  // the first "did the harness do this?" question in the room.
  const harnessAttributableUsd = routingSavingsUsd + copilotSavingsUsd + answerCacheUsd + cavemanUsd + crushSavingsUsd;
  const platformInherentUsd    = cacheSavingsUsd;
  const totalSavingsUsd        = harnessAttributableUsd + platformInherentUsd;

  const harnessDenom      = harnessAttributableUsd + actualSpendUsd;
  const harnessDiscountPct = harnessDenom > 0 ? (harnessAttributableUsd / harnessDenom) * 100 : 0;

  // Annualization divisor: "All time" hardcodes daysBack to 365 (App.tsx /
  // Header.tsx PERIODS), so once real telemetry history is shorter than a
  // year — true for every workspace so far — (total / 365) * 365 collapses
  // to an identity and silently relabels the raw cumulative total as an
  // "annualized run-rate" instead of projecting it. Cap the divisor at the
  // actual number of days telemetry has been collecting data (first event
  // to now), floored at 1, so the projection reflects the real trailing
  // rate for whichever window is shorter — the selected period or history
  // itself. 7-day/30-day tabs are unaffected once real history exceeds them.
  const firstEventMs = events.length
    ? Math.min(...events.map((e) => new Date(e.ts).getTime()))
    : Date.now();
  const actualHistoryDays = Math.max(1, Math.ceil((Date.now() - firstEventMs) / 86_400_000));
  const annualizationDivisor = Math.min(period.daysBack, actualHistoryDays);

  const harnessAnnualizedUsd = annualizationDivisor > 0 ? (harnessAttributableUsd / annualizationDivisor) * 365 : 0;

  const savingsDenom         = totalSavingsUsd + actualSpendUsd;
  const effectiveDiscountPct = savingsDenom > 0 ? (totalSavingsUsd / savingsDenom) * 100 : 0;
  const annualizedSavingsUsd = annualizationDivisor > 0 ? (totalSavingsUsd / annualizationDivisor) * 365 : 0;

  // ── Section 2c: ROI (leadership view) ─────────────────────────────────
  // Cost-per-PR: exact spend ÷ merged PRs from the pr-stats overlay. Absent
  // overlay → null → tile shows "baseline pending". INTERNAL TREND ONLY —
  // no published benchmark exists for this metric.
  // Fixed in the 2.4.1 pre-ship audit: exact-key lookup only, no cross-period
  // fallback (was: an overlay missing a '365' period silently used the
  // 30-day PR count as the all-time denominator, inflating cost-per-PR
  // ~12x). Missing period → null → tile shows "baseline pending", never a
  // number computed against the wrong window.
  const periodKey = String(period.daysBack);
  const prCount = prStats?.periods?.[periodKey]?.prCount ?? null;
  const costPerPr = hasActualData && prCount != null && prCount > 0
    ? actualSpendUsd / prCount
    : null;

  // Cost per dev per ACTIVE day — benchmarked vs Anthropic's published ~$13.
  const userDays = new Set(
    actualUsageEvents.filter((e) => isValidUserHash(e.user)).map((e) => `${e.user}_${dateStr(e.ts)}`)
  ).size;
  const costPerDevDay = userDays > 0 ? actualSpendUsd / userDays : 0;

  const ticketsTouched = new Set(
    pe.filter((e) => e.tool === '_session_ticket')
      .map((e) => String(e.meta?.ticket ?? ''))
      .filter(Boolean)
  ).size;

  // Stability guardrail (DORA 2025: pair throughput/savings with a stability
  // counter-metric): governance hook-blocks per day.
  const blockTrendMap = new Map<string, number>();
  for (const e of pe.filter((ev) => ev.tool === '_hook_block')) {
    const d = dateStr(e.ts);
    blockTrendMap.set(d, (blockTrendMap.get(d) ?? 0) + 1);
  }
  const hookBlocksTrend = [...blockTrendMap.entries()].sort()
    .map(([date, count]) => ({ date, count }));

  const discountTrend = [...dailySavings.entries()].sort()
    .map(([date, { saved, spend }]) => ({
      date,
      pct: saved + spend > 0 ? (saved / (saved + spend)) * 100 : 0,
    }));

  // ── Section 3: Adoption ────────────────────────────────────────────
  // CLAUDE_ROLE env is the install-time role ("architect", "developer", etc.)
  // — it doesn't reflect which /mode the user typed. Map it to the closest mode.
  // prompt_class from cost_estimate events gives a secondary breakdown by work type.
  const ROLE_TO_MODE = ROLE_TO_MODE_STATIC;
  const CLASS_TO_LABEL: Record<string, string> = {
    architecture:    'Architecture work',
    code_generation: 'Code generation',
    code_review:     'Code review',
    refactor:        'Refactor',
    qa_short:        'Q&A / lookup',
    yes_no:          'Yes/no question',
    default:         'General',
  };

  const roleMap = new Map<string, number>();
  const classMap = new Map<string, number>();

  for (const e of pe) {
    const sn = String(e.meta?.skill_name ?? '');
    if (sn && ROLE_MODES.some((r) => sn.endsWith(r))) {
      // Explicit mode activation via Skill tool
      const role = ROLE_MODES.find((r) => sn.endsWith(r)) ?? sn;
      roleMap.set(role, (roleMap.get(role) ?? 0) + 1);
    } else if (e.tool === '_cost_estimate' || e.tool === 'unknown' || e.tool === '') {
      // Map install-time CLAUDE_ROLE to a mode for display
      const raw = (e.role ?? '').toLowerCase();
      const mode = ROLE_TO_MODE[raw] ?? raw;
      if (mode) roleMap.set(mode, (roleMap.get(mode) ?? 0) + 1);

      // Class breakdown as secondary proxy for work type
      const cls = String(e.meta?.class ?? '');
      if (cls && cls !== 'default') {
        const label = CLASS_TO_LABEL[cls] ?? cls;
        classMap.set(label, (classMap.get(label) ?? 0) + 1);
      }
    }
  }
  const byRole    = [...roleMap.entries()].map(([role, count]) => ({ role, count }))
                                          .sort((a, b) => b.count - a.count);
  const byWorkType = [...classMap.entries()].map(([label, count]) => ({ label, count }))
                                             .sort((a, b) => b.count - a.count);

  // Daily by role (for stacked area)
  const dailyRoleMap = new Map<string, Record<string, number>>();
  for (const e of pe) {
    const d = dateStr(e.ts);
    if (!dailyRoleMap.has(d)) dailyRoleMap.set(d, {});
    const day = dailyRoleMap.get(d)!;
    const r   = e.role || 'unknown';
    day[r] = (day[r] ?? 0) + 1;
  }
  const dailyByRole = [...dailyRoleMap.entries()].sort()
    .map(([date, counts]) => ({ date, ...counts }));

  // ── Section 4: Skills ──────────────────────────────────────────────
  const skillMap = new Map<string, number>();
  for (const e of pe) {
    const sn = String(e.meta?.skill_name ?? '');
    if (sn && !ROLE_MODES.some((r) => sn.endsWith(r))) {
      const short = sn.split('/').pop() ?? sn;
      skillMap.set(short, (skillMap.get(short) ?? 0) + 1);
    }
  }
  const top10 = [...skillMap.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const dead = SKILL_CATALOG.filter((s) => !skillMap.has(s) && !ROLE_MODES.some((r) => r.includes(s)));

  // ── Section 5: Safety ─────────────────────────────────────────────
  // NOTE (2.4.1 pre-ship audit): all four counts below are always 0 today.
  // credential-scan.py, protect-hybris-secrets.py, protect-skills.py, and
  // redact-customer-data.py never call emit_hook_block() — the only real
  // _hook_block producer is correction-scan.py (category
  // 'refusal-unverified', not one of these four). See
  // SafetyMetrics.instrumented in types.ts — the panels must render "not
  // instrumented", not "verified zero incidents", until that's wired.
  // Also fixed the category string for the fourth metric: the documented
  // _hook_block vocabulary (telemetry-emit.py) is
  // hybris-secret|credential|phi|skill-lock|mcp-unapproved — 'hard-stop'
  // was never a real category, so this filter could never match even after
  // wiring. Changed to 'skill-lock' (protect-skills.py's category).
  const hybrisBlocked = pe.filter((e) => e.tool === '_hook_block' && String(e.meta?.category).includes('hybris')).length;
  const credBlocked   = pe.filter((e) => e.tool === '_hook_block' && String(e.meta?.category).includes('credential')).length;
  const phiWarned     = pe.filter((e) => e.tool === '_hook_block' && String(e.meta?.category).includes('phi')).length;
  const hardBlocked   = pe.filter((e) => e.tool === '_hook_block' && String(e.meta?.category).includes('skill-lock')).length;
  const lastIncident  = events.filter((e) => e.tool === '_hook_block').map((e) => e.ts).sort().reverse()[0];
  const daysSince     = lastIncident
    ? Math.floor((Date.now() - new Date(lastIncident).getTime()) / 86_400_000)
    : period.daysBack;
  // Hardcoded false, not inferred from the (always-zero) counts above — see
  // the SafetyMetrics.instrumented doc comment. Flip to true only once
  // credential-scan.py / protect-hybris-secrets.py / protect-skills.py /
  // redact-customer-data.py are actually wired to emit_hook_block().
  const SAFETY_HOOKS_INSTRUMENTED = false;

  // ── Section 6: Productivity ────────────────────────────────────────
  const promptsPerSession = [...sessionMap.keys()].map((sid) =>
    pe.filter((e) => e.session === sid && e.tool === '_cost_estimate').length
  );
  const avgPPS  = promptsPerSession.length ? promptsPerSession.reduce((a, b) => a + b, 0) / promptsPerSession.length : 0;
  const p50PPS  = median(promptsPerSession);

  const bashMap = new Map<string, number>();
  for (const e of pe) {
    const prog = String(e.meta?.bash_program ?? '');
    if (prog) bashMap.set(prog, (bashMap.get(prog) ?? 0) + 1);
  }
  const topBash = [...bashMap.entries()].map(([program, count]) => ({ program, count }))
                                         .sort((a, b) => b.count - a.count).slice(0, 5);

  // Heatmap: hour × day-of-week (0=Sun), UTC.
  // Fixed in the 2.4.1 pre-ship audit: getDay()/getHours() read the
  // VIEWER's local timezone, but every event timestamp is written in UTC
  // (see telemetry-capture.py etc.) — two people viewing the same data in
  // different timezones would see different heatmap shapes. Using the UTC
  // getters makes the bucketing a fixed reference frame independent of who's
  // looking at the dashboard.
  const heatMap = new Map<string, number>();
  for (const e of pe) {
    const d = parseISO(e.ts);
    const key = `${d.getUTCDay()}_${d.getUTCHours()}`;
    heatMap.set(key, (heatMap.get(key) ?? 0) + 1);
  }
  const heatmap = [...heatMap.entries()].map(([k, count]) => {
    const [day, hour] = k.split('_').map(Number);
    return { day, hour, count };
  });

  // ── Section 7: Per-user ───────────────────────────────────────────
  const userSet = [...new Set(pe.map((e) => e.user).filter(isValidUserHash))];
  const userRows = userSet.map((hash) => {
    const ue = pe.filter((e) => e.user === hash);
    const uSessions = new Set(ue.map((e) => e.session)).size;
    const roleCount = new Map<string, number>();
    const skillCount = new Map<string, number>();
    const modelCount = new Map<string, number>();
    let estSpend = 0;
    let prompts = 0;
    for (const e of ue) {
      roleCount.set(e.role, (roleCount.get(e.role) ?? 0) + 1);
      const sn = String(e.meta?.skill_name ?? '');
      if (sn) skillCount.set(sn, (skillCount.get(sn) ?? 0) + 1);
      const m = String(e.meta?.model ?? 'default');
      modelCount.set(m, (modelCount.get(m) ?? 0) + 1);
      if (e.tool === '_cost_estimate') {
        estSpend += Number((e.meta?.cost_max_usd as number) ?? 0);
        prompts += 1;
      }
    }
    const topRole  = [...roleCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
    const topSkill = [...skillCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split('/').pop() ?? '—';
    const topModel = [...modelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
    const costPerSession = uSessions > 0 ? estSpend / uSessions : 0;
    const costPerPrompt = prompts > 0 ? estSpend / prompts : 0;
    const promptsPerSession = prompts > 0 ? prompts / uSessions : 0;
    return { hash, sessions: uSessions, prompts, topRole, topSkill, topModel, estSpendUsd: estSpend, costPerSession, costPerPrompt, promptsPerSession };
  }).sort((a, b) => b.sessions - a.sessions).slice(0, 10);

  // ── Section 8: Trend ──────────────────────────────────────────────
  const dailyPromptMap  = new Map<string, number>();
  const dailyActiveMap  = new Map<string, Set<string>>();
  for (const e of pe) {
    const d = dateStr(e.ts);
    if (e.tool === '_cost_estimate') dailyPromptMap.set(d, (dailyPromptMap.get(d) ?? 0) + 1);
    if (isValidUserHash(e.user)) {
      if (!dailyActiveMap.has(d)) dailyActiveMap.set(d, new Set());
      dailyActiveMap.get(d)!.add(e.user);
    }
  }
  const promptsPerDay   = [...dailyPromptMap.entries()].sort().map(([date, count]) => ({ date, count }));
  const activeUsersPerDay = [...dailyActiveMap.entries()].sort().map(([date, s]) => ({ date, count: s.size }));

  // ── Section 2f — Correction cost (facts). Also feeds the ROI net-value bridge. ──
  const correction = computeCorrection(events, period, correctionStats ?? null);

  return {
    period,
    generatedAt: new Date().toISOString(),
    eventCount: pe.length,
    snapshot: {
      activeUsers: users.size,
      sessions: sessions.size,
      prompts: prompts.length,
      avgSessionMinutes: Math.round(avgSessionMinutes),
      deltaUsers:   pu2.size  > 0 ? users.size  - pu2.size  : null,
      deltaPrompts: pp2.length > 0 ? prompts.length - pp2.length : null,
    },
    cost: {
      totalEstUsd:      totalEst,
      last7dEstUsd:     last7dEst,
      todayEstUsd:      todayEst,
      savingsUsd,
      byModel,
      dailyCost,
      copilotRedirects: redirectEvents.length,
      totalInputTokens,
      totalOutputTokens,
      totalCacheRead,
      hasActualData,
    },
    savings: {
      cacheSavingsUsd,
      routingSavingsUsd,
      copilotSavingsUsd,
      answerCacheUsd,
      answerCacheHits,
      cavemanUsd,
      crushHits,
      crushOrigBytes,
      crushSavedBytes,
      crushSavedPct,
      crushSavingsUsd,
      harnessAttributableUsd,
      platformInherentUsd,
      totalSavingsUsd,
      actualSpendUsd,
      effectiveDiscountPct,
      harnessDiscountPct,
      annualizedSavingsUsd,
      harnessAnnualizedUsd,
      hasActualData,
      bySource: [
        { source: 'Model routing (vs all-Opus)', usd: routingSavingsUsd, basis: 'assumption' as const, tier: 'harness' as const },
        { source: 'Deterministic answer cache',   usd: answerCacheUsd,    basis: 'estimate'   as const, tier: 'harness' as const,
          detail: `${answerCacheHits} zero-token hit(s) — the count is exact; the $ uses rolling avg prompt cost` },
        { source: 'Output compression (caveman)', usd: cavemanUsd,        basis: 'estimate'   as const, tier: 'harness' as const,
          detail: 'session-level 0.39 factor (Better Stack benchmark, Apr 2026) — pending internal A/B' },
        { source: 'Copilot deflection',           usd: copilotSavingsUsd, basis: 'estimate'   as const, tier: 'harness' as const },
        { source: 'Input compression (crush)',    usd: crushSavingsUsd,   basis: 'estimate'   as const, tier: 'harness' as const,
          detail: `${crushHits} event(s), ${(crushSavedBytes / 1024).toFixed(0)} KB elided (${crushSavedPct.toFixed(0)}% avg) — bytes/events/% are exact; the $ uses bytes÷4 × input rate` },
        { source: 'Prompt caching',              usd: cacheSavingsUsd,   basis: 'fact'       as const, tier: 'platform' as const,
          detail: 'Anthropic platform behavior, automatic — not built by Titan. Shown for total-cost context, excluded from the harness-attributable headline.' },
      ],
    },
    roi: {
      costPerPr,
      prCount,
      spendUsd: actualSpendUsd,
      harnessSavingsUsd: harnessAttributableUsd,
      harnessDiscountPct,
      harnessRunRateUsd: harnessAnnualizedUsd,
      totalSavingsUsd,
      effectiveDiscountPct,
      savingsRunRateUsd: annualizedSavingsUsd,
      platformInherentUsd,
      costPerDevDay,
      anthropicBenchmarkUsd: ANTHROPIC_COST_PER_DEV_DAY_USD,
      cacheHitCount: answerCacheHits,
      ticketsTouched,
      hookBlocksTrend,
      hookBlocksInstrumented: SAFETY_HOOKS_INSTRUMENTED,
      discountTrend,
      reworkWasteUsd:     correction.wastedCostUsd,
      reworkRatio:        correction.reworkTokenRatio,
      netHarnessValueUsd: harnessAttributableUsd - correction.wastedCostUsd,
      spiralsContained:   correction.spiralsContained,
      hasActualData,
    },
    correction,
    adoption: { byRole, dailyByRole, byWorkType },
    skills: { top10, dead },
    safety: { hybrisBlocked, credBlocked, phiWarned, hardStopBlocked: hardBlocked, daysSinceIncident: daysSince, instrumented: SAFETY_HOOKS_INSTRUMENTED },
    productivity: { avgPromptsPerSession: avgPPS, p50PromptsPerSession: p50PPS, topBashPrograms: topBash, heatmap },
    users: userRows,
    trend: { promptsPerDay, costPerDay: dailyCost, activeUsersPerDay },
  };
}
