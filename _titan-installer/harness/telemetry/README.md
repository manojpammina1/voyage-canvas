# Titan Telemetry

Internal usage telemetry for the Titan Claude Code harness. Captures **metadata only** so the toolkit maintainer can see usage patterns and improve the framework.

## What this is for

- Which modes / skills / runbooks are actually used vs sitting idle
- Which hooks fire most (and whether governance rules are working)
- Which MCP tool calls fail / time out
- Token cost trend per role
- Adoption signal per team

## What we capture

| Field | Why | Example |
|---|---|---|
| `v` | Schema version | `1` |
| `ts` | UTC timestamp | `2026-06-02T18:34:51Z` |
| `user` | SHA-256(USERNAME + salt), first 16 hex chars | `a3f9b1c2d4e5f6a7` |
| `role` | Active CLAUDE_ROLE | `developer` |
| `tool` | Tool name only | `Edit`, `Bash`, `Skill`, `Agent` |
| `session` | Truncated session id | `sess_abc...` |
| `meta.path_prefix` | Top-2 path components only — sanitised | `storefront-repo/cart-ui.frontend/...` |
| `meta.bash_program` | Program name only, never args | `git`, `mvn`, `npm` |
| `meta.skill_name` | Slash command invoked | `caveman`, `i18n-check` |
| `meta.subagent_type` | Agent type | `Explore`, `general-purpose` |

Synthetic event types (all metadata-only, same envelope): `_cost_estimate` (pre-flight estimate), `_actual_usage` (exact billed tokens/cost from the Stop hook), `_hook_block` (category + action of a governance block, never the content), `_copilot_redirect` (text length only), `_cache_hit` (v2.3 — answer-cache fast path: `meta.cache_type` = `aem-build | reviewer | known-issue`, `meta.avoided_cost_usd` estimate, `meta.latency_ms`), `_session_ticket` (v2.3 — ADO ticket id extracted from the branch name + repo name; used for aggregate cost-per-PR/ticket only, never per-individual evaluation), `_correction` (v2.2 — cost-of-hallucinations: `meta.signal` = `explicit_flag | followup_phrase | self_correction | spiral_warn | spiral_break`, `meta.confidence`, `meta.category` [coarse phrase class — never the prompt text], `meta.consecutive` at a circuit-breaker trip).

**Tool-result fields (v2.2):** `Edit`/`Write`/`Read`/`MultiEdit`/`Bash` events additionally carry `meta.ok` (bool) and, on failure, `meta.error_class` (`edit_string_not_found | file_not_found | bash_nonzero | edit_string_not_unique | tool_error`) — classified from the tool-response **type only**, never the response text (a failed Edit's error echoes the missing `old_string`). A counted failure is the hardest in-session hallucination signal. `_hook_block` gains category `refusal-unverified` ("I cannot confirm this" catches, from `correction-scan.py`). All correction-cost dashboard figures are **measured facts** (real `cost_usd`, idle-capped timestamps, counts) — no monetary assumption.

## What we NEVER capture

- ❌ **Prompts** — never recorded
- ❌ **Responses** — never recorded
- ❌ **File contents** — never opened, never logged
- ❌ **Full Bash commands** — only the program name, never the args
- ❌ **Tool output** — never recorded
- ❌ **Customer data / PHI / PII** — actively scrubbed
- ❌ **PATs, credentials, tokens** — separately blocked by `credential-scan.py`
- ❌ **Full file paths** — sanitised to top 2 components with allowlist prefix check

## Where data lives

**Local only (always-on, default):**

```
<workspace>/.claude/telemetry/
  events-2026-06-02.jsonl    (one line per event, rotating daily)
```

**Central aggregation (planned for v1.2):**

After Phase 2 ships, the dashboard's daily uploader will batch JSONL files to:
```
Azure Blob Storage (adopter's tenant): claude-price-dashboard container (corrected
in the 2.4.1 pre-ship audit — this doc previously named an earlier, incorrect
container name; see `dashboard/.env.example`)
```

Retention: 90 days. Access: toolkit maintainer + Engineering Leadership only.

## How to disable telemetry

Three ways, any one is enough:

1. **Marker file** — create `<workspace>/.no-telemetry` (zero bytes). Hook will see it and exit.
2. **Env var in settings.local.json**:
   ```json
   { "env": { "CLAUDE_TELEMETRY": "off" } }
   ```
3. **Process env override** — set `CLAUDE_TELEMETRY=off` before launching Claude Code.

Disabling is silent — no Claude behavior changes. Only the JSONL stops being written.

## Reading your own telemetry

Use the `/common/usage-report` skill from any role:

```
> /common/usage-report
```

It reads your local `<workspace>/.claude/telemetry/*.jsonl` and produces:
- Top 10 modes by activation count this week
- Top 10 skills by invocation
- Hook block counts (which governance rules fired)
- Average session length per role
- Bash program frequency (you'll see if you're running `mvn` a lot)

Or read the raw JSONL with any text editor — events are one per line.

## Trust contract

This telemetry is **internal-only**, **metadata-only**, **opt-out anytime**, **privacy by design**. It is governed by the same organizational data-handling rules as any other code-adjacent metadata.

If a new field is ever added to the schema, the change goes through the same `super`-role governance review as the rest of the harness — see CLAUDE.md governance file lock.

## Schema versioning

The `v` field is the schema version. When fields are added/removed/renamed, `v` increments. Old JSONL files stay readable; the `/common/usage-report` skill handles multiple `v` values.

Current version: **1**.
