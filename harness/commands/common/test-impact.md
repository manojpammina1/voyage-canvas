# /test-impact -- Smart Test Selection from Diff

Read-only. Predicts which tests to run based on the active diff. Cuts CI / local-loop time by skipping tests unaffected by the change.

Use this skill inside any role -- most often `/dev-mode` after a feature, `/lead-review` before PR signoff, `/qa-mode` for regression scope.

## What it does

1. Reads the active diff (`git -C <repo> diff <base>...HEAD`, or `git diff` if local-only)
2. For each changed file, maps to candidate tests via four signal layers
3. Ranks the candidate set by confidence
4. Outputs a runnable command + a "do not skip these" safety list

## Signal layers (in confidence order)

| # | Signal | Confidence | How it's detected |
|---|--------|-----------|------------------|
| 1 | **Direct sibling test** | 95% | `src/Foo.tsx` -> `src/__tests__/Foo.test.tsx` or `src/Foo.test.tsx` or `src/Foo.spec.tsx` |
| 2 | **Test imports the changed module** | 85% | `grep -rln "from '\.\./Foo'" src/**/*.test.tsx` |
| 3 | **Same-module integration test** | 60% | Any test file in the same directory tree as the changed file |
| 4 | **Cross-repo contract impact** | 40% | Changed file is on the GraphQL schema, OCC endpoint, or PIM contract path -- mark ALL downstream tests in consumer repos |

Confidence < 40 is dropped (too noisy for a "skip" decision). A test below threshold falls into "do not skip if you change behavior in this area" — flagged but not selected.

## Test framework map

Per-module test command and pattern are generated data — resolve via `?build <module>` / `data/build-map.json` (compiled from `config.repos[]` and each repo's `role_in_stack`) rather than restating a table here. Typical shapes across this stack: frontend modules run `npx jest <file>` or `npx jest --findRelatedTests <changed-files>` against `**/__tests__/**/*.test.tsx`; Java core modules run `mvn -Dtest=<Class>#<method> test` from the module dir against `src/test/java/**/*Test.java`; Lerna/CIF packages run `cd <package> && yarn test --grep "<describe>"` against `<package>/test/**/*.test.js`; Adobe I/O Runtime actions run `npx jest test/<action>.test.js` against `test/**/*.test.js`.

## Cross-repo contract paths (always re-test downstream)

Contract-bearing paths and their downstream consumers are compiled into the Contract Registry (`config.contracts[]` / `?gov <path>`). In general: GraphQL schema changes require re-testing every consumer repo's tests that touch the changed field; resolver changes require re-testing the owning repo's integration tests for that resolver; OCC/Hybris REST client changes require re-testing checkout/cart/configurator tests in consuming repos; PIM product-service changes require re-testing product/configurator tests in consuming repos; Coveo/Discover field-mapping changes require re-testing search-feature tests in the consuming repo.

When the diff touches one of these paths, the impact set automatically extends across repos -- never trust "in-repo only" for contract-bearing files.

## Output format

```
Test impact — <branch / diff range>
====================================
Changed files: 7
Repos touched: <ecommerce frontend repo>, <CIF integration repo>

Confidence 95% — direct sibling tests (RUN FIRST):
  npx jest src/components/checkout/PaymentForm.test.tsx
  npx jest src/components/checkout/hooks/usePaymentValidation.test.ts
  mvn -Dtest=PaymentResolverTest test  (in CIF integration package)

Confidence 85% — tests importing changed modules:
  npx jest src/components/cart/Cart.test.tsx        # imports PaymentForm
  npx jest src/pages/Checkout.test.tsx              # imports PaymentForm

Confidence 60% — same-module integration:
  npx jest src/components/checkout/*.test.tsx

Confidence 40% — cross-repo contract (RECOMMENDED if you changed behavior):
  cd <ecommerce frontend repo> && yarn test --testPathPattern="checkout|cart"
  Reason: payment-method.graphqls changed → downstream consumers must re-verify

Do not skip (out-of-band but at risk):
  - Storefront checkout/cart tests in other consumer repos — consume the same OCC endpoint
  - Any E2E covering guest checkout

One-shot command (all 95% + 85% candidates):
  npx jest --findRelatedTests $(git -C . diff --name-only origin/develop...HEAD | grep -E '\\.(ts|tsx|js|jsx)$')

Estimated time saved vs full suite: ~70% (12 tests instead of 41)
```

## When NOT to use this skill

- Releases / golden-copy deploys — always run the FULL suite, never a subset
- Hybris config changes — file-level hard stop per CLAUDE.md, this skill must not read those files
- Cross-cutting refactors (rename across the codebase, dependency bump) — full suite required
- Security-mode reviews — re-run security tests in full

In these cases the skill outputs a clear "full suite required, here is why" message instead of a subset.

## Permissions

Allowed: read git diff, read source + test files, output recommendations.
Blocked: running tests directly (the user runs them — this skill only recommends), writing any file, hitting any network endpoint.

## Reminders

- After output: *"Run the 95%+ candidates first. Add the 85% + 60% set if any of those fail or if you changed observable behavior."*
- Cross-repo contract path detected: *"Downstream tests are part of the impact set — do not skip them."*
- Release context: *"This is a release-class change — run the full suite, ignore this skill's subset."*

## Ownership

Ownership for the cross-repo contract registry, per-repo test framework correctness, and this skill itself is resolved via `?gov` / the Titan session header, not restated here.
