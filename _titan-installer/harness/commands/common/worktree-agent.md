---
name: worktree-agent
description: Spawn an isolated Claude Code agent in a git worktree so it can write code without touching the developer's working tree or other agents' work.
---

# /worktree-agent

Spawn a code-writing agent in an isolated git worktree. Use this when you need to:

- Run two or more code-writing agents in **parallel** across different files or modules
- Keep agent-generated commits off the developer's active branch until ready for review
- Allow an agent to run a full build/test cycle without dirtying the developer's workspace

## When to use

| Scenario | Use worktree? |
|----------|---------------|
| Single agent, simple file edit | No — work directly in repo |
| Two agents touching different modules in parallel | Yes |
| Agent running `mvn clean install` or `npm run build` | Yes — avoids interfering with dev's build |
| Review-only agent (no writes) | No — read directly |
| Offshore task implementation (code + tests) | Yes |

## Step 0 — Confirm mode and repo

State the active repo and task:
```
Working in <repo> — worktree agent for: <task description>
```

Check that the repo has a valid `.git`:
```bash
git -C "<repo-path>" status
```

## Step 1 — Create the worktree

```bash
bash .claude/scripts/worktree-create.sh "<repo>" "<worktree-name>" "<base-branch>"
```

**Naming convention:** `<ticket-id>-<short-description>` — e.g. `ESRP-1234-cart-saga-fix`

The script creates:
- Worktree path: `<repo>/.claude/worktrees/<worktree-name>/`
- Branch: `claude/<worktree-name>` based on `<base-branch>`

## Step 2 — Spawn the agent

**Model selection:**

| Agent task | Model |
|-----------|-------|
| Writing/editing code, tests | sonnet |
| Running build or test validation only | haiku |
| Multi-module architectural refactor | opus |

Pass `model: "<model>"` on the Agent tool call. Default to `sonnet` for any code-writing agent.

Pass the worktree path as the working directory to the agent. The agent must:

1. Work **only** within its assigned module/files
2. Run the appropriate build or test command from within the worktree
3. Commit its changes to `claude/<worktree-name>` — message format: `[TICKET-ID] <imperative description>`
4. **Not push** — return a summary of commits made

Example agent prompt template:
```
Working in: <repo>/.claude/worktrees/<worktree-name>/
Branch: claude/<worktree-name>
Task: <description>
Scope: <files/modules to change>
Do NOT touch: <files/modules off limits>
Build command: <build or test command>
Commit when done. Do not push.
```

## Step 3 — Review agent output

After all agents complete:

1. Check commits in each worktree branch:
   ```bash
   git -C "<repo-path>" log claude/<worktree-name> --oneline -10
   ```

2. Diff against base:
   ```bash
   git -C "<repo-path>" diff <base-branch>...claude/<worktree-name>
   ```

3. Run governance check (invoke `/lead-review` or check for hard-stop files):
   ```bash
   git -C "<repo-path>" diff --name-only <base-branch>...claude/<worktree-name>
   ```

## Step 4 — Merge or discard

**Accept:** Cherry-pick or merge into the developer's branch:
```bash
git -C "<repo-path>" cherry-pick <commit-sha>
# or
git -C "<repo-path>" merge --no-ff claude/<worktree-name>
```

**Discard:** Clean up without keeping any changes:
```bash
bash .claude/scripts/worktree-cleanup.sh "<repo>" "<worktree-name>"
```

**Keep branch for PR:**
```bash
bash .claude/scripts/worktree-cleanup.sh "<repo>" "<worktree-name>" --keep-branch
```
Then push `claude/<worktree-name>` and raise an ADO PR against the base branch.

## Step 5 — Cleanup

Always clean up worktrees when done:
```bash
bash .claude/scripts/worktree-list.sh   # verify what's active
bash .claude/scripts/worktree-cleanup.sh "<repo>" "<worktree-name>"
```

## Parallel pattern example

For a task requiring changes in both a React module and a Java service:

```
Agent A: worktree = fix-cart-saga-fe
         scope = <repo>-cart-ui.frontend/src/
         build = npm run build (from worktree)

Agent B: worktree = fix-cart-saga-be
         scope = <repo>-cart-ui.core/src/main/java/
         build = mvn -pl <repo>-cart-ui.core test (from worktree)
```

Launch both agents in a single message (parallel Agent tool calls), then consolidate results in Step 3.

## Hard-stop check before spawning

Before creating any worktree, confirm the task does NOT touch hard-stop files — resolve the current list and owner for this area (see the Titan session header; `?gov <path>` for a specific file). Irrotatable secrets (platform config properties, `.p12`, `.jks`) never get agent writes regardless of owner.

If a hard-stop is in scope, output the Escalation Alert and stop.

## Governance note

All `claude/*` branches require Lead review before merge — same as any offshore PR. Use `/pr-create` to assemble the PR description after review.
