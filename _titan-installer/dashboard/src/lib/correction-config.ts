// Correction-cost (cost-of-hallucinations) config — MIRRORS harness/pricing.json
// "correction" block. Keep the two in sync (super role).
//
// Basis: FACT. Unlike caveman-config.ts, nothing here is an assumption. These are
// measurement bounds and threshold parameters only — every dashboard number they
// feed is a real billed dollar (cost_usd), a measured minute, or a count. There is
// deliberately NO hourly rate and NO severity->minutes table.

// Measurement bound: a "correction episode" sums the human gap between an assistant
// answer and the next user prompt. Each gap is capped at this many seconds so idle
// time (lunch, meetings) never inflates measured time-to-correct.
export const CORRECTION_IDLE_CAP_SECONDS = 300;

// Tool failures counted as hallucination signals. edit_string_not_unique is NOT
// here on purpose — that is ambiguity, not a hallucination (kept honest).
export const CORRECTION_TOOL_ERROR_CLASSES = new Set([
  'edit_string_not_found',
  'file_not_found',
  'bash_nonzero',
]);

// Dashboard alert threshold — fires on the MEASURED rework-token ratio vs its own
// rolling baseline. No assumption is involved in the alert.
export const CORRECTION_THRESHOLD = {
  metric: 'rework_token_ratio' as const,
  rollingWindowDays: 14,
  baselineMultiplier: 1.5,
  minEventsForBaseline: 5,
};
