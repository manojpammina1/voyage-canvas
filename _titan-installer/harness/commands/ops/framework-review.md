# /framework-review — Quarterly Harness Improvement Review

Run every 3 months. Audits the entire Claude Code governance framework, surfaces what's stale or missing, and produces a prioritised improvement plan saved to `.claude-projects/framework-reviews/`.

**Caveman intensity for this skill:** `lite`. The output is a structured report — keep it readable but efficient.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite`. Respect `stop caveman` if user issues it.

---

## When to run

Quarterly — approximately every 90 days. Scheduled reminders are set via the `schedule` skill.
Next review dates: January 1 · April 1 · July 1 · October 1.

---

## Step 1 — Skill inventory audit

Read every file under `.claude/commands/` and check for:

| Check | Look for |
|-------|----------|
| Deprecated model names | `claude-opus-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-4` or older — update to current |
| Stale contact references | Contact/area references that no longer match `?gov` / the config's `contacts` block |
| Missing Caveman intensity declarations | Every skill MUST have `**Caveman intensity for this role:**` + auto-engage directive |
| Missing auto-engage directives | `**On activation (auto-engage caveman):**` must be present in all role skills |
| G0 code explanation rule | Dev-mode + all dev sub-contexts must reference G0 |
| Hard-stop paths | Verify hard-stop file patterns still match the actual repo structure |
| Broken IPC channel names | Any skill referencing MCP tools that may have been renamed or removed |

Output per finding:
```
STALE — <skill path>:<line>
  Issue: <what's wrong>
  Fix:   <exact change needed>
```

---

## Step 2 — Claude Code version check

Run: `claude --version`

Check Anthropic release notes for the installed version range. Flag if:
- The installed version is more than one major release behind latest
- New Claude Code features exist that could replace workarounds currently in the framework (e.g., new hook events, new tool types, new permission syntax)
- New approved models should be added to the model routing table in CLAUDE.md

Output:
```
VERSION — Claude Code vX.Y.Z installed
New features available: <list if any>
Model routing update needed: <yes/no + reason>
```

---

## Step 3 — CLAUDE.md governance review

Read `CLAUDE.md` and check:

| Section | What to verify |
|---------|---------------|
| Model routing table | Model IDs still current (Opus 4.7, Sonnet 4.6, Haiku 4.5) |
| Approved plugins | `azure-devops-mcp@1.1.2` still current version — check `npm view azure-devops-mcp version` |
| Blocked plugins | Any new plugins that should be blocked (check if team members have been asking to install things) |
| Escalation contacts | `config.contacts` entries still resolve correctly via `?gov` |
| Hard stops | Any new hard-stop patterns needed based on incidents in the last quarter (add to `protected_paths[]`, not inline) |
| Data section | PHI/PII rules still correct for current project scope |
| Repo map | `config.repos[]` entries + module naming conventions still accurate |

---

## Step 4 — MCP server health

Test each configured MCP server:

```bash
claude mcp list
```

For each server listed:
- Check connection status (✓ Connected / ✗ Failed / ! Needs authentication)
- For ADO MCP: verify version is current (`npm view azure-devops-mcp version`)
- For Atlassian Rovo: confirm OAuth token valid (check by asking a Jira ticket title)
- For Figma: confirm connected (check by calling `whoami`)

Flag any that are disconnected or outdated.

---

## Step 5 — Install.py compatibility check

```bash
python install.py --check --json-output --non-interactive --role dev 2>&1 | python -c "import sys,json; [print(l['level'].upper()+':', l['message']) for l in [json.loads(x) for x in sys.stdin if x.strip()] if l['level'] in ('warn','error')]"
```

Flag any WARN or ERROR lines. Common issues:
- Python version too old
- Node.js version behind
- Missing tools (Maven, Java)
- `python3` vs `python` PATH issues on Windows

---

## Step 6 — Titan preset review

Read the workspace's `titan/packages/presets/` directory listing (path configurable; see `docs.tech_debt_plan` or ask if not found).

For each preset:
- Check that model references in template files are current
- Check that branch defaults match the org's active release patterns
- Flag if a new stack preset is likely needed based on team usage

Ask: "What new stacks or frameworks have teams adopted in the last quarter that might need a new Titan preset?"

---

## Step 7 — Generate improvement plan

Consolidate all findings into a prioritised plan:

### Priority levels

| Level | Criteria | Action |
|-------|----------|--------|
| **P1 — Fix now** | Broken functionality, security issue, PHI/PII risk | Fix this quarter, raise to the toolkit `super` owner (see `?gov`) |
| **P2 — Fix this quarter** | Stale model names, disconnected MCP, outdated contacts | Fix before next review |
| **P3 — Improve next quarter** | New features, new presets, enhancements | Queue for next review cycle |

### Output format

```
=== Titan Harness Review — Q[N] YYYY ===
Generated: <date>
Reviewer:  /framework-review skill

EXECUTIVE SUMMARY
  Skills audited: N
  Issues found:   N (P1: X · P2: Y · P3: Z)
  Framework health: [Green / Amber / Red]

P1 — Fix now
  ──────────────────────────────────────────
  [ ] <item> | <file:line> | <exact fix>

P2 — Fix this quarter
  ──────────────────────────────────────────
  [ ] <item> | <file:line> | <exact fix>

P3 — Improve next quarter
  ──────────────────────────────────────────
  [ ] <item> | <rationale>

MCP STATUS
  claude.ai Atlassian Rovo:  [OK / STALE / DISCONNECTED]
  azure-devops-mcp vX.Y.Z:   [OK / STALE / DISCONNECTED]
  Figma:                     [OK / STALE / DISCONNECTED]

NEXT REVIEW DATE
  <date + 90 days>
```

---

## Step 8 — Save the report

Write the report to:

```
.claude-projects/framework-reviews/YYYY-Q[N].md
```

Example: `.claude-projects/framework-reviews/2026-Q3.md`

Create the directory if it doesn't exist. The report is committed to git so there's a historical record of framework health.

---

## Governance

- This review is SUPER-role only — see `config.roles.definitions.super.holders` / `?gov` for who runs it.
- P1 findings block the next developer sprint until resolved.
- P2 findings must be addressed before the next quarterly review.
- P3 findings are queued as issues in ADO for prioritisation.
- The report is shared with Tech Leads after completion.

---

## Quick-run checklist (TL;DR for repeat runs)

```
1. /framework-review         ← run this skill
2. Fix all P1 items           ← same session
3. Create ADO tickets for P2  ← this week
4. Backlog P3 items           ← next sprint planning
5. Commit the review report   ← git add + commit
6. Update CLAUDE.md if needed ← super role edit
7. Bump install.py version    ← if changes shipped
```
