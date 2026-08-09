# /sre/deploy-sequence -- Cross-Repo Deploy Order + Contract Checks

Mandatory pre-deploy step for any multi-repo release. Derives the deploy order, the per-repo contract checks, and the escalation targets from `titan.config.json` — nothing here is a hardcoded repo list. If the config only has one repo, or none of the stack flags below apply, this skill degrades gracefully (see "Single-repo / no-contracts case").

## Step 1 — Resolve deploy order from config

Read `config.repos[]` and `config.contracts[]`:

- Deploy order = a topological sort of `repos[]` by `contracts[].owner_repo` → `contracts[].consumer_repos[]` (an owner repo deploys before anything that consumes its contract). If two repos have no contract edge between them, preserve their relative order in `config.repos[]`.
- If `config.contracts[]` is empty, there is no derivable order — state that plainly and ask the user for the sequence, or fall back to `config.repos[]` array order with a note that it is unverified.

**Never deploy step N before step N-1 is confirmed healthy.** Each step is a producer for the next; deploying out of order breaks downstream consumers.

## Step 2 — Per-repo contract check (repeat for each repo in the resolved order)

For the repo currently being deployed:

1. Find every `contracts[]` entry where `owner_repo` == this repo's `id`.
2. For each, diff the changed paths against the contract's known surface (GraphQL schema files if `config.stack.cif.graphql`, OCC/REST endpoint definitions if `config.stack.commerce.occ`, PIM interface files if a `pim` contract exists):
   ```bash
   git -C "<repo.dir>" diff origin/<repo.branches.base>...HEAD -- <contract-surface-glob>
   ```
3. Classify the diff:
   - Field/endpoint **added**: confirm all `consumer_repos[]` are expecting it — sign-off from `contracts[].owners` before proceeding.
   - Field/endpoint **removed or renamed**: HARD STOP — output the Escalation Alert to `contracts[].owners` (resolve names via `?gov <contract-name>` or the session header, never hardcode).
   - Any path matching a `config.protected_paths[]` entry with `enforcement.hard_stop: true`: HARD STOP → owners from that entry.
4. Look up the repo's deploy command from `config.repos[].kind`:
   - `aem-maven` → `mvn -PautoInstallSinglePackagePublish clean install -f <repo.dir>/pom.xml`
   - `node-lerna` (with `config.stack.cif.enabled`) → `aio app deploy --workspace <stage|prod>` (confirm env with the contract owner before running)
   - `hybris` → follow the repo's own documented deploy path; if none is configured, ask rather than guess
   - `generic` → ask the user for the build/deploy command; do not assume Maven or npm

**Confirm healthy** before moving to the next repo: package-manager/bundle status if `config.stack.aem.enabled`, GraphQL playground / health endpoint 200 if `config.stack.cif.enabled`, or the repo's own documented health check otherwise.

## Rollback order

If a step fails, roll back in **reverse** of the resolved deploy order (last-deployed repo first).

See `harness/runbooks/deploy-failed.md` for rollback commands and communication template, if that runbook exists for this deployment.

## Single-repo / no-contracts case

If `config.repos[]` has one entry, or `config.contracts[]` is empty: skip the ordering step entirely, run the single repo's contract check (if any) and deploy command, and say so explicitly in the summary output rather than fabricating a multi-step sequence.

## Summary output format

```
DEPLOY SEQUENCE APPROVED
  Step 1 — <repo.id>:  Contract check PASSED | Deploy: <resolved command>
  Step 2 — <repo.id>:  Contract check PASSED | Deploy: <resolved command>
  ...
  Rollback runbook:    harness/runbooks/deploy-failed.md (if present)
```

If any step has a HARD STOP finding: output the Escalation Alert and halt. Do not proceed to the next step.
