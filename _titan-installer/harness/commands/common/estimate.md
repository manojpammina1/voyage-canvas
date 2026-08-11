# /estimate -- Pre-flight Cost & Token Estimator

Estimates what a prompt would cost in tokens + USD before you send it to Claude. Use this when you want to check a heavy prompt (long pasted code, multi-file refactor request) without firing the actual call.

## How to invoke

```
/common/estimate <your prompt text>
```

or paste the prompt text on the next line after invoking with no arg. The skill reads what you typed and runs the estimator logic without sending the prompt to Claude.

## What it returns

```
Titan estimate
==================
Model:      Sonnet 4.6 (active)
Input:      ~12,500 tokens (3,000 carrier + 9,500 prompt)
Output:     ~800 – 1,200 tokens   (class: code_review)
Cost:       $0.05 – $0.07

This session so far:  17 prompts · ~$0.42 total

Same prompt on other models:
  - Haiku 4.5      ~$0.012    /model haiku
  - Opus 4.7       ~$0.27     /model opus

Cheaper alternatives:
  - MS Copilot Enterprise (free, internal)   /common/copilot

Tokeniser source: tiktoken (cl100k_base, ~90% accurate vs Claude tokeniser)
```

## When to use

| Scenario | Estimate first? |
|----------|------------------|
| Pasting > 100 lines of code | Yes — likely > $0.05 |
| Long context required (file refs, schemas) | Yes |
| Cross-repo refactor request | Yes — likely > $0.50 |
| Simple Q&A ("what does X do?") | No — answer is < $0.01 |
| Code review of a small diff | Optional |

## Rules

- **Does NOT send the prompt to Claude.** Just estimates.
- **Privacy:** tokenises locally; does not log the prompt text.
- **Telemetry:** records the estimate metadata (no prompt content) per the regular Titan telemetry rules.
- **Sensitive-prompt scan:** if the prompt contains a Hybris config path, PAT pattern, or private key marker, refuses with the same hard-stop alert as the active `cost-estimate.py` hook.

## Related

- Auto-warning: every prompt is auto-estimated by `cost-estimate.py`. The auto-warn fires only when the estimate exceeds the threshold (default $0.05 or 10K tokens).
- `/common/copilot` — one-click redirect of a prompt to MS Copilot Enterprise.
- `/common/cost-report` — actual spend snapshot from telemetry.

## Tuning the thresholds

Settings live in `.claude/settings.local.json` env or `harness/pricing.json`:

| Env var | Default | What it does |
|---|---|---|
| `TITAN_COST_THRESHOLD_USD` | 0.05 | Below this, auto-warn is silent |
| `TITAN_COST_THRESHOLD_TOKENS` | 10000 | Below this input-token count, auto-warn is silent |
| `TITAN_COST_LOUD_USD` | 1.00 | Above this, auto-warn uses stronger wording |
| `TITAN_COST_ALWAYS_SHOW` | unset | Set to 1 to force the notice on every prompt |
| `TITAN_COST_DISABLED` | unset | Set to 1 to disable the cost feature entirely |

## Ownership

| Area | Owner |
|---|---|
| Pricing table (`harness/pricing.json`) | the owner for this area (see the Titan session header; `?gov <path>` for a specific file) — refresh quarterly |
| Heuristic class definitions | the owner for this area — tune from telemetry once data lands |
| Hard-stop sensitive-prompt patterns | the owner for this area + Security |
