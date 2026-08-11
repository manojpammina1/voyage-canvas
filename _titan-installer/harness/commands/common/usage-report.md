# /usage-report -- Personal Usage Report from Local Telemetry

Read-only. Reads `<workspace>/.claude/telemetry/events-*.jsonl` and produces a summary of how YOU have used Titan over a chosen window. Local-only — no upload, no network call.

Inherits caveman intensity from the calling role.

## What this skill answers

- Which modes did I activate most this week / month?
- Which skills do I lean on?
- Which slash commands have I never tried?
- How often do my hooks block something (governance violations)?
- How long are my sessions on average?
- Which Bash programs am I invoking most?

## How to invoke

```
/common/usage-report
```

Or with a window override:

```
/common/usage-report last 7 days
/common/usage-report this month
/common/usage-report 2026-05-01..2026-05-31
```

Default window: last 7 days.

## Output template

```
Titan Usage Report
======================
Window:           <start> -- <end>
Sessions:         <count>
Total events:     <count>
Hashed user:      <16-hex>  (anonymous; same on this machine)

Mode activations:
   /dev-mode             ████████████████  78 (52%)
   /lead-review          ██████             32 (21%)
   /arch-mode            ████                21 (14%)
   /qa-mode               ██                  8 (5%)
   /security-mode         █                   5 (3%)
   /po-mode               ▏                   3 (2%)
   (others: 4)

Top skills:
   /caveman                          120
   /common/missing-scenarios          22
   /common/cost-report                14
   /common/pr-create                  11
   /common/diff-risk                   8

Hook block counts (last 7 days):
   protect-skills.py        2 blocks  -- offshore agent tried .claude/ edit
   credential-scan.py       1 block   -- PAT in proposed Edit
   protect-secrets           0 blocks
   redact-customer-data     1 warn    -- prodsupport flow

Average session length per role:
   /dev-mode             47 min
   /lead-review          22 min
   /arch-mode            18 min

Top Bash programs:
   git                    142
   mvn                     38
   npm                     27
   yarn                    11

Slash commands you have NEVER used:
   /common/test-impact
   /common/mcp-audit
   /common/contract-review
   /roles/grill-me

Suggestions:
   * You activated /dev-mode 78× but used /common/test-impact 0× --
     try it before your next PR to skip irrelevant tests.
   * /roles/grill-me hasn't been used -- worth trying before any cross-repo refactor.
   * Bash program frequency suggests `git` is invoked often -- consider
     /common/branch / /common/branch-merge for context-branch workflows.
```

## Implementation hints (for Claude when running this skill)

1. Resolve the window (default: last 7 days).
2. Find files matching `<workspace>/.claude/telemetry/events-*.jsonl` within window.
3. Stream-read each line as JSON; skip malformed lines silently (telemetry is fail-silent by design).
4. Aggregate:
   - Mode activations: count of `tool == "Skill"` events where `meta.skill_name` matches `<role>-mode` or `arch-mode` / `dev-mode` / etc. (Roles are skills in this harness.)
   - Skill activations: same, for any `meta.skill_name`.
   - Hook block counts: events where `tool == "_hook_block"` (NOT YET emitted; placeholder for v1.2)
   - Average session length: group by `session` field, compute (max ts - min ts).
   - Bash program frequency: count `meta.bash_program` occurrences.
5. Render the template above with the aggregated numbers.

## Hard rules

- Never upload telemetry from this skill — local read only.
- Never include the user's USERNAME anywhere in output — only the hashed ID.
- Never display file paths beyond top-2 components (the schema already enforces this; the skill must not reconstruct full paths).
- If no telemetry files exist (telemetry disabled or first-day install), output:
  > No telemetry data found in this workspace. Telemetry may be disabled (check `.no-telemetry` marker or `CLAUDE_TELEMETRY=off`) or this is your first session. Run a few commands and try again later.

## Ownership

| Area | Owner |
|------|-------|
| Telemetry schema | the owner for this area (see the Titan session header; `?gov <path>` for a specific file) — toolkit maintainer |
| Privacy policy | the owner for this area + internal data handling rules |
| Aggregation logic for /common/usage-report | the owner for this area |
