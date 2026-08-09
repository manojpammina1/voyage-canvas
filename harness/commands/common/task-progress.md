# /task-progress — Resumable Task Progress Tracking

Utility skill for tracking multi-milestone task progress across Claude sessions. Reads and writes `.claude/progress/<TICKET-ID>.json` so a new session can resume from the last completed milestone without restarting from scratch.

Invoke with a sub-command: `init`, `checkpoint`, `resume`, or `status`.

---

## Progress file location

```
<repo>/.claude/progress/<TICKET-ID>.json
```

This path is gitignored — it persists locally on the developer's machine and is never committed.

If `.claude/progress/` is not yet in the repo's `.gitignore`, append it:

```bash
echo ".claude/progress/" >> <repo>/.gitignore
```

---

## Sub-commands

### `init` — Start tracking a new task

```
/task-progress init
```

Ask the user for:
1. Ticket ID (e.g. `ECOM-1234`)
2. Task name (one sentence)
3. Repo (DT Ecommerce / Webapp / Migration / CIF Layer)
4. Branch name (feature branch being worked on)
5. Base branch (target for the eventual PR — usually `develop`)
6. Milestone list — the major phases of work in order

Write `.claude/progress/<TICKET-ID>.json`:

```json
{
  "task_id": "ECOM-1234",
  "task_name": "Add minimum order quantity validation to cart",
  "repo": "<repo id from config.repos[]>",
  "branch": "feature/ECOM-1234-moq-validation",
  "base_branch": "develop",
  "created": "<ISO-8601 timestamp>",
  "last_updated": "<ISO-8601 timestamp>",
  "status": "in_progress",
  "current_milestone": 0,
  "milestones": [
    { "name": "Analysis — read existing cart validation logic", "status": "pending" },
    { "name": "Java — CartService.validateMinimumOrderQty()", "status": "pending" },
    { "name": "React — MOQ warning component in CartSummary", "status": "pending" },
    { "name": "Tests — Jest + JUnit coverage", "status": "pending" },
    { "name": "Review — run /review-fix-loop", "status": "pending" },
    { "name": "PR — run /pr-create", "status": "pending" }
  ]
}
```

Output:
```
Progress file created: .claude/progress/ECOM-1234.json
6 milestones tracked. Starting at: "Analysis — read existing cart validation logic"

At the start of any new session, run:
  /task-progress resume ECOM-1234
```

---

### `checkpoint` — Mark the current milestone complete

After completing a milestone:

```
/task-progress checkpoint ECOM-1234
```

Read the progress file. Find the first milestone with `"status": "pending"`. Ask the user for a one-line note capturing the key decision or file reference from this milestone (e.g. the exact method modified, the key finding). Then update:

```json
{
  "name": "Java — CartService.validateMinimumOrderQty()",
  "status": "complete",
  "completed": "<ISO-8601 timestamp>",
  "note": "CartService.java:112 — throws MinimumOrderQuantityException when cart qty < threshold from OCC config"
}
```

Increment `current_milestone`. Update `last_updated`. Write back.

Output:
```
Milestone 2/6 complete: "Java — CartService.validateMinimumOrderQty()"
Next: "React — MOQ warning component in CartSummary"
```

If all milestones are complete, set top-level `"status": "done"` and output:
```
All 6 milestones complete. Task ECOM-1234 is done.
Next: /dev/pr-create
```

---

### `resume` — Load context at the start of a new session

```
/task-progress resume ECOM-1234
```

Read `.claude/progress/ECOM-1234.json`. Output a concise session brief that orients the new session without requiring the developer to explain the task again:

```
RESUMING ECOM-1234 — Add minimum order quantity validation to cart

Repo:    <repo id from config.repos[]>
Branch:  feature/ECOM-1234-moq-validation  (base: develop)
Updated: 2026-05-12 10:30

Progress: 2 / 6 milestones complete

  ✓  Analysis — read existing cart validation logic
  ✓  Java — CartService.validateMinimumOrderQty()
       Note: CartService.java:112 — throws MinimumOrderQuantityException
             when cart qty < threshold from OCC config

  →  React — MOQ warning component in CartSummary       ← START HERE
  ○  Tests — Jest + JUnit coverage
  ○  Review — run /review-fix-loop
  ○  PR — run /pr-create

Next action: Add the MOQ warning component to CartSummary.tsx.
             The threshold value comes from CartService via the OCC response.
```

If the progress file does not exist:
```
No progress file found for ECOM-1234.
Run /task-progress init to start tracking, or proceed without tracking.
```

---

### `status` — List all tasks with progress files

```
/task-progress status
```

Glob `.claude/progress/*.json`. For each file output one line:

```
TICKET     PROGRESS   STATUS       TASK NAME                                        LAST UPDATED
ECOM-1234  2 / 6      in_progress  Add minimum order quantity validation to cart     2026-05-12
ECOM-1198  6 / 6      done         Product detail page PIM 404 handling              2026-05-10
ECOM-1301  0 / 4      in_progress  CIF cart mutation — remove legacy field           2026-05-12
```

Done tasks are shown last. If no progress files exist: "No progress files found. Run /task-progress init to start tracking a task."

---

## Integration with /dev-mode

At the start of any task that will span more than two milestones, check for an existing progress file before writing any code:

```bash
ls <repo>/.claude/progress/<TICKET-ID>.json 2>/dev/null
```

- **Found:** Offer to run `/task-progress resume <TICKET-ID>` before starting. This orients the session without asking the developer to re-explain context.
- **Not found:** Suggest `/task-progress init` if the task has more than 2 milestones.
- **Task is short (≤ 2 milestones):** Skip — tracking overhead is not worth it for small changes.

## Milestone naming guidance

Keep milestone names action-oriented and specific. The note field written at checkpoint is the most important output — it carries forward the exact file paths and decisions the next session needs.

| Too vague | Better |
|-----------|--------|
| "Implementation" | "Java — CartService.validateMinimumOrderQty()" |
| "Frontend" | "React — MOQ warning banner in CartSummary.tsx" |
| "Done with tests" | "Tests — Jest CartSummary + JUnit CartServiceTest" |
