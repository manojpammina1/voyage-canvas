# /contract-review — Cross-Repo Contract Review

Audit a pending change for impact on the project's Cross-Repo Contract Registry (`config.contracts[]`). Identifies the contract owner, classifies the change as breaking vs non-breaking, and produces a sign-off checklist before the PR is raised.

**Caveman intensity for this skill:** `lite`. Contract-review output goes to the contract owner — must remain clearly readable.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). Contract findings are critical signals — keep them precise. Respect `stop caveman` if user issues it.

## Origin

Adapted from EveryInc `compound-engineering-plugin` `ce-api-contract-reviewer` agent. The plugin itself is NOT installed per the plugin-policy registry. This is a stack-native re-implementation that knows about the project's Contract Registry, not generic REST/GraphQL.

## When to use

Before raising a PR that touches any contract in `config.contracts[]` — typically:

| Contract | Files / locations |
|----------|-------------------|
| GraphQL schema | CIF integration repo's `cif/**/*.graphql`, `cif/**/schema.js` |
| OCC endpoint signature | CIF integration repo's `cif/hybris-system-token/**`, and the migration repo's `hybris-api/**`, `hybris-impl/**` modules |
| PIM product fields | Migration repo's `*-pim/**` module, consumer side in the frontend repo's `product` and `configurator` modules |
| Coveo/Discover field mappings | Frontend repo's `coveo-*` and `discover-*` modules, search-feature consumers |
| AEM clientlib categories | Webapp repo's `ui.*/src/main/content/jcr_root/etc/clientlibs/`, consumer side in the frontend repo |

Resolve the exact paths and owning repos for each contract via `?gov <contract>` or `config.contracts[]` rather than assuming the list above is exhaustive — it is illustrative of contract *types*, the config is the source of truth.

This skill is mandatory for any PR with a change in those paths. Run it BEFORE `/pr-create` and BEFORE `/lead-review`.

## Step 1 — Get the diff

Ask the user for the source branch and target branch. Then:

```bash
git -C <repo-path> fetch origin <source-branch> <target-branch>
git -C <repo-path> diff origin/<target>...origin/<source> --name-only
git -C <repo-path> diff origin/<target>...origin/<source>
```

Filter `--name-only` against the contract paths above. If no contract paths are touched, output `No contract impact — skip to /pr-create.` and stop.

## Step 2 — Classify the change

For each contract file changed, classify:

| Category | Definition | Sign-off needed |
|----------|------------|-----------------|
| **Breaking** | Removes a field/endpoint/category; changes a type (string → number, nullable → non-nullable); renames; tightens validation | YES — contract owner + lead architect |
| **Additive non-breaking** | Adds a new field/endpoint/category that consumers can ignore safely; widens a type (non-nullable → nullable); loosens validation | YES — contract owner only |
| **Cosmetic** | Comments, formatting, schema documentation only — no behavioural change | NO |

Output each touched file with its classification. Example:

```
cif/cart/cartResolver.js                                  [BREAKING]   removes cartMinimumQty field
cif/cart/__tests__/cartResolver.test.js                   [COSMETIC]   test rename
webapp-pim/src/main/java/PimProductResolver.java          [ADDITIVE]   adds optional warrantyMonths field
```

## Step 3 — Identify the contract owner

Resolve owners per contract from `config.contracts[]` (also surfaced via `?gov <contract>` / `?reviewers`) rather than restating a table here — it is generated data and must not drift from the session header's escalation contacts.

For breaking changes, both the contract owner AND the project's lead architect (per the Titan session header) are required.

## Step 4 — Identify consumer-side impact

For each contract changed, grep the consumer repos for usages:

```bash
# GraphQL: search consumer repos for the field/type name
grep -ri "cartMinimumQty" <consumer-repo-path>/ <another-consumer-repo-path>/ 2>/dev/null

# OCC: search for the endpoint path
grep -ri "/users/{userId}/carts/{cartId}/minimum" <consumer-repo-path>/ <another-consumer-repo-path>/ 2>/dev/null

# PIM: search for the field name in consumers
grep -ri "warrantyMonths" <frontend-repo>/product/ <frontend-repo>/configurator/ 2>/dev/null
```

Resolve `<consumer-repo-path>` for a given contract from `config.contracts[].consumer_repos` rather than hardcoding.

Report consumer files that reference the contract. Each is a downstream PR dependency.

## Step 5 — Output the sign-off checklist

```
=== Contract Review — <ticket-id> ===

Files touched:
  <list with classification>

Owner sign-off required (resolve via `?gov <contract>`):
  [ ] <owner name> — <contract>

Consumer impact:
  <repo>/<file>:<line>   <field/endpoint referenced>
  ...

Pre-PR actions:
  [ ] Open coordination Teams thread with <owner> — paste this output
  [ ] If breaking: confirm consumer-side PRs are queued or coordinated to land together
  [ ] Add "Contract change approval: <owner> <date>" to the PR description per /pr-create template
  [ ] If GraphQL: confirm CIF integration tests added and green
  [ ] If OCC: confirm Hybris OCC mock/stub updated
  [ ] If PIM: confirm PIM data integration test green
  [ ] If Coveo: confirm field-mapping doc in Search team Confluence updated

Recommended decision:
  <PROCEED | PROCEED WITH OWNER APPROVAL | BLOCK — escalate>
```

## Governance

- Breaking changes WITHOUT owner sign-off are a governance violation. The skill must surface this clearly with the Escalation Alert template.
- `hybris-system-token/` changes are a hard stop — output the full Escalation Alert and refuse to continue without the user confirming they have named-owner approval per `?gov hybris-system-token`.
- `options.json` committed is an immediate security incident — output Escalation Alert and stop.

## Permissions

Allowed: Read repo files, run `git diff`, `grep`.
Blocked: Writing the PR, pushing branches, sending Teams/email messages on behalf of the user. This skill produces text only — the user copies the checklist into Teams manually.
