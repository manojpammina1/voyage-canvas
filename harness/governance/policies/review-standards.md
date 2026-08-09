# Review standards (portable policy)

## Principle

AI provides first-pass review; **a human is accountable for merged code**.

## Process

1. Governance pre-check against hard stops and protected paths.
2. Fan out specialist reviewers per `governance/reviewers/orchestration.yaml`.
3. Adversarial verification on non-empty findings (Claude: `adversarial-verifier.md`).
4. CI gate on changed modules where applicable.

## Entry points

| Agent | Command |
|-------|---------|
| Claude Code | `/orchestrate-review` |
| Codex / Cursor | `node .codex/review.mjs` or CI `agent-review` workflow |

Reviewer specs live in `governance/reviewers/*.md`.
