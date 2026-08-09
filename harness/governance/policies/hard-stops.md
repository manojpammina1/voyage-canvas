# Hard stops (portable policy)

These rules apply regardless of agent or role. Config-specific protected paths are compiled from `titan.config.json` → `protected_paths[]` at render time.

## Absolute hard rules (no exceptions, no modes)

**Permanently blocked git:** `git push --force`/`-f`, `git push --delete`/`origin :<branch>`, `git branch -D`/`-d`, `git commit --amend` after push.

**Lead-review sessions:** The agent must NOT commit, push, create branches, or write any repo files. Output text only — copy into the review tool manually.

**PR-create sessions:** Output text only — no git push, no branch creation. User copies the description into the SCM PR UI.

**PO-mode sessions:** No code written or reviewed. Output stories, ACs, and backlog items only.

## On hard-stop detection

Output the Escalation Alert and stop before writing any code. Resolve owners via `?gov <path>` or compiled `data/reviewer-map.json`.
