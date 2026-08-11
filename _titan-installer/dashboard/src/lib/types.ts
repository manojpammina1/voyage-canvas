export interface TelemetryEvent {
  v:        number;
  ts:       string;           // ISO UTC
  user:     string;           // 16-hex anonymous hash
  role:     string;           // CLAUDE_ROLE env value
  tool:     string;           // tool name or _cost_estimate / _copilot_redirect
  session:  string;
  meta?:    Record<string, unknown>;
}

export interface AggPeriod {
  label:             string;
  daysBack:          number;
}

// Section 1
export interface PilotSnapshot {
  activeUsers:       number;
  sessions:          number;
  prompts:           number;
  avgSessionMinutes: number;
  deltaUsers:        number | null;  // vs prior period
  deltaPrompts:      number | null;
}

// Section 2
export interface CostMetrics {
  totalEstUsd:        number;
  last7dEstUsd:       number;
  todayEstUsd:        number;
  savingsUsd:         number;
  byModel:            { model: string; usd: number; pct: number }[];
  dailyCost:          { date: string; usd: number }[];
  copilotRedirects:   number;
  // Exact token counts (only populated when _actual_usage events exist)
  totalInputTokens:   number;
  totalOutputTokens:  number;
  totalCacheRead:     number;
  hasActualData:      boolean;   // true = exact via Stop hook/OTEL; false = pre-flight estimate
}

// Section 2b — Savings (leadership view). Every figure is itemized with its
// basis so nothing reads as a fabricated number:
//   'fact'       = billed reality (e.g. Anthropic cache discount)
//   'assumption' = real usage vs a stated counterfactual baseline
//   'estimate'   = heuristic
export interface SavingsMetrics {
  cacheSavingsUsd:       number;   // FACT — cache-read billed below input rate (PLATFORM tier — Anthropic, not harness-built)
  routingSavingsUsd:     number;   // ASSUMPTION — vs all-Opus baseline (HARNESS tier — harness model-routing policy)
  copilotSavingsUsd:     number;   // ESTIMATE — Q&A deflected to Copilot (HARNESS tier)
  answerCacheUsd:        number;   // ESTIMATE — zero-token deterministic answers (HARNESS tier; hits are FACT)
  answerCacheHits:       number;   // FACT — count of _cache_hit events
  cavemanUsd:            number;   // ESTIMATE — output compression, session-level factor (HARNESS tier)
  // Input compression (crush, v2.4). Events/bytes/% are FACT — read directly
  // off _crush telemetry, never adjusted. crushSavingsUsd is a SEPARATE,
  // clearly-labeled ESTIMATE (bytes÷4 × input rate — no Opus counterfactual,
  // no cache credit) layered on top, same pattern as answerCacheUsd/cavemanUsd.
  crushHits:             number;   // FACT — count of _crush events
  crushOrigBytes:        number;   // FACT — Σ orig_bytes from _crush events
  crushSavedBytes:       number;   // FACT — Σ (orig_bytes − crushed_bytes)
  crushSavedPct:         number;   // FACT — weighted avg compression % (saved ÷ orig)
  crushSavingsUsd:       number;   // ESTIMATE — bytes÷4 × input rate (HARNESS tier); pending internal A/B
  // Tiered totals — see note below. Leadership headline = harnessAttributableUsd,
  // NOT totalSavingsUsd: prompt caching happens automatically the instant anyone
  // uses Claude Code — no Titan code or decision produces it. Blending it into
  // one number invites (and loses) the question "did the harness do this?"
  harnessAttributableUsd: number;  // routing + copilot + answerCache + caveman — required a harness decision/build
  platformInherentUsd:    number;  // prompt caching only — Anthropic platform behavior, not harness work
  totalSavingsUsd:       number;   // all-in = harnessAttributableUsd + platformInherentUsd (kept for cost-report/back-compat)
  actualSpendUsd:        number;   // exact spend (for the ratio)
  effectiveDiscountPct:  number;   // all-in: totalSavingsUsd / (totalSavingsUsd + spend)
  harnessDiscountPct:    number;   // harness-only: harnessAttributableUsd / (harnessAttributableUsd + spend) — the defensible leadership number
  annualizedSavingsUsd:  number;   // PROJECTION at current ALL-IN run-rate
  harnessAnnualizedUsd:  number;   // PROJECTION at current HARNESS-ONLY run-rate — use this one for leadership
  hasActualData:         boolean;
  bySource:              { source: string; usd: number; basis: 'fact' | 'assumption' | 'estimate'; tier: 'harness' | 'platform'; detail?: string }[];
}

// Merged-PR stats overlay (scripts/build-pr-stats.mjs → public/pr-stats.json).
// Gitignored, dashboard-host-only. Absent file → costPerPr stays null and the
// ROI tile shows "baseline pending" — the dashboard never invents the number.
export interface PrStats {
  generated: string;
  periods: Record<string, { prCount: number; byRepo: Record<string, number | null> }>;
}

// Downstream correction-record overlay (scripts/build-correction-stats.mjs →
// public/correction-stats.json). Gitignored, dashboard-host-only. Absent file OR
// invalid PAT → every field null and the Correction section shows "ADO pending".
// null (not 0) always means "unknown/not counted", never "zero occurred".
export interface CorrectionStats {
  generated: string;
  reason?:   string;   // set when the overlay is a null placeholder (e.g. 'missing-credentials')
  periods: Record<string, {
    prCount:          number | null;
    reworkIterations: number | null;  // Σ extra PR iterations after first review
    changesRequested: number | null;  // reviewers voting ≤ −5 (undercount, never over)
    ciFails:          number | null;  // failed pipeline builds in window
    byRepo:           Record<string, unknown>;
  }>;
}

// Section 2c — ROI (leadership view). Cost-per-PR is an INTERNAL TREND metric:
// no published industry benchmark exists (closest: DX "cost per task").
// costPerDevDay is benchmarked against Anthropic's published averages.
export interface RoiMetrics {
  costPerPr:             number | null;  // exact spend ÷ merged PRs (null until pr-stats.json present)
  prCount:               number | null;
  spendUsd:              number;
  // Leadership headline = harness-attributable (what Titan built), NOT the
  // all-in total (which includes Anthropic's automatic prompt-caching discount —
  // that requires zero harness work and isn't something the harness "did").
  harnessSavingsUsd:      number;
  harnessDiscountPct:     number;
  harnessRunRateUsd:      number;         // PROJECTION — harness-only annualized
  totalSavingsUsd:       number;         // all-in, kept for reference/back-compat
  effectiveDiscountPct:  number;         // all-in
  savingsRunRateUsd:     number;         // all-in PROJECTION — annualized
  platformInherentUsd:    number;         // Anthropic prompt-caching discount — context, not credit
  costPerDevDay:         number;         // exact spend ÷ active user-days
  anthropicBenchmarkUsd: number;         // ~$13/dev/active-day (code.claude.com/docs/en/costs)
  cacheHitCount:         number;
  ticketsTouched:        number;         // distinct tickets from _session_ticket
  hookBlocksTrend:       { date: string; count: number }[];  // stability guardrail (DORA pairing)
  // Mirrors SafetyMetrics.instrumented (types.ts) — same underlying gap.
  // False today: the four hooks this trend is meant to track never emit
  // _hook_block. An empty trend must render "not instrumented", not "zero
  // blocks, guardrails quiet".
  hookBlocksInstrumented: boolean;
  discountTrend:         { date: string; pct: number }[];    // effective discount %/day
  // Correction-cost integration (facts-only net-value bridge). See CorrectionMetrics
  // for the full detail; these summarise it INTO the ROI story.
  reworkWasteUsd:        number;   // FACT — real billed cost_usd spent on corrections (the deduction)
  reworkRatio:           number;   // FACT — rework tokens / total tokens (DORA quality counter-metric)
  netHarnessValueUsd:    number;   // FACT-based — harnessSavingsUsd − reworkWasteUsd
  spiralsContained:      number;   // FACT — count of spiral_break circuit-breaker trips
  hasActualData:         boolean;
}

// Section 3
export interface AdoptionMetrics {
  byRole:            { role: string; count: number }[];
  dailyByRole:       { date: string; [role: string]: number | string }[];
  byWorkType:        { label: string; count: number }[];  // proxy from prompt class
}

// Section 4
export interface SkillsMetrics {
  top10:             { skill: string; count: number }[];
  dead:              string[];         // skills in catalog with 0 uses
}

// Section 5
export interface SafetyMetrics {
  hybrisBlocked:     number;
  credBlocked:       number;
  phiWarned:         number;
  hardStopBlocked:   number;
  daysSinceIncident: number;
  // False today (2.4.1 pre-ship audit finding): credential-scan.py,
  // protect-hybris-secrets.py, protect-skills.py, and redact-customer-data.py
  // — the four hooks these counts claim to summarize — never call
  // emit_hook_block(). The only real _hook_block producer is
  // correction-scan.py, category 'refusal-unverified', which isn't one of
  // these four. So all four counts above are ALWAYS 0 by construction, not
  // because guardrails are quiet — there is no code path that could ever
  // make them nonzero yet. Set this to true only once those hooks are
  // actually wired to emit_hook_block(); until then the UI must not present
  // 0 as "verified zero incidents".
  instrumented: boolean;
}

// Section 6
export interface ProductivityMetrics {
  avgPromptsPerSession:  number;
  p50PromptsPerSession:  number;
  topBashPrograms:       { program: string; count: number }[];
  heatmap:               { hour: number; day: number; count: number }[];  // 0=Sun
}

// Section 7
export interface UserRow {
  hash:              string;
  sessions:          number;
  prompts:           number;    // total prompts from _cost_estimate events
  topRole:           string;
  topSkill:          string;
  topModel:          string;    // most-used model (computed but hidden; await model tracking in future patch)
  estSpendUsd:       number;
  costPerSession:    number;    // estSpendUsd / sessions
  costPerPrompt:     number;    // estSpendUsd / prompts
  promptsPerSession: number;    // prompts / sessions
}

// Section 8
export interface TrendMetrics {
  promptsPerDay:   { date: string; count: number }[];
  costPerDay:      { date: string; usd: number }[];
  activeUsersPerDay: { date: string; count: number }[];
}

// Section 2f — Correction cost ("cost of AI hallucinations"). Everything here is
// a MEASURED FACT: real billed cost_usd, measured minutes (idle-capped), counts,
// and git/ADO records. No monetary assumption exists — no hourly rate.
export interface CorrectionMetrics {
  // Headline facts
  wastedCostUsd:        number;   // FACT — real billed cost_usd of correction turns
  wastedTokens:         number;   // FACT
  totalPeriodTokens:    number;   // FACT — denominator for the ratio
  reworkTokenRatio:     number;   // FACT — wastedTokens / totalPeriodTokens
  toolErrorRate:        number;   // FACT — counted tool errors / file+bash tool calls
  correctionCount:      number;   // FACT — number of correction episodes
  correctionRate:       number;   // FACT — episodes / assistant turns
  medianTimeToCorrectSec: number; // FACT — measured, idle-capped human detect/fix time
  // Breakdown facts
  toolErrorsByClass:    { errorClass: string; count: number }[];
  correctionsBySignal:  { signal: string; count: number }[];
  byModel:              { model: string; corrections: number; assistantTurns: number; ratePer100: number }[];
  // Avoided side — COUNTS only (a non-event has no measurable cost)
  avoidedCount:         number;   // _hook_block incl. refusal-unverified
  refusalCount:         number;   // "I cannot confirm this" catches
  // Circuit-breaker containment (facts)
  spiralsContained:     number;   // spiral_break trips
  spiralWarnings:       number;   // spiral_warn trips
  // Threshold + trend (fact-driven, no assumption)
  perDay:               { date: string; wastedUsd: number; reworkRatio: number; baseline: number | null; alert: boolean }[];
  perDevAlerts:         { hash: string; corrections: number; wastedUsd: number; reworkRatio: number; alert: boolean }[];
  // Downstream records (Layer B) — null when ADO overlay absent/PAT invalid
  records:              { revertCount: number | null; prIterations: number | null; changesRequested: number | null; ciFails: number | null; adoPending: boolean };
  hasData:              boolean;  // any correction signal present this period
}

export interface Aggregations {
  period:       AggPeriod;
  generatedAt:  string;
  snapshot:     PilotSnapshot;
  cost:         CostMetrics;
  savings:      SavingsMetrics;
  roi:          RoiMetrics;
  correction:   CorrectionMetrics;
  adoption:     AdoptionMetrics;
  skills:       SkillsMetrics;
  safety:       SafetyMetrics;
  productivity: ProductivityMetrics;
  users:        UserRow[];
  trend:        TrendMetrics;
  eventCount:   number;
}
