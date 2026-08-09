# /ops/project-status -- Cross-Repo Project Status

Live cross-repo view of a business initiative — branches, commits, and contributors across all configured repos (`config.repos[]`). All data comes from git in real time; no extra files needed.

## Project resolution

Resolve the active project in this order:
1. CLI argument provided to this skill (e.g. `/ops/project-status PROJ-Q2-CHECKOUT`)
2. `CLAUDE_PROJECT` environment variable
3. `.claude/projects/current.json` — read the `project_id` field
4. Prompt the user to select from active projects in `.claude-projects/registry.json`

## Step 1 -- Load project tickets

Read `.claude-projects/registry.json`. Extract the `tickets` array for the resolved project.

Check all registry projects for ticket collisions (same ticket ID appearing in multiple projects). Warn before the status table if found:

```
WARNING: SHOPPURCH-12849 also appears in PROJ-ACCOUNT-PORTAL. Results below may overlap with that initiative.
```

## Step 2 -- Query commits across all repos

For each configured repo (`config.repos[]`), run one `git log` covering all project tickets (OR logic — any ticket match counts):

```bash
git -C "<repo-path>" log --oneline --no-merges --all --regexp-ignore-case \
  --grep="SHOPPURCH-12849" --grep="SHOPPURCH-12850" --grep="TICKET-4421"
```

Repo paths: `<workspace>/<config.repos[].dir>` for each active repo — resolve via `?gov repos` or the Titan session header.

If a repo directory does not exist at the expected path, note "Repo not found locally — skipped."

## Step 3 -- Query branches

For each repo, list matching branches:

```bash
git -C "<repo-path>" branch -a | grep -iE "SHOPPURCH-12849|SHOPPURCH-12850|TICKET-4421"
```

## Step 4 -- Scan for PR stamps

```bash
git -C "<repo-path>" log --oneline --grep="Project: PROJ-Q2-CHECKOUT" --all
```

## Step 5 -- Output status table

```
Project Status: PROJ-Q2-CHECKOUT — Q2 Checkout Redesign
Queried       : YYYY-MM-DD
Tickets       : SHOPPURCH-12849, SHOPPURCH-12850, TICKET-4421

Repo                Branches (open)   Commits   Latest commit
<frontend-repo>     2                 14        abc1234  2026-05-06
<webapp-repo>       —                  3        def5678  2026-05-04
<migration-repo>    —                  0        —
<cif-repo>          1                  7        ghi9012  2026-05-07

PR stamps found: 3 commits tagged "Project: PROJ-Q2-CHECKOUT"

Per-ticket breakdown:
  SHOPPURCH-12849  : 11 commits across 2 repos
  SHOPPURCH-12850  :  6 commits, 1 repo
  TICKET-4421      :  7 commits, 1 repo
```

## Guardrails

- Commits touching a `protected_paths[]` entry with `never_index: true` (e.g. the integration-layer system-token directory) are counted but file paths are not shown. Report: "Security commits: N (file paths omitted per CLAUDE.md)."
- If a ticket appears in multiple projects, prefix output with a collision warning.
- If a repo directory does not exist at the expected path, skip it and note the skip.
