# /qa/test-tier -- Test Tier Selection

Determine the correct test tier for a given change so QA runs the right scope — not everything every time.

## Input

Provide one or both:
- The diff (file list or `git diff --name-only` output)
- The release context (hotfix / feature PR / release branch cut / nightly)

## Tier definitions

| Tier | Trigger | What to run | Max time | CI command |
|------|---------|-------------|----------|------------|
| **Smoke** | P0 hotfix, emergency deploy | Happy path only: cart add, checkout, login, search | 10 min | `mvn test -Dgroups=smoke` / `npm run test:smoke` |
| **Regression** | Feature PR merged to release branch | All P0 + P1 scenarios for every module touched by the diff | 45 min | `mvn test -Dgroups=regression` / `npm run test:regression` |
| **Full** | Release branch cut (`release/R*` or `release/H*`) | All P0/P1/P2 + cross-repo contract tests | 90 min | `mvn verify -Pit-tests` / `npm run test:full` |
| **Nightly** | Scheduled CI (midnight) | Full + performance baseline comparison | 3 hours | Configured in `azure-Pipelines/nightly.yml` |

## Step 1 — Detect tier from context

Apply the FIRST matching rule:

1. **Smoke** — diff touches only 1–2 files; branch name contains `hotfix/` or `fix/`; or deploying to prod outside a release window.
2. **Regression** — diff is a normal feature PR (branch: `feature/`, `bugfix/`, `TICKET-*`); merging to `release/` branch; or PR contains >3 files changed.
3. **Full** — creating or cutting a new `release/R*` or `release/H*` branch; pre-production smoke-out before a scheduled go-live.
4. **Nightly** — triggered by scheduler; not manually invoked.

## Step 2 — Output

```
Tier: REGRESSION
Trigger: feature PR (>3 files changed)
Modules touched: <cart-ui-module>, <cart-core-module>  (naming per `config.repos[].module_naming`)
Test suites to run:
  - CartComponentTest.java (JUnit 5) — all methods
  - CartReducer.test.ts (Jest) — all
  - CheckoutFlow.test.ts (Jest) — P0 scenarios
Estimated time: ~20 min
CI command: mvn test -pl <cart-core-module> && cd <cart-ui-module> && npm run test -- --watchAll=false
Skip: prodsupport, search, admin modules (not in diff)
```

## Step 3 — Flag risks

If the diff touches:
- `graphql/schema/` or any `.graphql` file → flag: "Contract test required — run `/common/cif-check` before this tier"
- OCC endpoint path changes → flag: "OCC regression must include order min/max and session expiry scenarios"
- Coveo/Discover field names → flag: "Search regression must include zero-results + facets scenario"
- `hybris-api/` or `hybris-impl/` → output Escalation Alert per CLAUDE.md Hard Stops

## Cross-reference

- `/common/missing-scenarios` — surfaces business gaps before running regression
- `/common/test-impact` — narrows which tests to run from a diff (faster feedback)
- `/qa/fixture-reset` — teardown patterns to keep tests isolated
