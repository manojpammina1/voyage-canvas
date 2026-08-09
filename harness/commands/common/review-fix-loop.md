# /review-fix-loop — Pre-PR Review and Self-Fix Loop

Run all reviewer agents against your current branch, then automatically apply fixes for any findings and re-run until all reviewers are satisfied or human input is needed. Invoke before `/pr-create` to catch and fix issues locally.

**Requires:** Active git branch with changes against a known base branch.

**Permissions note:** This skill commits fix batches to your local branch. It does NOT push. Use `/dev/pr-create` to push after this skill clears.

---

## Step 0 — Collect the diff

Identify the working repo and base branch:

```bash
git -C "<repo-path>" rev-parse --abbrev-ref HEAD
git -C "<repo-path>" diff origin/<base>...HEAD --name-only
git -C "<repo-path>" diff origin/<base>...HEAD
```

Store:
- `REPO` — which repo in `config.repos[]` this branch belongs to
- `BASE_BRANCH` — the target branch this PR will merge into
- `SOURCE_BRANCH` — current working branch
- `DIFF` — full unified diff
- `FILES_CHANGED` — list of changed file paths

If `FILES_CHANGED` is empty, stop: "No changes detected against `<base>`. Nothing to review."

---

## Step 1 — Governance gate (inline, before any agent spawning)

Scan `FILES_CHANGED` for hard-stop patterns from CLAUDE.md. If any match, output the Escalation Alert from CLAUDE.md and stop — do not proceed to Step 2.

Resolve each match against `config.protected_paths[]` (via `?gov <path>` / `data/reviewer-map.json`) to get the named owner: credentials/tokens/API keys/PHI in the diff, release/golden-copy pipeline files, cloud-deploy config directories, commerce-integration config files, committed secret/option files, hybris-api/impl or PIM module paths, CI/CD pipeline directories (`ci/`, `pipeline/`, `cd-deploy/`), system-token / secret-token paths, and GraphQL field additions/removals/renames (owner from `config.contracts[].owners`).

---

## Step 2 — First review pass (parallel)

Spawn all applicable reviewers simultaneously using the Agent tool. Pass `REPO`, `SOURCE_BRANCH`, `BASE_BRANCH`, and `DIFF` to each.

| Subagent | Focus | Model | Run when |
|----------|-------|-------|----------|
| `correctness-reviewer.md` | Logic bugs, null errors, race conditions | sonnet | Always |
| `reliability-reviewer.md` | Commerce-API errors, session expiry, duplicate submit | sonnet | Always |
| `maintainability-reviewer.md` | Module boundaries, naming, dead code | haiku | Always |
| `code-reviewer.md` | Convention violations, hard-stops, credentials | sonnet | Always |
| `cif-contract-checker.md` | GraphQL / commerce-API contract validation | sonnet | Only if FILES_CHANGED includes `.graphql`, a hybris/commerce-API path, `app.config.yaml`, or integration-layer files |
| `test-validator.md` | Run tests, PHI in fixtures | haiku | Only if FILES_CHANGED includes new `.java`, `.tsx`, or `.jsx` files |
| `component-usage-reviewer.md` | Shared component compliance — flags raw HTML where a discovered shared component exists | haiku | Only if FILES_CHANGED includes `.tsx` or `.jsx` files |

Collect each agent's full output, including the `review_state` YAML block at the end.

---

## Step 3 — Aggregate state

Parse the `review_state` YAML block from each reviewer's output. Aggregate into `LOOP_STATE`:

| Condition | LOOP_STATE |
|-----------|-----------|
| All reviewers returned `state: SATISFIED` | `ALL_CLEAR` |
| Any reviewer returned `state: NEEDS_CLARIFICATION` | `BLOCKED` |
| Any reviewer returned `state: UNSATISFIED`, none returned `NEEDS_CLARIFICATION` | `FIXABLE` |

**If `ALL_CLEAR`:** Skip to Step 6 (clean report).
**If `BLOCKED`:** Output the blocker_reason from each NEEDS_CLARIFICATION reviewer and stop. Do not attempt fixes — human escalation is required.
**If `FIXABLE`:** Continue to Step 4.

---

## Step 4 — Fix cycle (max 3 iterations)

Track `ITERATION` starting at 1.

### 4a — Collect and display fixable findings

From all reviewers with `state: UNSATISFIED`, collect `fixable_findings`. Group by file. Present to the user:

```
Iteration N of 3 — N finding(s) across N reviewer(s)

src/react/components/cart/CartSummary.tsx
  [DEFECT]    line 87  — Direct state mutation in reducer
               Fix: Return new object — { ...state, cart: {} }

  [VIOLATION] line 23  — HOC connect() mixed with useSelector
               Fix: Remove useSelector; use mapStateToProps instead

src/main/java/com/example/cart/CartService.java
  [WARNING]   line 44  — Null JCR property used without null check
               Fix: Add null guard before accessing value
```

Ask: **"Apply these fixes? (yes / skip [N] / stop)"**

- `yes` — apply all approved findings
- `skip N` — skip finding number N (user will fix manually)
- `stop` — abort loop, output remaining findings

### 4b — Apply fixes

For each approved finding, apply the `fix_hint` using the Edit tool. If the fix requires reading the surrounding method for context, Read the file first, then Edit. Apply file by file.

Do not invent fixes beyond what `fix_hint` describes. If a fix_hint is ambiguous, ask the user to clarify before editing.

### 4c — Build sanity check

After all edits in this iteration, run the build for the affected repo:

```bash
# DT Ecommerce / Webapp — Java module touched
mvn clean install -DskipTests -pl <changed-module> -f <repo>/pom.xml

# DT Ecommerce / Webapp — frontend only
cd <repo>/<module>-ui.frontend && npm run build --if-present

# CIF integration repo
cd <repo> && yarn build --if-present
```

If the build fails: report the error, do not commit, stop the loop. The developer must fix the broken build manually before re-running.

### 4d — Commit the fix batch

```bash
git -C "<repo>" add <list of modified files only — never git add .>
git -C "<repo>" commit -m "fix(review-loop): iteration N — <comma-separated reviewers that were UNSATISFIED>"
```

Use this exact prefix (`fix(review-loop):`) so these commits are identifiable and easy to squash before PR creation.

### 4e — Re-run unsatisfied reviewers only

Spawn only the reviewers that returned `UNSATISFIED` in the previous pass. Pass the updated diff:

```bash
git -C "<repo>" diff origin/<base>...HEAD
```

Collect new `review_state` YAML blocks.

### 4f — Check convergence

- All previously-UNSATISFIED reviewers now return `SATISFIED` → set `LOOP_STATE: ALL_CLEAR`, go to Step 6.
- Any reviewer still `UNSATISFIED` and `ITERATION < 3` → increment `ITERATION`, return to Step 4a.
- `ITERATION = 3` and still `UNSATISFIED` → go to Step 5.

---

## Step 5 — Escalate after max iterations

```
REVIEW-FIX LOOP — MAX ITERATIONS REACHED (3 / 3)

The following findings were not resolved automatically:

<list remaining UNSATISFIED findings with file:line and fix_hint>

Action required:
1. Review each finding manually.
2. Apply fixes and commit.
3. Re-run /common/review-fix-loop to re-validate.

Do NOT run /pr-create until all reviewers return SATISFIED or you have accepted
each remaining finding with an explicit justification recorded in the PR description.
```

---

## Step 6 — Clean report

```
REVIEW-FIX LOOP — ALL CLEAR

Reviewers:      [list of reviewer names] — all SATISFIED
Fix iterations: N  (0 = no fixes needed)
Fix commits:    [list of short SHAs, or "none"]

Branch is ready for PR creation.
Next: /dev/pr-create
```

If fix-loop commits were made, add:

```
Squash note: The fix loop made N commit(s) prefixed "fix(review-loop):".
You may squash these before pushing:
  git -C <repo> rebase -i origin/<base>
This is optional — the PR works either way.
```
