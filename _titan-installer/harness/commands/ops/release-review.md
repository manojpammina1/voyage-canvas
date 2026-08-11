# /ops/release-review — Release Code Review

Activate. Review the **entire body of code going into one release** — everything accumulated on a `release/R*` (scheduled) or `release/H*` (hotfix) branch — by diffing it against the **previous release branch**. Produces a PR traceability list plus one release-level GO / NO-GO verdict.

**Read-only, text-only.** No commits, pushes, branch creation, or file writes to any repo this session. The skill produces text — the user takes action.

**Caveman intensity for this skill:** `lite`. Verdicts and risk scores are decisions — keep them precise. Escalation Alerts and governance findings stay uncompressed (Caveman auto-disables for security-critical output).

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). Respect `stop caveman` / `normal mode` — remain in release-review with caveman off.

This skill **reuses** the existing engines. Do not re-author review logic:
- Governance hard-stop table + multi-agent engine → `/parallel-review`
- Risk scoring + reviewer recommendation → `/diff-risk`
- Release branch handling + PHI guardrails → `/release-notes`

Workspace root has no git — always `git -C <repo-path>`.

Local path and ADO project for each candidate repo are `<workspace>/<config.repos[].dir>` and `config.repos[].id` respectively — resolve via `?gov repos` or the Titan session header.

One repo per invocation — release branches are per-repo.

## Step 1 — Inputs

Ask for:
1. **Repo** (one of the four above).
2. **Release branch under review** — `release/R<YYYY>-<NN>` (scheduled) or `release/H<YYYY>-<MM>-<N>` (hotfix). Call this `THIS`.
3. **Previous release branch** (the diff base) — last release's branch, e.g. `release/R2026-05`. Call this `PREV`.

Both branch names are **required** — do not assume `master`. The point of this skill is to review exactly what is new in `THIS` versus what already shipped in `PREV`; diffing against `master` would mix in already-merged-back code.

If the user is unsure of `PREV`, list candidates and let them pick:
```bash
git -C <repo> branch -a --list 'origin/release/*' --sort=-committerdate
```

Detect hotfix vs scheduled from the `H` vs `R` prefix. A hotfix is expected to be narrow and urgent — if its aggregate diff is unexpectedly large, flag it.

## Step 2 — PR traceability ("all PRs sent for this release")

**If ADO MCP is connected** (tools with `azure-devops` prefix present):
- Call `list_pull_requests` for the repo's ADO project, filtered to `targetRefName = refs/heads/release/<THIS>`, status `completed`.
- Build a table: PR # · ADO ticket (from branch/title) · title · author · completion date · files-touched count.

**If ADO MCP is unavailable**, derive the merged-PR list from the merge commits between the two release branches:
```bash
git -C <repo> log origin/release/<PREV>..origin/release/<THIS> --oneline --merges
```
(`Merged PR NNNNN: <description>` subjects give the PR numbers and tickets.)

This table is the traceability view — it answers "which PRs make up this release".

## Step 3 — Collect the aggregate diff (this release vs previous release)

```bash
git -C <repo> fetch origin release/<PREV> release/<THIS>
git -C <repo> diff origin/release/<PREV>...origin/release/<THIS> --shortstat
git -C <repo> diff origin/release/<PREV>...origin/release/<THIS> --name-only
git -C <repo> diff origin/release/<PREV>...origin/release/<THIS>
git -C <repo> log  origin/release/<PREV>..origin/release/<THIS> --oneline --no-merges
```

Store:
- `REPO`
- `SOURCE = release/<THIS>`
- `TARGET = release/<PREV>`
- `DIFF` — full unified diff text
- `FILES_CHANGED` — `--name-only` list

If fetch fails, ask the user to run the commands locally and paste the output.

## Step 4 — Risk score

Invoke `/diff-risk` on the aggregate diff to get size / path-sensitivity / cross-repo / churn risk plus recommended reviewers.

Release roll-ups are large by design, so **size risk will usually read HIGH/CRITICAL — that is expected and is not auto-blocking**. The gating signals are **path-sensitivity** (hot-path files) and the **governance** scan in Step 5.

## Step 5 — Governance gate (inline — do not delegate)

Run the exact hard-stop scan from `/parallel-review` Step 1 across `FILES_CHANGED`:

Every hit is resolved against `protected_paths[]` / `config.governance` via `?gov <path>` — do not hardcode owners here.

| Pattern | Resolve owner via |
|---------|-------------------|
| Credentials, tokens, API keys, PHI/PII in diff | `?gov` (security, immediate) |
| Release/deploy pipeline files | `?gov` (cicd) |
| `.cloudmanager/` modified | `?gov` (aem) + Cloud Manager admin |
| Cross-repo contract config (e.g. `app.config.yaml`) changed | `?gov` (commerce/cif) |
| Committed credential/options files (e.g. `cif/common/options.json`) | `?gov` (security, immediate) |
| Commerce-platform API/impl modules touched | `?gov` (commerce/cif) |
| PIM modules touched | `?gov` (pim) |
| `ci/`, `pipeline/`, `cd-deploy/` touched | `?gov` (cicd) |
| System-token / secret directories touched | `?gov` (security) |
| GraphQL field added / removed / renamed | `?gov` (commerce/cif) |
| Cross-naming move in Migration-role repo | `?gov` (architecture) |

On any hit: emit the CLAUDE.md **Escalation Alert**, set `Governance: BLOCK`, attribute the hit to its originating PR from the Step 2 table, and stop. The release does not ship until cleared by the owner resolved via `?gov`. Never read or display the irrotatable-secret files listed in CLAUDE.md Hard Stops.

## Step 6 — Deep review (delegate to /parallel-review)

If governance passes, hand `REPO / SOURCE / TARGET / DIFF / FILES_CHANGED` to `/parallel-review` (its Step 2 multi-agent launch + Step 3 missing-scenarios + Step 4 architecture). Do not re-author those checks here.

## Step 7 — Release verdict (synthesise)

```
=== Release Review — <repo> / release/<THIS> (<scheduled|HOTFIX>) ===
Base (prev release): release/<PREV>   PRs in release: N   Files: N   Lines: +A/-D   Risk: <LOW|MODERATE|HIGH|CRITICAL>

PR traceability:
  #NNNNN  [TICKET]  <title>   <author>   <files>
  ...

Governance      : N — [BLOCK | PROCEED]   (PR #… : <hit>)
Conventions     : N
Correctness     : N defects, N warnings
Reliability     : N defects, N warnings
Missing scenarios : N
Architecture    : N concerns
CIF contract    : N breaking changes (if checked)
Tests           : [PASS | N gaps] (if checked)

Findings (grouped by category; file:line; each tagged with originating PR # where known)

Release verdict: GO | GO WITH FIXES | NO-GO — <reason> | ESCALATE — <team>
```

Rules:
- Verdict vocabulary is release-level: **GO / GO WITH FIXES / NO-GO / ESCALATE** (not PR-level APPROVE/REQUEST-CHANGES).
- Governance BLOCK overrides everything — show only the Escalation Alert and stop.
- Do not repeat a finding flagged by multiple agents — merge under the higher-severity category.
- Do not show PASS categories — only categories with findings.
- Every finding includes file:line so it is clickable in the IDE.

## Permissions

Allowed: read repo files, run `git fetch`/`diff`/`log`/`branch`, run `grep`, ADO MCP **reads** (`list_pull_requests`, `get_pull_request`).
Blocked: pushing branches, creating branches, opening or voting on PRs in ADO, Teams messages. Text output only — the user takes action.
