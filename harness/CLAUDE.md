# CLAUDE.md

> Acme Digital Platform — Acme ecommerce workspace: storefront, commerce integration layer, migration.

## Model Routing (Token Cost Control)

Use the right model for the right task. **General chat and non-code questions → Microsoft Copilot Enterprise (free tier) — do not burn Claude tokens on Q&A.**

| Task | Model | How to activate |
|------|-------|-----------------|
| Architecture decisions, cross-repo planning, governance synthesis | **Opus** | Start session: `claude --model claude-opus-4-7` |
| Code generation, PR review, test writing, correctness analysis | **Sonnet** | Default — no flag needed |
| Convention checks, naming pattern matching, file existence, simple lookups | **Haiku** | Set automatically by skill sub-agents |
| General questions, chat, explanations, documentation lookups | **Microsoft Copilot Enterprise** | Use it directly |

Sub-agent model params are applied automatically by `/parallel-review` and `/worktree-agent` skills — no manual selection needed during those flows.

## Output Compression — Caveman Skill

The `caveman` skill compresses Claude's narrative output. Every role/sub-context skill auto-invokes it at its own declared intensity on activation (`/po-mode`, `/security-mode`, `/prodsupport-mode` auto-disengage it). Per-role intensity table + overrides: caveman SKILL.md. Tune mid-session: `caveman lite|ultra|off`.

**Never compress, regardless of role:** generated code blocks · line-by-line code explanations (G0) · acronym/platform-term definitions on first use · escalation alerts (governance, credential leaks, PHI/PII — caveman auto-disables) · user-facing error messages in code.

## Mode Required

<!-- titan:block mode-picker -->
Before any work this session, confirm a mode is active. If not, ask:

| Command | Who | When |
|---------|-----|------|
| `/dev-mode` | All developers | Writing code, fixing bugs, features, tests, PRs, offshore briefs |
| `/lead-review` | Tech Lead | PR review |
| `/arch-mode` | Lead Architect | Architecture, deployments |
| `/grill-me` | Any developer | Stress-test a plan before coding starts — one question at a time |
| `/qa-mode` | QA Tester | Pull a Jira story, write functional test cases, export a CSV for manual import into Zephyr/Xray |
| `/qa-automation` | QA Automation Engineer | Jest/JUnit/Mocha test code, code coverage audits, regression matrices, fixtures |
| `/security-mode` | Security reviewer (any senior) | AppSec / OWASP / secret scan / MCP audit |
| `/sre-mode` | SRE / Cloud Manager / Lead Architect | .cloudmanager/, Adobe I/O Runtime, deploy / rollback, perf triage |
| `/prodsupport-mode` | Production support / L2-L3 / on-call | Customer ticket triage, runbook-driven, ADO ticket drafting (READ-ONLY) |

No files, code, or commands until mode is selected.

**Hidden modes** (not active; code preserved for future re-enable). The skill files remain on disk and still work if typed manually. They are not advertised in the mode picker or UserPromptSubmit reminder.

| Command | Who | When |
|---------|-----|------|
| `/po-mode` | Product Owner / Manager | User stories, acceptance criteria, backlog |
| `/designer-mode` | Frontend / Design engineer | Figma → React, brand tokens, stylesheet, a11y |
<!-- /titan:block mode-picker -->

**Dev sub-contexts** (invoke from within `/dev-mode` — no separate mode switch needed):

| Command | When |
|---------|------|
| `/unit-test` | Writing or auditing tests |
| `/pr-create` | Assembling a PR description before submitting |
| `/offshore-brief` | Creating a task brief for an outsourced/offshore team |

**Cross-cutting skills** (invoke from any role):

| Command | When |
|---------|------|
| `/common/i18n-check` | Audit locale files (`en.json`, `de.json`, etc.) for parity, orphans, and translation-vendor drift |
| `/common/security-check` | One-shot security finding against a single diff or directory |
| `/common/missing-scenarios` | Surface untested business edge cases |
| `/common/cost-report` | Token usage and budget snapshot |
| `/common/test-impact` | Predict which tests to run based on the active diff — cuts CI / local-loop time |
| `/common/mcp-audit` | Audit installed MCP servers + `.claude/hooks/*` against the approved harness |
| `/common/usage-report` | Personal usage report read from local telemetry — see which modes / skills you actually use |
| `/common/estimate` | Pre-flight cost / token estimate for a prompt before sending to Claude |
| `/common/copilot` | One-click redirect to the configured general-chat alternative (free) |
| `/ops/release-review` | Review the full code going into a release: diffs a release branch against the previous release branch, lists the PRs in it, and returns one GO / NO-GO verdict |

Stack-specific log-triage skills (self-suppress if that part of `stack` is disabled):

<!-- titan:block stack-skills -->
| `/common/aem-logs` | Triage an AEM (author/publish/CIF/local SDK) log symptom — same redaction contract, branches by AEMaaCS/local/legacy CQ |
| `/common/hybris-logs` | Triage a Generic-Commerce-Platform/OCC log symptom — locates the log source per environment, redacts via `redact_lib.py`, classifies to an owner. Never reads commerce-platform config paths |
<!-- /titan:block stack-skills -->

## Approved Plugins, Skills & MCP Servers

Only pre-approved plugins, skills, and MCP servers may be installed. The authoritative registry (approved / pending / blocked lists + proposal process) is `/common/plugin-policy` — `/common/mcp-audit` audits against it. Installing anything not in that registry without `super`-role approval is a governance violation.

<!-- titan:block plugin-policy-summary -->
Approved: `dataviz`, `claude-api`. Pending: none. Blocked: `compound-engineering-plugin`, `ruflo`. Full registry + proposal process: `/common/plugin-policy`.
<!-- /titan:block plugin-policy-summary -->

## Cost Estimation (Pre-flight)

Every prompt is auto-estimated for token + USD cost by `cost-estimate.py` (UserPromptSubmit hook). Informative, NEVER blocking for cost: silent below threshold ($0.05 / 10K tokens), inline notice above it, stronger wording at $1+; `/arch-mode` exempt below the loud threshold. Rates live in `pricing.json`. Thresholds + env-var tuning table: `/common/estimate`.

**Sensitive-prompt scan (hard block):** the same hook blocks prompts containing protected-path fragments, PAT-like patterns, or private-key markers before they reach Claude. Cost is informative; security is enforced.

**Zero-token fast paths (answer cache):** `?build` (build command for the current repo/module), `?reviewers` (owners for the current diff), `?ki <id-or-keyword>` (known-issue lookup), `?gov <path-or-question>` (governance lookup, grounded in `titan.config.json` + `CLAUDE.md`) are answered locally by `answer-cache.py` — no tokens spent. Full skills remain: `/common/aem-build`, `/common/diff-risk`, `/prodsupport/known-issues`, `/common/gov-lookup`.

**Skills:** `/common/estimate <prompt>` (estimate without sending) · `/common/copilot` (redirect to the general-chat alternative, free) · `/common/cost-report` (actual spend snapshot).

## Usage Telemetry

Titan captures **metadata-only** telemetry (tool/skill names, role, timestamp, hashed user ID, token counts — never prompts, responses, file contents, or full paths). Internal Acme use only. Local: `<workspace>/.claude/telemetry/events-YYYY-MM-DD.jsonl`. View your own: `/common/usage-report`. Disable: `.no-telemetry` marker file or `TITAN_TELEMETRY=off`. Full schema + privacy contract: `<workspace>/.claude/telemetry/README.md`.

## Governance File Lock

<!-- titan:block governance-lock -->
All files under `.claude/`, `CLAUDE.md` are **locked**. Only the `super` role (Jordan Blake — toolkit maintainer) may edit them. Leads and architects have deploy and review authority but **cannot modify governance files**.

| Role | Code | Deploy | PR Review | Edit governance |
|------|------|--------|-----------|-----------------|
| `developer` | Yes | No | No | **No** |
| `lead` | Yes | No | Yes | **No** |
| `architect` | Yes | Yes | Yes | **No** |
| `qa` | Read-only | No | No | **No** |
| `po` | Read-only | No | No | **No** |
| `super` | Yes | Yes | Yes | **Yes** |

To request a change to the toolkit: raise it with Jordan Blake. Changes go through review before being applied. If user only wants to navigate code, activate `/dev-mode` and note it.
<!-- /titan:block governance-lock -->

## Escalation Contacts

<!-- titan:block contacts -->
| Area | Contact |
|------|---------|
| React/Redux, LESS/SCSS | Jordan Blake |
| AEM, OSGi, HTL, clientlib, pipelines | Sam Rivera |
| Commerce platform, OCC-style endpoints | Riley Chen |
| GraphQL schema, integration layer config | Riley Chen |
| Search / discovery field mappings | Search Team (secondary: Jordan Blake) |
| Product information contracts | PIM Team (secondary: Jordan Blake) |
| Pipelines, cloud manager | Sam Rivera |
| Credentials, secrets, PHI/PII | Jordan Blake |
| Cross-repo architecture, migration sequencing | Sam Rivera + Riley Chen |
<!-- /titan:block contacts -->

## Absolute Hard Rules (no exceptions, no modes)

**Permanently blocked git:** `git push --force`/`-f`, `git push --delete`/`origin :<branch>`, `git branch -D`/`-d`, `git commit --amend` after push.

**`/lead-review` sessions:** Claude must NOT commit, push, create branches, or write any repo files. Output text only -- copy into the review tool manually.

**`/pr-create` sessions:** Output text only -- no git push, no branch creation. User copies the description into the SCM's PR UI.

**`/po-mode` sessions:** No code written or reviewed. Output stories, ACs, and backlog items only.

## Escalation Alert

Output when a hard-stop or governance violation is detected:

<!-- titan:block escalation-alert -->
```
ESCALATION REQUIRED -- STOP WORK
Reason:  [trigger]  |  Area: [file/module]
Contact: React/Redux, LESS/SCSS -> Jordan Blake | AEM, OSGi, HTL, clientlib, pipelines -> Sam Rivera | Commerce platform, OCC-style endpoints -> Riley Chen | GraphQL schema, integration layer config -> Riley Chen | Search / discovery field mappings -> Search Team | Product information contracts -> PIM Team | Pipelines, cloud manager -> Sam Rivera | Credentials, secrets, PHI/PII -> Jordan Blake | Cross-repo architecture, migration sequencing -> Sam Rivera + Riley Chen
Action:  Stop > Contact lead > Get approval > Record approval ref in PR description
```
<!-- /titan:block escalation-alert -->

## Workspace

No `.git` at workspace level -- always `git -C <repo-path>`. Each repo has its own `.git`.

## Repo Map

<!-- titan:block repo-map -->
| Repo | Module naming | Risk |
|------|---------------|------|
| `Acme-Storefront-UI/` | `acme-storefront-<feature>-ui.*` | Cloud Manager pipelines |
| `Acme-Commerce-Integration-Layer/` | `lerna workspaces` | GraphQL schema, app.config.yaml |
| `Acme-Platform-Migration/` | `acme-webapp-*` | hybris-api/impl, pim |
<!-- /titan:block repo-map -->

## Environments

<!-- titan:block environments -->
- **Staging**: https://staging.acme.example
- **Production**: https://www.acme.example
- **QA staging**: https://staging.acme.example
- Login: Logged-in flows reuse the test suite's own auth fixtures -- no separate credential captured or stored by the installer.
- PHI/PII: Staging may render real-looking data. Never lift an observed value into a test case -- fictional fixtures only, always.
- QA env refreshes nightly at 02:00 UTC from production snapshot, PHI scrubbed.
<!-- /titan:block environments -->

## Cross-Repo Contract Registry

Breaking changes to any contract require sign-off from all listed owners **before work starts**.

<!-- titan:block contract-registry -->
| Contract | Owner repo | Consumer repos | Contact |
|----------|-----------|----------------|---------|
| GraphQL schema fields | Acme Commerce Integration Layer | Acme Storefront UI | Riley Chen |
| Commerce endpoint signature | Acme Commerce Integration Layer | Acme Storefront UI, Acme Platform Migration | Riley Chen + Sam Rivera |
| PIM product fields | Acme Platform Migration | Acme Storefront UI | PIM Team + Sam Rivera |
<!-- /titan:block contract-registry -->

## Hard Stops

Output Escalation Alert and stop before writing any code:

<!-- titan:block hard-stops -->
- `commerce-platform-config` (CRITICAL) `**/config/*.properties`, `**/config/**/*.p12`, `**/config/**/*.jks` -> Riley Chen + Jordan Blake. Irrotatable platform secrets: DB passwords, OCC credentials, payment certs, SAML keystores. These credentials CANNOT be rotated. Open the file in your IDE, never via the assistant.
- `cicd-pipelines` (CRITICAL) `**/.cloudmanager/**`, `**/pipeline/**`, `**/ci/**`, `**/cd/**` -> Sam Rivera. Deploy pipeline files — breaking changes affect all environments. Pipeline changes require Platform Lead approval before merge.
<!-- /titan:block hard-stops -->

## Multi-Project Context

When working across repos in the same session:
1. State the active repo at the start of each task, e.g. "Working in `<repo-id>`, feature X"
2. Before switching repos, complete the pre-PR checklist for the current task
3. Cross-repo changes (schema, endpoint, product-data contracts) require Contract Registry owner sign-off before starting
4. Use `git -C <repo-path>` for all git commands -- workspace root has no `.git`

## PR Template

Use `/pr-create` to generate. Every PR requires:

**Title format:** `[TICKET-123] Short imperative description (max 72 chars)`

<!-- titan:block pr-reviewers -->
| Repo | Required reviewer(s) |
|------|---------------------|
| Acme Storefront UI | Jordan Blake |
| Acme Commerce Integration Layer | Riley Chen |
| Acme Platform Migration | Sam Rivera |
<!-- /titan:block pr-reviewers -->

**Escalation approval ref:** Required in the PR description before raising a PR that touched any hard-stop module.

## Data

<!-- titan:block data-policy -->
No PHI/PII or other regulated personal data in code, tests, logs, or comments. Mock data must be fictional. Never commit `**/cif/common/options.json`. Staging may render real-looking data. Never lift an observed value into a test case -- fictional fixtures only, always.
<!-- /titan:block data-policy -->
