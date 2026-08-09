# /branch-merge — Merge Branch Result to Main Session

Closes the current branch session and outputs a formatted merge block. The user copies the block and pastes it into the main session so the parent conversation receives the result without the debugging clutter.

Run from within a branch session when the sub-task is complete.

**Caveman:** inherits active mode intensity. No override.

---

## Usage

```
/branch-merge "one-line result summary"
```

`$ARGUMENTS` — required. Concise statement of what was accomplished (e.g. `"cart rounding bug isolated to CIF resolver line 47 — fix ready"`, `"OCC stock endpoint confirmed: GET /products/{id}/stock, no auth scope change needed"`).

---

## Step 1 — Find the active branch

Glob `<REPO>/.claude/branches/*.md`. Parse `status:` from frontmatter. Find the file with `status: open`.

- If none found:
  ```
  No open branch found in <REPO>/.claude/branches/
  Nothing to merge. If you meant to merge a specific branch, check the file manually.
  ```
  Stop.

- If more than one open branch found, list them and ask:
  `"Multiple open branches found — which one are you merging?"`
  Wait for the user to specify by ID, then proceed with that file.

---

## Step 2 — Update branch file

Read the branch file. Update the frontmatter:

```yaml
status: merged
merged_at: <ISO-8601>
result: <$ARGUMENTS>
```

Write the file back.

---

## Step 3 — Output the merge block

Output this block to the terminal (the user selects and copies it):

```
─── BRANCH MERGE ────────────────────────────────────────────
Branch:  <id>
Task:    <task from branch file>
Result:  <$ARGUMENTS>
─────────────────────────────────────────────────────────────
```

If the result is complex (multi-step finding, multiple files changed, or a decision with trade-offs), add up to 4 bullet detail lines between Result and the closing rule:

```
─── BRANCH MERGE ────────────────────────────────────────────
Branch:  <id>
Task:    <task>
Result:  <$ARGUMENTS>

  • <detail line 1>
  • <detail line 2>
  • <detail line 3>  (max 4)
─────────────────────────────────────────────────────────────
```

Then output:

```
Paste the block above into the main session.
This window can be closed — branch <id> is now marked merged.
```

---

## Restrictions

- Only works from within a branch session (a session that loaded context from a `.claude/branches/*.md` file).
- If the user is in the main session and runs `/branch-merge` by mistake, output:
  ```
  /branch-merge is for use inside a branch session.
  In the main session, paste the merge block that the branch session produced.
  ```
- PHI/PII rules apply — do not include sensitive data in the result summary or detail lines.
