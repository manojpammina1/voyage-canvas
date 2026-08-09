# Cost Estimator — Phase 3: Estimate vs Actual Reconciliation

**Status:** Designed, not implemented. Blocked on Anthropic billing data export.
**Target:** v1.2 of the Titan harness.

## Goal

Compare the hook's pre-flight estimates (Phase 1) against actual Anthropic billing once a month, so we can:

1. **Tune the heuristics** — if estimates run 8% low on `code_review` class, bump the multiplier.
2. **Surface accuracy to users** — "Your estimates this month were 92% accurate vs actual billing."
3. **Detect drift** — if Anthropic changes pricing without us updating `pricing.json`, the reconciliation flags the delta immediately.

## Why this is Phase 3 (blocked)

Anthropic provides monthly billing data via:

- **Console export** (CSV) — manual download from `console.anthropic.com` by the org admin.
- **API metrics endpoint** — `https://api.anthropic.com/v1/admin/usage` requires admin API key.

An adopter running this would need:

- Engineering Leadership / Finance to designate a billing-data owner (the toolkit maintainer by default).
- A monthly cadence: pull the CSV, drop it in a known internal location.
- A reconciler script that joins per-session `_cost_estimate` telemetry events with the billing CSV rows.

Until the data ingestion path is set up, the reconciler has nothing to compare against.

## Proposed implementation

### Files to add (when Phase 3 starts)

```
harness/scripts/reconcile-cost.py    # Python script — joins telemetry + billing CSV
harness/docs/billing-data-flow.md    # Operating runbook for the monthly job
electron/cost-reconciler.ts          # Optional UI for one-click monthly reconcile in Dashboard
```

### Data flow

```
Anthropic Console (monthly CSV)
        │
        ▼
   <secure internal location>     ← toolkit maintainer uploads after monthly billing
        │
        ▼
reconcile-cost.py
        │  joins on (session_id, date)
        ▼
   reconciliation-2026-MM.jsonl
        │
        ▼
Dashboard "Cost Accuracy" tile
        │
        ▼
   Update pricing.json multipliers if drift > 10%
```

### Reconciliation join key

| Field | Source | Notes |
|---|---|---|
| `session_id` | both | Truncated 32-char ID; assumes uniqueness |
| `model` | both | e.g. `claude-sonnet-4-6` |
| `date` (YYYY-MM-DD) | both | Day-level join |

Aggregate per session: sum `est_min/est_max` vs actual `input_tokens × rate + output_tokens × rate`.

### Output report

```
Titan Cost Reconciliation — 2026-08
=======================================
Sessions reconciled:    142
Estimate accuracy:      92.4% (median)
Total estimated:        $128.40
Total actual billed:    $138.96
Drift:                  +8.2%

Drift by class:
  code_generation     +3%   (162 prompts)   →  no tuning needed
  code_review        +14%   (87 prompts)    →  bump multiplier 1.10 → 1.14
  qa_short           -22%   (34 prompts)    →  bump multiplier 0.78 → 0.95
  architecture       +5%    (12 prompts)    →  no tuning

Pricing drift check:
  All models match harness/pricing.json   ✓

Recommendation:
  Update harness/pricing.json prompt_class_heuristics for code_review and qa_short.
  Re-deploy harness via re-install or OTA when v1.1 lands.
```

### Privacy considerations

- Billing CSV from Anthropic includes only org-level usage — no per-user breakdown unless the adopter uses per-user API keys.
- Telemetry events include hashed user IDs but no prompt content.
- Reconciliation output stays internal to the adopter — no upload to Anthropic.

## What needs to happen first (Phase 2 -> Phase 3 transition)

| Step | Owner | When |
|---|---|---|
| 1. Engineering Leadership confirms the toolkit maintainer as billing-data owner | Leadership | Pre-Phase 3 |
| 2. Toolkit maintainer sets up monthly cadence to download Anthropic CSV | Toolkit maintainer | First month of v1.1 telemetry data |
| 3. Decide on secure internal storage location for the CSV | Toolkit maintainer + IT | Same |
| 4. Implement `reconcile-cost.py` | Toolkit maintainer | Phase 3 sprint |
| 5. Add Dashboard "Cost Accuracy" tile | Toolkit maintainer | Phase 3 sprint |
| 6. Document the monthly runbook | Toolkit maintainer | Phase 3 sprint |
| 7. Establish drift thresholds for pricing updates | Toolkit maintainer + Finance | Phase 3 sprint |

## Decision triggers for moving to Phase 3

Start Phase 3 work when ALL three are true:

- Phase 2 telemetry has been live for ≥ 30 days
- Pilot is at ≥ 5 users uploading consistently
- Anthropic CSV access is confirmed for the org admin

If any is false, defer. Don't build a reconciler against zero data.

## Effort estimate

| Item | Effort |
|---|---|
| `reconcile-cost.py` | 4 hr |
| Dashboard tile + IPC | 3 hr |
| Monthly runbook documentation | 1 hr |
| Drift threshold tuning | 1 hr (after first reconciliation) |
| **Total Phase 3** | **~9 hr** |

## Ownership

- **Phase 3 design:** the toolkit maintainer (`?gov who owns architecture`)
- **Billing data ingestion:** the toolkit maintainer (with Finance read access if separate)
- **Reconciler maintenance:** the toolkit maintainer
- **Pricing.json updates:** the toolkit maintainer (via harness governance file lock)
