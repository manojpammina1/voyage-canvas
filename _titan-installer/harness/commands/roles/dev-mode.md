# /dev-mode -- Developer Mode

Activate. Enforce all 6 guardrails continuously throughout this session.

**Caveman intensity for this role:** `lite`. Narrative around code is compressed. **G0 below overrides** Caveman for all line-by-line code explanations — those stay verbose regardless of intensity. Generated code is never compressed.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). G0 below continues to override caveman for code explanations regardless. Respect `stop caveman` or `normal mode` if user issues them — remain in dev-mode but with caveman off.

## Model — Sonnet by Default

Dev mode runs on **Sonnet** by default. No model prompt needed at activation — proceed directly.

> **Default:** Sonnet (`claude` — no flag). Fast, accurate for code generation, bug fixing, tests, and PR assembly.

### When to escalate to Opus mid-session

If the developer observes any of the following, type `escalate to opus` in the chat — no terminal restart needed:

| Signal | What it looks like |
|--------|-------------------|
| Hallucinated API / method | Model references a function, endpoint, or prop that does not exist in the codebase |
| Contradictory output | Model produces a fix that conflicts with a constraint it acknowledged earlier in the session |
| Repeated wrong file placement | Model keeps placing files in the wrong module despite G1 guardrail corrections |
| Cross-repo reasoning failure | Model cannot correctly trace a data flow across the CIF-role repo → frontend repos |
| Missing scenario blindspot | `/common/missing-scenarios` surfaces the same gap more than once after fixes |

To escalate, type either of these in the chat at any point:

```
escalate to opus
```
or
```
switch to opus
```

**No terminal restart. No session close. The escalation runs inline.**

### What happens when triggered

Claude immediately spawns an Opus sub-agent using the Agent tool (`model: "opus"`) for the specific failing task. The developer stays in the current session.

Claude constructs the sub-agent prompt with:
- The exact task that produced the hallucination or incorrect output
- The relevant file paths and code context already read in this session
- The guardrails (G1–G7) that apply
- The specific signal the developer observed (from the table above)

The Opus sub-agent returns its output directly into the current session. Claude presents it to the developer and asks: **"Does this resolve the issue? Continue on Sonnet, or keep Opus for the rest of this task?"**

If the developer answers **"keep Opus"** — Claude continues spawning Opus sub-agents for each subsequent code generation step in this task until the developer says `back to sonnet`.

If the developer answers **"continue on Sonnet"** — Claude resumes normally using the Opus output as the correct reference.

> **Disclaimer:** Escalating to Opus does not guarantee the hallucination disappears — it increases the depth of reasoning. If Opus also hallucinates on the same task, the root cause is likely missing context (wrong file read, stale progress state, or undocumented cross-repo contract). Fix the context first, then re-trigger.

### What Claude does when triggered

When the developer types `escalate to opus` or `switch to opus`:

1. Output one line:
   ```
   Escalating to Opus for this task. Spawning sub-agent now...
   ```
2. Spawn an Opus sub-agent using the Agent tool with `model: "opus"`. The prompt must include:
   - The failing task (what was being built or fixed)
   - The hallucination signal observed
   - All file paths and code snippets already read this session
   - Active guardrails: G1 module placement, G2 naming, G3 credentials, G4 hard stops, G5 React/Redux consistency
   - Instruction: "Produce the correct output. Do not repeat the error."
3. Present the Opus sub-agent output to the developer in full.
4. Ask:
   ```
   Does this resolve the issue?
     "yes, continue on Sonnet" — resume using this as the fix
     "keep opus"               — spawn Opus sub-agents for each subsequent step
     "still wrong"             — read missing context, retry on Opus once more
   ```
5. On `back to sonnet` typed at any point — resume Sonnet for all subsequent steps.

Do not generate any code between step 1 and step 3.

---

## G0 -- Code explanation (always full, never compressed)

Every generated code block (function, component, class, config, test, build snippet) must include line-by-line / block-by-block explanation suitable for a mid-level offshore developer.

- Explain the WHY and the logic/pattern, not basic language syntax.
- Cover: what each significant block does, why that approach was chosen, any project-specific constraint being followed (e.g. why Redux HOC not hooks, why LESS not SCSS, why this module path).
- Skip framework basics (AEM lifecycle, React fundamentals, Maven structure) -- the user already knows these.
- DO explain project-specific decisions, business logic, non-obvious choices, and any active guardrail being satisfied.

**Caveman precedence:** When the `caveman` output-compression skill is active in this session, this G0 rule OVERRIDES Caveman for all code-block explanations. Caveman compresses narrative text but must not compress explanations attached to generated code. Treat code explanations the same way Caveman treats security warnings -- preserve in full.

## G1 -- Module placement

- Java OSGi service/servlet/model -> `*-core/src/main/java/`
- HTL/Sightly -> `*-ui.apps/src/main/content/jcr_root/apps/`
- OSGi config -> `*-ui.config/src/main/content/jcr_root/apps/*/config/`
- JCR content/templates -> `*-ui.content/`
- React/Redux/hooks -> `*-ui.frontend/src/main/webpack/app/react/`
- LESS -> the repo's shared Gulp frontend module or the active-production webapp's `shop-ui.frontend/`
- SCSS -> any other Webpack-based `*-ui.frontend/` module

Stop and flag before writing if placement is wrong. Module naming and per-repo conventions are defined by `config.repos[].module_naming` -- resolve with `?gov` if unsure.

## G2 -- Naming

Follow `config.repos[].module_naming[]` for the active repo -- never mix prefixes across repos in the same change. See `?gov` or the Titan session header for the current naming pattern per repo role (frontend / webapp / migration / etc).

## G3 -- Credentials/data

Stop if: credentials/tokens/API keys/env URLs hardcoded; PHI/PII or regulated customer data; committed `options.json`.

## G4 -- Hard stops

Check current module against CLAUDE.md Hard Stops / `protected_paths[]`. If triggered: output Escalation Alert from CLAUDE.md immediately -- no code first.

## G5 -- React/Redux consistency

- Active-production webapp Redux: match the file -- sagas OR slices OR thunks, never mix
- Other frontend repos' Redux: match HOC (`connect()`) or hooks (`useSelector`/`useDispatch`), never mix
- Stylesheets: match the per-repo convention in `config.stack.frontend.stylesheets` (LESS vs SCSS) -- never mix in one module
- Component type: match class vs functional -- no conversion without project lead direction

## G6 -- Pre-flight

- CIF/integration-layer repo -> run `/common/cif-check`
- Migration-role repo -> run `/common/migration-check`
- `.cloudmanager/` or pipeline files in the active-production webapp -> hard stop, escalate via `?gov` (aem/pipeline owner)

## G7 -- Resumable tasks

For any task spanning more than two milestones (Analysis → Implementation → Tests → PR is a 4-milestone task):

**At session start:** Check for an existing progress file before writing any code:
```bash
ls <repo>/.claude/progress/<TICKET-ID>.json 2>/dev/null
```
- Found → run `/common/task-progress resume <TICKET-ID>` to orient the session before anything else.
- Not found → suggest `/common/task-progress init` to start tracking.

**After each milestone:** Run `/common/task-progress checkpoint <TICKET-ID>`. The note field is mandatory — capture the exact file path and key decision made. This is what the next session reads.

**Before creating the PR:** Confirm all milestones are complete (`status: done`) in the progress file.

Short tasks (single file edit, bug fix with one change) do not need progress tracking.

## Dev sub-contexts

These tasks are part of dev work — no mode switch required. Invoke them directly from within this session:

| Command | When to use |
|---------|------------|
| `/unit-test` | Writing or auditing tests — applies Jest+RTL, JUnit 5, Mocha rules and guardrails |
| `/pr-create` | Ready to submit — reads the branch diff and assembles an Azure DevOps PR description (text only, no push) |
| `/offshore-brief` | Handing a task to offshore — scans scope for hard-stops, writes a scoped task brief |

## Parallel work — worktree isolation

When a task requires two or more agents writing code simultaneously, or an agent must run a full build without interfering with the developer's workspace:

1. Create a worktree first: `bash .claude/scripts/worktree-create.sh "<repo>" "<ticket-id-description>" "<base-branch>"`
2. Point each agent to its own worktree path — never to the main checkout
3. When agents finish, diff and review before merging: `git -C <repo> diff <base>...claude/<name>`
4. Clean up: `bash .claude/scripts/worktree-cleanup.sh "<repo>" "<name>"`

Use `/common/worktree-agent` for the full step-by-step pattern.

Never spawn two agents writing to the same worktree or the same files in the main checkout simultaneously.

## Reminders (prompt automatically)

- After feature: *"Run `/common/missing-scenarios` before we call this done."*
- Before build: *"Run `/common/aem-build` for the exact command."*
- File near 300 lines: *"Extract to a hook in `react/hooks/` first."*
- New dependency: *"Needs project lead review before merge."*

## Permissions

Allowed: `mvn clean install -DskipTests`, `npm run dev`, `gulp`, `yarn/npm test`, `npx jest`, read-only git.
Blocked: `git push`, `-PautoInstallSinglePackage`, `rm -rf`, `curl`, `wget`. Permanently blocked: see CLAUDE.md.

## Pre-PR checklist (on "I'm done" / "ready to submit")

- [ ] **Step 0: `/common/ci-gate`** -- build + all tests pass locally. PR is BLOCKED until CI GATE PASSED is output.
- [ ] `/common/review-fix-loop` -- all reviewers SATISFIED before raising the PR
- [ ] `/common/check-conventions` -- no FAILs; `/common/missing-scenarios` -- items have tickets
- [ ] CIF touched: `/common/cif-check` + `yarn test` green; Migration: `/common/migration-check` + `mvn test` green
- [ ] No credentials/tokens/URLs/PHI/PII
- [ ] `/common/task-progress checkpoint` -- all milestones marked complete (if task was tracked)
- [ ] PR explains why; ticket number in title; project lead assigned
