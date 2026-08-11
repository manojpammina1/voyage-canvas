# /debug — Structured Reproduce → Trace → Test-First Fix

A disciplined debug flow for non-trivial bugs in the stack. Forces a reproducible failing test BEFORE any code change — so the fix is provable, not "looks right." Use inside `/dev-mode`.

**Caveman intensity for this skill:** `lite`. Trace steps must be readable for offshore developers who may continue the debug session later.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). G0 from parent `/dev-mode` continues to apply — any code suggested gets full line-by-line explanation. Respect `stop caveman` if user issues it.

## Origin

Adapted from EveryInc `compound-engineering-plugin` `/ce-debug` pattern. Plugin not installed per CLAUDE.md.

## When to use

- Bug that resists a 10-minute fix attempt
- Bug whose symptom and cause are clearly separated by layers (e.g. frontend shows error, but cause is in OCC or PIM)
- Production-only bug — works in lower environments, fails in prod
- Bug surfaced by a customer report — root cause not yet known
- Intermittent / flaky test

Do NOT use for:
- One-line typo fixes
- Already-understood bugs where the fix is obvious
- New feature work (`/dev-mode` directly)

## Step 1 — Capture the symptom (exact, not paraphrased)

Ask the user:

1. **What is the exact observed behaviour?** (Quote error messages verbatim. Paste stack traces. Screenshot dimensions and URL if UI.)
2. **What is the expected behaviour?** (One sentence.)
3. **Environment** — Author / Publish / Local / Staging / Prod, which storefront (check `config.repos[]` / `qa-env.json` for the storefront count), which browser if frontend, which user role if Hybris auth matters.
4. **First time seen?** Or "this used to work"? If used to work: what changed (deploy, content update, OCC change, PIM update)?

Write this exactly. **Do not summarise.** Specific error strings are the search key for everything that follows.

## Step 2 — Reproduce locally

The bug must be reproducible before any code is written. Walk through:

1. **Minimum reproduction steps** — list them as numbered actions a developer can execute
2. **Required state** — logged-in user role, cart contents, product SKU, configurator state, etc.
3. **Reproduction confidence:** ALWAYS / SOMETIMES / NEVER-LOCAL

If reproduction is `NEVER-LOCAL`:
- Add logging to the suspect path and deploy to a non-prod environment
- Or write an integration test that simulates the production state shape

Do NOT proceed to Step 3 with `NEVER-LOCAL`. A "fix" without a repro is a guess.

## Step 3 — Write the failing test FIRST

This is the discipline. Before any code change:

| Repo / module | Test framework | Where the failing test goes |
|---------------|----------------|----------------------------|
| DT ecommerce React, webapp React | Jest + React Testing Library | `src/__tests__/<feature>.test.tsx` |
| DT ecommerce Java (`*-core`), migration Java | JUnit 5 + AEM Mocking | `src/test/java/.../<Feature>Test.java` |
| CIF integration repo | Mocha + Chai | `cif/**/__tests__/<resolver>.test.js` |
| HTL templates | Manual repro page in Author + screenshot diff | Track via /common/task-progress |

Write a test that:
- Asserts the **expected** behaviour
- FAILS today with the actual error
- Will PASS once the bug is fixed
- Is named so it stays meaningful: `should reject duplicate cart submit when network is slow` (NOT `test1`)

Run the test. Confirm it fails with the exact error from Step 1. If it doesn't fail in the same way, the test doesn't actually reproduce the bug — go back to Step 2.

## Step 4 — Trace the call path

Now find the cause. For each layer, identify what THIS layer hands off to the next:

| Layer | What to check |
|-------|---------------|
| UI component | What state / prop value did the component see? What did `useSelector` return? |
| Redux store | What action was dispatched, in what order? What was the saga's input? |
| API call | What URL, headers, body? Network tab or saga log. |
| CIF resolver | Which GraphQL field path? What did the resolver receive from OCC? |
| OCC / Hybris | What was the HTTP request? What HTTP status came back? What body? |
| Database / Solr | What query? What result count? |

Stop at the first layer where the input is correct but the output is wrong. That layer contains the bug.

State explicitly: `Bug is in <layer>. Above this point, inputs are <correct value>. Below this point, output is <wrong value>.`

## Step 5 — Fix at the right layer

Common mistake: fixing the symptom at the UI layer when the bug is in the resolver. UI workarounds compound — multiple consumers all wrap a broken thing.

Per `/dev-mode` G1, G2, G5 — the fix must:
- Live in the correct module per G1
- Match the convention of that module per G2
- Be consistent with the module's React/Redux/style pattern per G5

Write the fix. Re-run the failing test from Step 3. It must now pass.

## Step 6 — Add regression coverage

The test from Step 3 stays — that's the regression test. Add one more test for the **closely-related** case that could fail the same way:

- If the bug was "duplicate submit on slow network" — also test "submit during disconnect-then-reconnect"
- If the bug was "null product price displayed as $NaN" — also test "negative price (returns/refunds)"
- If the bug was "401 not re-authing" — also test "403 (role-restricted) error path"

This is the compound-engineering principle: each fix makes the next one easier by widening the regression net.

## Step 7 — Codify the learning

If the root cause was non-obvious — run `/compound` to save the learning for the team. The offshore developer who hits this in 6 months should find it via grep, not via re-debugging for 4 hours.

## Step 8 — Update progress + raise PR

Per `/dev-mode` G7, checkpoint the milestone. Then `/pr-create` for the PR description.

The PR description must reference:
- The exact symptom and error message (from Step 1)
- The layer where the bug was found (from Step 4)
- The regression test that proves the fix (from Step 3 + Step 6)
- The `/compound` learning ID if codified

## Anti-patterns to refuse

- **"I'll just add a try/catch."** No — Step 4 first. Catching the symptom hides the bug at the next layer.
- **"It works on my machine."** That means the repro is incomplete. Go back to Step 2.
- **"This is a flake, let me retry."** No — flakes are unbounded races. Step 4 + Step 6.
- **"The fix is obvious, no test needed."** No — Step 3 is non-negotiable for any bug in this skill's scope.

## Permissions

Allowed: Read code, write tests, write fix code, run tests, run `git diff`/`log`.
Blocked: Pushing branches, commenting on PRs, deploying.
