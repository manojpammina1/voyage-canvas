// Caveman output-compression savings config — MIRRORS harness/pricing.json
// "caveman" block. Keep the two in sync (super role).
//
// Basis: ESTIMATE. Factor 0.39 = the measured multi-turn SESSION saving from the
// Better Stack caveman benchmark (Apr 2026, 10-prompt sample) — deliberately NOT
// the ~75% per-prompt claim. Single isolated queries can be net-negative due to
// skill-load overhead, which is why this is modeled at session level only.
// Replace with internal A/B measurement when available. Finance sign-off
// required before external use.

export const CAVEMAN_SESSION_COMPRESSION_FACTOR = 0.39;

// Modes where caveman auto-engages (per caveman SKILL.md per-role table).
// Telemetry events carry the install-time CLAUDE_ROLE (e.g. "developer"),
// so aggregation maps role → mode first; unmapped roles are NOT counted
// (conservative undercount, never overcount).
export const CAVEMAN_ACTIVE_MODES = new Set([
  'arch-mode', 'dev-mode', 'lead-review', 'grill-me', 'qa-mode',
  'sre-mode', 'designer-mode', 'unit-test', 'pr-create', 'offshore-brief',
]);

// Anthropic-published peer benchmark: "average cost is around $13 per developer
// per active day" (code.claude.com/docs/en/costs). Reference line on the ROI tile.
export const ANTHROPIC_COST_PER_DEV_DAY_USD = 13;
