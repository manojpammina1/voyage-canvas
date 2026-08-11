# /branch-close — Close Branch Without Merging

Closes the current branch session and marks it as discarded. The branch context file is preserved on disk for reference — it is not deleted.

Run from within a branch session when the sub-task is being abandoned or parked without a result to merge.

**Caveman:** inherits active mode intensity. No override.

---

## Usage

```
/branch-close
```

No arguments. Optionally, a reason can follow: `/branch-close "reason"` — stored in the branch file as `close_reason`.

---

## Step 1 — Find the active branch

Glob `<REPO>/.claude/branches/*.md`. Parse `status:` from frontmatter. Find the file with `status: open`.

- If none found:
  ```
  No open branch found in <REPO>/.claude/branches/
  Nothing to close.
  ```
  Stop.

- If more than one open branch found, list them and ask which to close. Wait for user to specify.

---

## Step 2 — Update branch file

Read the branch file. Update the frontmatter:

```yaml
status: closed
closed_at: <ISO-8601>
close_reason: <$ARGUMENTS if provided, else "discarded without merge">
```

Write the file back.

---

## Step 3 — Output confirmation

```
BRANCH CLOSED ───────────────────────────────────────────────
Branch:  <id>
Task:    <task from branch file>
Status:  closed — no merge
File:    <REPO>/.claude/branches/<id>.md (preserved for reference)
─────────────────────────────────────────────────────────────
This window can be closed.
No changes were merged to the main session.
```

---

## Restrictions

- Only works from within a branch session.
- If run from the main session by mistake:
  ```
  /branch-close is for use inside a branch session.
  To close a branch from the main session, open a new Claude Code window,
  load the branch context, and run /branch-close there.
  ```
- The branch file is NOT deleted — it remains as an audit trail.
  To clean up old closed/merged branches, delete `.claude/branches/*.md` manually.
