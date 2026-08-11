# /cost-report — Token Usage and Budget Report

Generate a cost report showing token spend by model, by mode, and against budget for the current session, day, week, or month. Complements Caveman by quantifying the compression savings.

**Caveman intensity for this skill:** `lite`. Budget alerts are decision-critical — keep them readable.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). Budget HARD_STOP alerts (utilization ≥ 100%) must be uncompressed regardless. Respect `stop caveman` if user issues it.

## Origin

Adapted from RuvNet `ruflo-cost-tracker` plugin (`cost-report`, `cost-budget-check`, `cost-summary` patterns). The plugin itself is NOT installed per the approved-plugins registry (`/common/plugin-policy`). This is a native re-implementation that uses local files (no external AgentDB / vector store) and project-specific pricing.

## When to use

- End of work session — what did this task cost?
- Weekly — are we tracking to budget?
- Before spawning a multi-agent `/parallel-review` — check budget headroom first
- When the user asks "how much have I burned today?"

## Where usage data lives

Exact usage is recorded by the Titan Stop hook (`stop-usage-capture.py`) in `.claude/telemetry/events-YYYY-MM-DD.jsonl` (one JSON line per event). **Use only events where `tool == "_actual_usage"`** — these carry billed-exact token counts read from the session transcript, deduplicated by message id. Each `_actual_usage` line has:

```json
{
  "v": 1,
  "ts": "2026-05-16T14:23:45Z",
  "user": "<hashed>",
  "role": "arch-mode | dev-mode | lead-review | grill-me | none",
  "tool": "_actual_usage",
  "session": "<id>",
  "meta": {
    "source": "stop_hook_transcript",
    "model": "claude-opus-4-7 | claude-sonnet-4-6 | claude-haiku-4-5",
    "input_tokens": 12345,
    "output_tokens": 678,
    "cache_creation_tokens": 0,
    "cache_read_tokens": 5000,
    "total_tokens": 18023,
    "cost_usd": 0.123456
  }
}
```

Note: files may be renamed to `events-YYYY-MM-DD.uploaded.jsonl` after the telemetry uploader runs — include both patterns when aggregating.

If no `_actual_usage` events exist for the period, output `No exact usage data for the period — the Stop hook (stop-usage-capture.py) has not recorded any sessions yet.` and stop. Do not fall back to `_cost_estimate` events (pre-flight guesses, not billed reality).

## Pricing — single source of truth

**Do not maintain a pricing table in this skill.** Read per-model rates from `pricing.json` (workspace `.claude/pricing.json`, falling back to `pricing.json` at the workspace root) — the same table used by `cost-estimate.py` and the Stop hook. `meta.cost_usd` on each `_actual_usage` event is already computed at capture time; prefer summing `cost_usd` directly. Recompute from tokens × pricing.json rates only when validating.

If a record uses a variant model name (e.g. `claude-opus-4-7[1m]` 1M context), use the base model's pricing.

## Steps

### Step 1 — Choose the period

Default: today. Other values: `session`, `week`, `month`, `all`.

```bash
# Today (include uploaded variants)
ls <workspace>/.claude/telemetry/events-$(date +%Y-%m-%d)*.jsonl

# Week
ls <workspace>/.claude/telemetry/events-*.jsonl | sort | tail -7
```

### Step 2 — Aggregate

Filter to `tool == "_actual_usage"`. Sum `meta.cost_usd` and the token fields (`input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`) per `(meta.model, role)` combination.

### Step 3 — Read budget config

The budget config lives at `<workspace>/.claude/telemetry/budget.json`:

```json
{
  "monthly_budget_usd": 100.00,
  "per_session_warning_usd": 5.00,
  "alert_thresholds": [0.50, 0.75, 0.90, 1.00]
}
```

If the file is missing, output a one-line note `No budget configured — run /cost-report set-budget <usd-amount>/month` and continue with the spend report.

### Step 4 — Compute the alert level

Utilization = (spend so far this month) / (monthly_budget_usd)

| Utilization | Level | Symbol | Action |
|-------------|-------|--------|--------|
| < 50% | OK | 🟢 | None |
| 50–74% | INFO | 🟡 | Note in report |
| 75–89% | WARNING | 🟠 | Recommend reviewing high-cost modes |
| 90–99% | CRITICAL | 🔴 | Recommend Caveman ultra + Haiku-only mode |
| ≥ 100% | HARD_STOP | 🛑 | **Output Escalation Alert.** Stop spawning multi-agent skills. Recommend pausing non-critical work. |

### Step 5 — Output the report

Structure:

```
=== Titan Token Cost Report ===
Period: <today|week|month|all>  |  Generated: <YYYY-MM-DD HH:MM>

Total spend:        $XX.XX   (exact — billed usage from Stop hook)
Monthly budget:     $YYY.YY
Utilization:        ZZ% [🟢 OK | 🟡 INFO | 🟠 WARNING | 🔴 CRITICAL | 🛑 HARD_STOP]
Sessions counted:   N

By model:
  claude-opus-4-7   $A.AA (NN%)    M.M input / O.O output / cache: $C.CC
  claude-sonnet-4-6 $B.BB (NN%)    ...
  claude-haiku-4-5  $D.DD (NN%)    ...

By mode:
  /arch-mode        $E.EE (NN%)    P calls, avg $X/call
  /dev-mode         $F.FF (NN%)    ...
  /lead-review      $G.GG (NN%)    ...
  /grill-me         $I.II (NN%)    ...
  (no mode)         $J.JJ (NN%)    ← target for reduction

Caveman saving estimate (ESTIMATE — labeled, not booked):
  Output tokens in caveman-active roles × per-model output rate × session_compression_factor
  (factor from pricing.json "caveman" block — evidence-based multi-turn figure, not the 75% claim)
  Estimated saved cost: $K.KK

Active alerts:
  <list of triggered alert levels with recommended actions>

Recommended actions:
  <list — e.g. "Move 3 high-volume /dev-mode calls to Haiku via Agent subagents">
```

### Step 6 — On HARD_STOP, emit the Escalation Alert

```
ESCALATION REQUIRED -- STOP WORK
Reason:  Token budget HARD_STOP (utilization >= 100%)
Area:    Monthly budget exhausted
Action:  Stop > Halt non-critical agent spawns > Contact the owner for this area (see the Titan session header; `?gov <path>` for a specific file) to revise budget OR
         pause non-critical work until next budget cycle > Record alert in PR description if mid-work
```

## Budget management commands

```bash
# View
cat <workspace>/.claude/telemetry/budget.json

# Set monthly budget (USD)
echo '{"monthly_budget_usd": 100.00, "per_session_warning_usd": 5.00, "alert_thresholds": [0.50, 0.75, 0.90, 1.00]}' > <workspace>/.claude/telemetry/budget.json
```

## Governance

- The telemetry files (`events-*.jsonl`, `budget.json`) live in `.claude/telemetry/` which IS inside the governance-locked `.claude/`. Usage events are written by Titan hooks, not by a user. `super` role can adjust the budget config.
- This skill is READ-ONLY for usage data — never edits `events-*.jsonl`.
- Cost reports may be shared with Finance (the owner for this area handles — see the Titan session header; `?gov <path>` for a specific file). No PHI/PII in the telemetry files since they only contain token counts, model names, role names, hashed user ids, and timestamps.

## Permissions

Allowed: Read `.claude/telemetry/*.jsonl`, `budget.json`, and `pricing.json`. Write to `.claude/telemetry/budget.json` only when user explicitly invokes `/cost-report set-budget <amount>`.
Blocked: Editing usage records (they are an audit trail). Sending cost data to external services.
