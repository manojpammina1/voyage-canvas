# /common/ci-gate -- CI Gate (pre-PR build + test verification)

Run this **before `/dev/pr-create`**. Confirms the PR will pass CI by running build + tests locally. Blocks PR assembly if failures exist.

## When to invoke

- Mandatory step in the dev-mode pre-PR checklist (added in v2.1)
- Any time a developer says "I'm ready to raise a PR"
- After a significant fix that touched multiple files

## Step 1 — Detect repo + module type

Identify the module being submitted:

| Module path contains | Type | Build command |
|---------------------|------|---------------|
| `-core/` (Java OSGi) | Java | `mvn clean install -DskipTests` then `mvn test` |
| `-ui.frontend/` (React/Webpack) | React | `npm run test -- --watchAll=false` |
| `-ui.apps/`, `-ui.config/` | Content package — no unit tests | Skip test step; run `mvn clean install` |
| CIF Layer Lerna package | Node | `npm run test` or `yarn test` |
| Adobe I/O Runtime action | Jest | `npm test` in action root |

If the module type is ambiguous, ask the developer before running.

## Step 2 — Run build (fail fast)

**Java:**
```bash
mvn clean install -DskipTests -pl <module-path> -am
```

**React:**
```bash
cd <module-path> && npm install --no-audit && npm run build
```

If the build fails:
- List the exact error with file path and line number from compiler/bundler output
- Do NOT proceed to test step
- Output: `CI GATE BLOCKED — build failed. Fix build errors before raising PR.`

## Step 3 — Run tests

**Java:**
```bash
mvn test -pl <module-path>
```

**React:**
```bash
npm run test -- --watchAll=false --ci --passWithNoTests
```

**CIF / Adobe I/O:**
```bash
npm test
```

## Step 4 — Report failures

If tests fail, output for each failure:

```
TEST FAIL -- <TestClass>.<testMethod> (or describe > it block)
File: <path/to/test/file>:LINE
Reason: <failure message from output>
Fix hint: <one-line suggestion>
```

Then output: `CI GATE BLOCKED — N test(s) failing. Resolve before /pr-create.`

If any failure is in a hard-stop module (`hybris-impl`, `hybris-api`, `.cloudmanager`), output the Escalation Alert.

## Step 5 — Clean output

If build and tests pass:

```
CI GATE PASSED
  Build: clean
  Tests: N passed, 0 failed, N skipped
  Coverage hint: run `mvn jacoco:report` or `npm run test:coverage` for coverage breakdown
  Ready for: /dev/pr-create
```

## Integration with dev-mode pre-PR checklist

The dev-mode pre-PR checklist (below) now requires ci-gate before pr-create:

```
Pre-PR checklist (dev-mode):
  0. [ ] /common/ci-gate — build + tests pass
  1. [ ] /common/check-conventions — no naming violations
  2. [ ] /common/missing-scenarios — no gaps surfaced
  3. [ ] /dev/pr-create — PR description assembled
```

Do not assemble the PR description until step 0 is checked.

## Escalation

If tests fail in a hard-stop module: output Escalation Alert per CLAUDE.md and stop.
If tests fail due to a Hybris contract change (OCC endpoint signature, GraphQL schema): flag for sign-off from the owner for this area (see the Titan session header; `?gov <path>` for a specific file) before merge.
