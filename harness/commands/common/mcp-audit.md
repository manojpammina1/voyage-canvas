# /mcp-audit -- MCP Server + Hook Integrity Audit

Read-only. Verifies the installed MCP servers and `.claude/hooks/*` files in this workspace match the Titan-approved harness. Flags drift, unapproved additions, and tampered hooks.

Inherits caveman intensity from caller. Caveman auto-disables for any escalation finding.

## Why this exists

Per the authoritative registry in `/common/plugin-policy` (plugin-policy.md) — only a fixed set of MCP servers and hook scripts may run inside a Titan-governed workspace. Drift introduces:
- **Data egress risk** — an unapproved MCP could leak code to a third-party endpoint
- **Hook tampering** — a weakened `credential-scan.py` lets PATs slip into commits
- **Supply-chain risk** — community MCP packages pulled from npm can be hijacked

This skill runs the audit so the user does not have to remember the approved list.

## What it checks

### Part 1 — MCP server audit (reads `<workspace>/.mcp.json`)

`.mcp.json` may contain ONLY real MCP servers — every entry's `type` must be `stdio | http | sse`. The sole approved server is:

| Server name | Type | Auth | Status |
|---|---|---|---|
| `azure-devops` | stdio | wrapper: `node .claude/scripts/mcp-ado-launch.cjs` | ✓ Approved |

> The `azure-devops` server is launched via the `mcp-ado-launch.cjs` wrapper, NOT `npx` directly. Claude Code expands `.mcp.json` `${VAR}` only from the OS launch env (not settings.local.json), so `${AZURE_DEVOPS_PAT}` expanded to empty → null-identity auth (TF400813). The wrapper reads the PAT from settings.local.json at launch, normalizes the org URL (serverUrl=bare host + collection=org, else it builds `.../org/org` → 401), and execs `azure-devops-mcp@1.1.2` with stdio inherited. An audit should expect `command: node`, `args: [.claude/scripts/mcp-ado-launch.cjs]` — not a bare npx entry. A bare `${AZURE_DEVOPS_PAT}` npx entry is the STALE/broken form.

> **Built-in claude.ai connectors (Atlassian Rovo — Jira/Confluence; Figma) do NOT belong in `.mcp.json`.** They are enabled in claude.ai connector settings and authenticate via OAuth. They are approved *connectors* (see plugin-policy.md) but are NOT `.mcp.json` entries.

**Findings (schema-lint FIRST — this class silently breaks everything):**
- **Any entry whose `type` is not `stdio`/`http`/`sse` → P0, output Escalation Alert.** Claude Code validates the whole file against its schema; one invalid entry (e.g. a documentation stub with `"type":"builtin"`) causes the ENTIRE `.mcp.json` to be discarded, so NO server loads — silently (RCA 2026-07-06). This is the highest-priority check: it masquerades as "everything fine" while every MCP server is dead.
- Any `.mcp.json` that fails `JSON.parse` → P0 (same effect: whole file rejected).
- stdio `jira` present → STALE, remove it (`@modelcontextprotocol/server-jira` is a 404 on npm; Jira = Rovo connector).
- Any server name NOT in the approved list (`azure-devops`) → P0, Escalation Alert.
- Any server in the blocked list (plugin-policy.md "Blocked"): `lfg`, `ce-*`, `ruflo-*`, Firecrawl, Exa, etc. → P0, refuse to proceed.
- Any env value that is NOT a `${UPPER_SNAKE_CASE}` reference → P1 (suggests inline secret).
- Any `command` field referencing an absolute path outside the workspace or a network URL → P1.

> **Cross-check MCP actually loaded, don't trust the dashboard:** the Titan dashboard's "Azure DevOps ✓" reflects a PAT REST test, NOT MCP registration. To confirm the server truly loaded, run `claude mcp list` in the workspace — `azure-devops` must appear. Absent = `.mcp.json` was rejected. The post-install doctor now runs this check (`ado-mcp`).

### Part 2 — Hook integrity (reads `<workspace>/.claude/hooks/*`)

Required hooks (must be present and unmodified):

| Hook file | Purpose | Matcher |
|---|---|---|
| `credential-scan.py` | Block commits with PATs / API keys / private keys | PreToolUse on Edit, Write |
| `protect-secrets.py` | Block reads of Hybris irrotatable-secret files | PreToolUse on Read, Write, Edit, Bash, Grep |
| `redact_lib.py` | Shared PII/PHI patterns + masking (imported by redact-customer-data.py + log skills) | library (not a hook itself) |
| `answer-cache.py` | Zero-token deterministic answers (?build/?reviewers/?ki) | UserPromptSubmit |
| `protect-skills.py` | Block writes to `.claude/` by non-super roles | PreToolUse on Edit, Write |
| `session-start.sh` | Print session context banner | SessionStart |

**Findings:**
- Any required hook missing → P0
- Any required hook present but SHA-256 differs from the bundled harness version → P1 (tampered)
- Any additional hook NOT in the approved list → P2 (review what it does before declaring safe)

### Part 3 — settings.json hook registration

Verifies `<workspace>/.claude/settings.json` registers the hooks in the correct event slots and matchers. A hook file existing on disk but not registered in settings.json is dead code -- output a P2 finding.

### Part 4 — settings.local.json env hygiene

Verifies the gitignored `<workspace>/.claude/settings.local.json` env block contains only approved keys:

| Approved env key | Required by |
|---|---|
| `AZURE_DEVOPS_PAT` | azure-devops MCP, git clone |
| `AZURE_DEVOPS_TOKEN` | alias of PAT (some MCPs) |
| `AZURE_DEVOPS_URL`, `AZURE_DEVOPS_ORG_URL` | azure-devops MCP |
| `AZURE_DEVOPS_COLLECTION` | azure-devops MCP |
| `JIRA_EMAIL`, `JIRA_API_TOKEN` | jira MCP, Atlassian Rovo |
| `JIRA_HOST` | jira MCP |
| `FIGMA_PERSONAL_ACCESS_TOKEN` | Figma headless / REST (optional) |

Any other env key in this file → P2 (review). Any env key with a literal value that LOOKS like a token but is shorter than expected → P1 (likely placeholder left in or truncated PAT).

## Output format

```
MCP + hook audit — <workspace>
================================
Audit time: <ISO timestamp>

[Part 1] MCP servers (4 configured):
  ✓ claude.ai Atlassian Rovo  (builtin OAuth)
  ✓ claude.ai Figma           (builtin OAuth)
  ✓ azure-devops              (stdio, env: AZURE_DEVOPS_PAT)

  ⚠ Unexpected: <none>
  ⛔ Blocked: <none>

[Part 2] Hooks (4 required, 4 found):
  ✓ credential-scan.py        SHA-256 matches bundled harness
  ✓ protect-secrets.py SHA-256 matches bundled harness
  ✗ protect-skills.py         SHA-256 DIFFERS from bundled harness  ← P1
       Bundled: 7f3c…           Workspace: a1d2…
       Action:  diff and restore from bundled harness
  ✓ session-start.sh          SHA-256 matches bundled harness

  ⚠ Additional hooks (1):
     custom-formatter.sh — review what this does and confirm it is not weakening guards

[Part 3] Hook registration in settings.json:
  ✓ credential-scan.py registered on PreToolUse(Edit|Write)
  ✓ protect-secrets.py registered on PreToolUse(Read|Edit|Write)
  ✓ protect-skills.py registered on PreToolUse(Edit|Write)
  ✓ session-start.sh registered on SessionStart

[Part 4] settings.local.json env block:
  ✓ 7 approved keys present (AZURE_DEVOPS_PAT, AZURE_DEVOPS_TOKEN, ..., JIRA_API_TOKEN, FIGMA_PERSONAL_ACCESS_TOKEN)
  ⚠ Unknown key: COVEO_TOKEN — not in approved list, review

Summary:
  P0: 0   P1: 1   P2: 1
  Verdict: HOLD — restore protect-skills.py from bundled harness, then re-audit
```

## What "bundled harness" means

The reference SHA-256s come from the installer's `harness/hooks/*` directory inside the Titan installer build that the workspace was originally provisioned from. If the user has updated the installer version, the audit references the LATEST installed version's hooks.

Lookup path inside this skill (when run in Claude Code):
```
%LOCALAPPDATA%\Programs\titan\resources\harness\hooks\
```
or for the dev / unpacked layout:
```
<install-root>\resources\harness\hooks\
```

If the installer is not present (workspace was provisioned manually), the skill falls back to checking presence + registration only, and skips SHA comparison with a note.

## Hard stops during audit

- Audit must NEVER read or display the contents of files under the Hybris/Ecommerce repo's `hybris/config/` (irrotatable secrets). Path-reference only.
- Audit must NEVER print the value of any env key — only the key name and a "present / missing" status.
- Any P0 finding aborts the audit with an Escalation Alert. No further checks until P0 resolved.

## Permissions

Allowed: read `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json` (keys only), `.claude/hooks/` (filenames + SHA-256), bundled harness reference dir (read).
Blocked: any write, any network call, reading file CONTENTS of `settings.local.json` env values, reading any Hybris file.

## Reminders

- After audit: *"For any P1 finding, restore from bundled harness, then re-run /common/mcp-audit to confirm clean."*
- After audit: *"P0 / blocked MCP found → output Escalation Alert and stop. Notify the toolkit maintainer (per the Titan session header) before re-running."*

## When to run this skill

| Trigger | Cadence |
|---|---|
| First session after installer re-install | Auto-run via `/ops/framework-review` |
| Quarterly framework review | As part of `/ops/framework-review` |
| Before raising any PR that touched `.claude/`, `.mcp.json`, or `settings.json` | Manual |
| When plugin-policy.md "Pending / under review" list changes | Manual |
| Anytime a contributor proposes a new MCP server | Manual |

## Ownership

Resolve current owners for the approved MCP list, hook contents/integrity, and new-MCP-server review via `?gov mcp` / the toolkit maintainer (`super` role) named in the Titan session header, rather than a hardcoded name table. The bundled harness SHA reference is auto-generated by the installer build.
