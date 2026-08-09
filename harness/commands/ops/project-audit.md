# /ops/project-audit -- Full Chronological Project Audit

Generates a full chronological change log for a business initiative — every commit with its changed files, sorted oldest-first across all configured repos (`config.repos[]`). Output is terminal-only; nothing is written to disk.

## Project resolution

Same order as `/ops/project-status`:
1. CLI argument (e.g. `/ops/project-audit PROJ-Q2-CHECKOUT`)
2. `CLAUDE_PROJECT` env var
3. `.claude/projects/current.json`
4. Prompt user to select from active projects in `.claude-projects/registry.json`

## Step 1 -- Load project tickets

Read `.claude-projects/registry.json`. Extract the `tickets` array for the resolved project.

## Step 2 -- Collect commits from each repo

For each configured repo (`config.repos[]`), run:

```bash
git -C "<repo-path>" log \
  --grep="TICKET-A" --grep="TICKET-B" \
  --format="%H|%ad|%an|%ae|%s" --date=short \
  --no-merges --all --regexp-ignore-case
```

## Step 3 -- Get changed files per commit

For each commit SHA returned above:

```bash
git -C "<repo-path>" diff-tree --no-commit-id -r --name-only <SHA>
```

Omit file paths under any `protected_paths[]` entry with `never_index: true` (e.g. the integration-layer system-token directory). Replace each with: `[security file — path omitted per CLAUDE.md]`

## Step 4 -- Merge and sort

Merge results from all repos. Sort globally by commit date ascending (oldest first). Where two commits share the same date, preserve the within-repo chronological order.

## Step 5 -- Output chronological log

Note at top: `Contains author emails — do not share externally without review.`

```
PROJECT AUDIT — PROJ-Q2-CHECKOUT: Q2 Checkout Redesign
=======================================================
Total: 24 commits across 3 repos | Queried: YYYY-MM-DD
Contains author emails — do not share externally without review.

2026-04-15  <frontend-repo>       SHOPPURCH-12849  <author name> <author@example.com>
  abc1234  Add checkout step container component
  Files: checkout-ui.frontend/src/react/views/CheckoutStep.tsx
         checkout-ui.frontend/src/react/state/checkout.saga.ts

2026-04-16  <cif-repo>            TICKET-4421      <author name> <author@example.com>
  ghi9012  Add cartMinimum field to GraphQL cart type
  Files: cif/cart/cartResolver.js
         cif/cart/__tests__/cartResolver.test.js

[continues...]
```

## Step 6 -- Summary block

```
SUMMARY
  <frontend-repo>:  14 commits | 42 files changed
  <cif-repo>:        7 commits |  9 files changed
  <webapp-repo>:     3 commits |  5 files changed
  <migration-repo>:  0 commits

  SHOPPURCH-12849: 11 commits across 2 repos
  SHOPPURCH-12850:  6 commits, 1 repo
  TICKET-4421:      7 commits, 1 repo

OPEN ITEMS
  SHOPPURCH-12901 has 0 commits — ticket is registered but no git activity found. Has work started?
```

List any ticket from the registry project that has zero commits as an open item. If all tickets have commits, omit the OPEN ITEMS section.
