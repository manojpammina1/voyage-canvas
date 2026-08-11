# /diff-risk — Diff Risk Scoring and Reviewer Suggestion

> **Fast path: type `?reviewers`** — the answer-cache hook maps your current diff to owners from `data/reviewer-map.json` locally, zero tokens. Use this skill for full risk scoring (size/churn/cross-repo). Keep the Step 3 table and the JSON map in sync (super role).

Score a branch's diff for risk, classify the change type, and recommend reviewers from the project's Contract Registry and code-ownership patterns. Invoke before `/pr-create` to pre-fill the reviewer list and surface risk before the PR description is written.

**Caveman intensity for this skill:** `lite`. Risk scores and reviewer assignments are decisions — keep them precise.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). Risk findings that escalate to HIGH must remain uncompressed. Respect `stop caveman` if user issues it.

## Origin

Adapted from RuvNet `ruflo-jujutsu` `diff-analyze` skill pattern (risk scoring + reviewer recommendation). The plugin itself is NOT installed per CLAUDE.md "Approved Plugins, Skills & MCP Servers". This project's re-implementation uses git directly (no MCP tools), the project's Contract Registry, and its Hard Stops.

## When to use

- Right before `/pr-create` — sets the reviewer line in the PR description
- During `/lead-review` Step 1 (governance) to get a second-opinion risk score
- After a long-running task where the diff has grown — re-score periodically

## Step 1 — Collect the diff

Ask the user for the source and target branches if not already known. Then:

```bash
git -C <repo-path> fetch origin <source-branch> <target-branch>
git -C <repo-path> diff origin/<target>...origin/<source> --shortstat
git -C <repo-path> diff origin/<target>...origin/<source> --name-only
git -C <repo-path> log origin/<target>..origin/<source> --oneline
```

Store `FILES_CHANGED`, `LINES_ADDED`, `LINES_DELETED`, `COMMIT_COUNT`.

## Step 2 — Score size risk

Diff size by lines changed. Bigger = harder to review = higher risk of missed defects.

| Lines changed (added + deleted) | Size risk |
|---------------------------------|-----------|
| < 100 | LOW |
| 100–499 | MODERATE |
| 500–999 | HIGH |
| ≥ 1000 | CRITICAL — recommend splitting before review |

## Step 3 — Score path-sensitivity risk

The path-sensitivity table is no longer hand-restated here — it is generated data. For each file in `FILES_CHANGED`, resolve its glob against `data/reviewer-map.json` (or the zero-token `?reviewers` / `?gov <path>` fast paths, which read the same file) to get `sensitivity`, `owners`, and `why`. That file is compiled from `protected_paths[]` in `titan.config.json` plus the project's Contract Registry — it is the single source of truth, so this skill and the data file cannot drift apart.

If a changed file matches no entry in `reviewer-map.json`, treat it as LOW unless it falls under a repo's declared `risk_notes[]` (see `config.repos[]`), in which case ask the user or run `?gov <path>` before assuming LOW.

The MAX sensitivity across all files in the diff is the **path-sensitivity score**.

## Step 4 — Score cross-repo risk

Count repos touched, against the repos declared in `config.repos[]`. Cross-repo PRs need coordinated review.

| Repos touched | Cross-repo risk |
|---------------|-----------------|
| 1 | LOW |
| 2 | MODERATE |
| 3 or more | HIGH — recommend per-repo PRs OR cross-repo coordination |

## Step 5 — Score churn risk

For each touched file, check recent commit history:

```bash
git -C <repo-path> log --oneline --since="30 days ago" -- <file>
```

If any file has **≥10 commits in last 30 days**, that file is high-churn — recent change conflicts are likely. Flag as `CHURN_HOT`.

## Step 6 — Compute overall risk

Overall risk = MAX(size risk, path-sensitivity, cross-repo, churn).

| Overall | Recommendation |
|---------|----------------|
| LOW | Single reviewer sufficient |
| MODERATE | Tech Lead + one additional |
| HIGH | Tech Lead + named contract owner from Step 3 |
| CRITICAL | Hard stop — Escalation Alert. Must split PR or get explicit pre-merge approval from named owner |

## Step 7 — Classify the change type

From commit messages (`git log --oneline`) and file paths, classify:

| Type | Signal |
|------|--------|
| `feature` | Commit messages contain "add", "implement", "new"; new files added |
| `bugfix` | Commit messages contain "fix", "bug", "issue", "resolve"; ticket prefix matches a defect ID |
| `refactor` | Commit messages contain "refactor", "extract", "rename", "move"; no new public API |
| `chore` | Commit messages contain "chore", "deps", "version", "lint"; only config / lockfiles changed |
| `docs` | Only `.md` / `docs/**` changed |
| `test` | Only test files changed |
| `breaking` | Diff contains schema deletion or rename in hot-path |

## Step 8 — Recommend reviewers

Required reviewers per repo are `default_reviewers[]` on the matching entry in `config.repos[]` (also compiled into `reviewer-map.json#default_reviewers_by_repo`) — resolve them with `?reviewers` or `?gov <repo-id> reviewers` rather than restating a table here. A repo whose `role_in_stack` includes a platform with irrotatable secrets (see `protected_paths[]`) must never be auto-reviewed; its owners require explicit named approval per the Escalation Alert.

Add the contract owners surfaced by Step 3's path-sensitivity lookup.

De-duplicate the list.

## Step 9 — Output

```
=== Diff Risk Report — <branch-or-PR-id> ===
Source → Target: <source> → <target>
Files changed:   N
Lines:           +A / -D  (size: <LOW|MODERATE|HIGH|CRITICAL>)
Commits:         N
Repos touched:   <list>  (cross-repo: <LOW|MODERATE|HIGH>)
Change type:     <feature|bugfix|refactor|chore|docs|test|breaking>

Path sensitivity: <LOW|MODERATE|HIGH|CRITICAL>
  Top sensitive files:
    <file>   <sensitivity>   <reason>
    ...

Churn:
  <file>   N commits in last 30 days   CHURN_HOT
  ...

Overall risk: <LOW|MODERATE|HIGH|CRITICAL>

Recommended reviewers (paste into PR description):
  - <reviewer name> (<reason>)
  - ...

Recommended split (if CRITICAL):
  PR 1: <subset of files>  → <reviewer>
  PR 2: <subset of files>  → <reviewer>

Pre-PR actions:
  [ ] Run /contract-review if HIGH or CRITICAL path-sensitivity
  [ ] Run /schema-drift if schema files touched
  [ ] Add Escalation Alert ref to PR description if CRITICAL
```

## On CRITICAL path-sensitivity or overall

Output the Escalation Alert from CLAUDE.md immediately. Do not proceed to `/pr-create` until the user confirms named-owner approval is in hand.

## How `/pr-create` should use this

In `/dev/pr-create.md` Step 4 (assemble PR description), before writing the reviewer line:
1. Invoke `/diff-risk` for the current branch
2. Take its "Recommended reviewers" list
3. Pre-fill the PR description's reviewer section with that list
4. If overall risk is HIGH or CRITICAL, surface the Escalation Alert in the PR's Risk section

## Permissions

Allowed: Read repo files, run `git diff`/`log`, run `grep`.
Blocked: Pushing branches, opening PRs in ADO, sending Teams messages. The skill produces text — the user takes action.
