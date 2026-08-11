# /branch — Context Branch

Fork the current conversation into an isolated side-chain. The side-chain inherits a snapshot of the current session context (active mode, task, key decisions, files in scope) so the sub-task runs without polluting the main chat. When the branch finishes, `/branch-merge` outputs a summary block to paste back.

Works across all modes — no mode switch needed.

**Caveman:** inherits the active mode's intensity. No override.

---

## Usage

```
/branch "side-task description"
```

`$ARGUMENTS` — required. Short description of the sub-task (e.g. `"debug cart total rounding"`, `"prototype CIF resolver change"`, `"research OCC stock endpoint options"`).

---

## Step 1 — Check for an existing open branch

Glob `<REPO>/.claude/branches/*.md`. Parse `status:` from each file's frontmatter.

- If any branch has `status: open`:
  ```
  BLOCKED — open branch already exists for this repo:
    <id>  "<task>"  (created <date>)

  Close or merge it first:
    /branch-close   — discard without merging
    /branch-merge "<summary>"  — merge result to main session
  ```
  Stop here.

- If none: proceed.

---

## Step 2 — Determine the active repo

Read the active repo from session context (G1 guardrail, last file read, or stated task). If ambiguous, ask:
`"Which repo are we working in?"` (see `config.repos[]` for the active list)

Use the repo root as `<REPO>` for all file paths in subsequent steps.

---

## Step 3 — Generate branch ID

```
YYYYMMDD-HHMMSS-<slug>
```

Slug: lowercase, hyphens only, max 30 chars, derived from `$ARGUMENTS`.

Example: `20260519-143022-debug-cart-total-rounding`

---

## Step 4 — Capture context snapshot

Build the context block from current session state:

| Field | Source |
|-------|--------|
| `PARENT_MODE` | Active mode: `dev-mode` / `arch-mode` / `lead-review` / `po-mode` / `grill-me` |
| `PARENT_TICKET` | ADO ticket from session or G7 progress file, else `none` |
| `PARENT_REPO` | Repo name (from Step 2) |
| `PARENT_BRANCH` | Git branch if known from session, else `unknown` |
| `FILES_IN_SCOPE` | Paths read this session, comma-separated (max 20) |
| `KEY_DECISIONS` | Bullet list of constraints and decisions established this session |
| `OPEN_TASKS` | What the main session is paused on while the branch runs |
| `ACTIVE_GUARDRAILS` | G0–G7 names active in the parent mode |

If `KEY_DECISIONS` are not explicit in the conversation, summarize from context. If genuinely unclear, ask one question:
`"What's the most important constraint from our conversation so far that the branch session needs to know?"`

---

## Step 5 — Write the branch context file

Ensure the branches directory exists and is gitignored:

```bash
mkdir -p "<REPO>/.claude/branches"
grep -qF ".claude/branches/" "<REPO>/.gitignore" 2>/dev/null || echo ".claude/branches/" >> "<REPO>/.gitignore"
```

Write `<REPO>/.claude/branches/<id>.md`:

```markdown
---
id: <id>
created: <ISO-8601>
status: open
parent_mode: <PARENT_MODE>
parent_ticket: <PARENT_TICKET>
task: <$ARGUMENTS>
---

# Branch: <$ARGUMENTS>

## Parent Session State

- **Mode:** <PARENT_MODE>
- **Ticket:** <PARENT_TICKET>
- **Repo:** <PARENT_REPO>
- **Branch:** <PARENT_BRANCH>
- **Files in scope:** <FILES_IN_SCOPE>
- **Open tasks (main session paused on):** <OPEN_TASKS>

## Key Decisions & Constraints

<KEY_DECISIONS — one bullet per decision>

## Active Guardrails

<ACTIVE_GUARDRAILS — e.g. G0 code explanation, G1 module placement, G3 credentials, G4 hard stops>

## Branch Task

Work on: **<$ARGUMENTS>**

When done: run `/branch-merge "<one-line result summary>"`.
To discard: run `/branch-close`.
```

---

## Step 6 — Launch new terminal tab

Detect available terminal and launch Claude Code in the workspace root (the directory containing the configured repos — `c:\codebase\ecom-webapp` or equivalent):

```powershell
# Windows Terminal (preferred)
wt new-tab -d "<workspace-path>" cmd /k claude

# Fallback if wt not available
Start-Process cmd -ArgumentList "/k", "claude" -WorkingDirectory "<workspace-path>"
```

Use the Bash tool to execute. If both fail, skip silently and note in the output that the user must open a new terminal manually.

---

## Step 7 — Output launch instructions

```
BRANCH CREATED ──────────────────────────────────────────────
ID:     <id>
Task:   <$ARGUMENTS>
File:   <REPO>/.claude/branches/<id>.md
─────────────────────────────────────────────────────────────

A new Claude Code window has opened (or open one manually).
Paste this as your first message in the new window:

  Load branch context from <REPO>/.claude/branches/<id>.md and confirm the task.

Main session is paused on: <OPEN_TASKS>
When the branch finishes, run /branch-merge in that window, then paste the
output block back into this session.
─────────────────────────────────────────────────────────────
```

---

## Restrictions

- One open branch per repo at a time (enforced in Step 1).
- Branch files are local only — never committed (gitignored in Step 5).
- PHI/PII rules from CLAUDE.md apply — no sensitive data in branch context files.
- Hard-stop escalation rules still apply inside the branch session (G4).
- Branch sessions inherit the parent mode's guardrails — they do not start modeless.
