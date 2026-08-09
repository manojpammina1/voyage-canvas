# /compound — Codify a Team Learning

Capture a non-obvious lesson learned during this session — a bug whose root cause was hidden, a contract gotcha, a debugging shortcut, a hard-won fix — so the next developer (offshore or onshore) does not have to re-discover it.

**Caveman intensity for this skill:** `lite`. Captured learnings must remain readable for offshore developers consuming them later. Refresh/archive runs may use full.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). Captured learning text is for human consumption and must not be over-compressed. Respect `stop caveman` if user issues it.

## Origin

Adapted from EveryInc `compound-engineering-plugin` `/ce-compound` + `/ce-compound-refresh` patterns. The plugin itself is NOT installed per `CLAUDE.md` "Approved Plugins, Skills & MCP Servers". This is a native re-implementation.

## When to use

- After fixing a non-trivial bug whose root cause was surprising
- After resolving a cross-repo contract issue (GraphQL field, OCC endpoint, PIM mapping, Coveo field)
- After a Hybris/CIF gotcha that took >1 hour to track down
- After a build/deploy failure with non-obvious cause
- When you find yourself thinking "the next person hitting this will be stuck for hours"

Do NOT use for:
- Standard framework knowledge (already documented in AEM/React/Hybris docs)
- One-off issues with no general lesson
- Information that contains credentials, PHI/PII, or internal-only secrets

## Step 1 — Identify the learning

Ask the user three short questions:

1. **What was the symptom?** (1 sentence — what the developer first observed)
2. **What was the root cause?** (1-2 sentences — the actual reason, not the surface fix)
3. **What would have made this easier to find?** (1 sentence — the signal, log line, test, or doc that should have pointed there)

## Step 2 — Classify scope

| Scope | Where it gets saved |
|-------|--------------------|
| Workspace-wide / cross-repo | `.claude-projects/learnings/<slug>.md` (committed, team-visible) |
| Single repo | `<repo>/.claude/learnings/<slug>.md` (committed, repo-visible) |
| Personal / experimental | `C:\Users\<you>\.claude\projects\c--codebase-ecom-webapp\memory\learning_<slug>.md` (memory, this machine only) |

Default to **workspace-wide** unless the user says otherwise — offshore developers benefit most from shared learnings.

## Step 3 — Write the learning file

Use this exact template:

```markdown
---
title: <short imperative title — what to do or watch out for>
date: <YYYY-MM-DD>
scope: <workspace | repo | personal>
repos: [<repo names if scope=repo, else "all">]
tags: [<tag1>, <tag2>]  # e.g. hybris, occ, react-redux, ado, cif, pim
related-tickets: [<ADO-12345>, <SHOPPURCH-67890>]  # optional
---

## Symptom

<1-2 sentences — what a developer first sees>

## Root cause

<2-4 sentences — the actual underlying reason. Reference exact files, line numbers, contracts.>

## Signal that points to it

<1-2 sentences — the log line, error message, test failure, or doc reference that should have led here faster>

## Fix or workaround

<2-4 sentences or a small code snippet — what to actually do. NOT line-by-line code — link to the PR or commit instead.>

## Related

<bullet list of related learnings, tickets, or contract registry entries>
```

## Step 4 — Refresh (archive stale learnings)

When invoked with `/compound refresh`, scan all learning files and:

1. List learnings older than 6 months
2. For each, ask: "Still true? (yes / no — mark archived / update with new info)"
3. On "no — mark archived", move the file to `<original-path>/archive/<slug>.md` and add `archived: true, archived-date: YYYY-MM-DD, archived-reason: <one line>` to its frontmatter
4. On "update with new info", drop into a mini-edit flow for the user

Refresh keeps the active learnings list relevant. Stale entries dilute discovery.

## Governance

- No PHI/PII, credentials, customer data, or org trade-secrets in learning files
- Cross-repo learnings affecting GraphQL/OCC/PIM/Coveo contracts must reference the Contract Registry owner who signed off the original change
- Personal-scope learnings stay on your machine (`.claude/projects/.../memory/`) — never committed accidentally; they go in your gitignored memory directory

## Discovery

Offshore developers find learnings via:
- `grep -ri "<tag>" .claude-projects/learnings/ <repo>/.claude/learnings/`
- Future: `/compound search <keyword>` (planned, not yet built)

## Permissions

Allowed: Read existing learnings, write new learnings to approved locations.
Blocked: Editing learnings authored by others without their note; writing personal-scope content to committed locations.
