# /schema-drift — Detect Unintended Schema Changes

Audit a branch's diff for **unrelated** changes to GraphQL schemas, OCC mock definitions, PIM field maps, and clientlib categories — schema changes that were not the intent of the ticket. Catches accidental schema drift before it ships and breaks downstream consumers.

**Caveman intensity for this skill:** `lite`. Findings are senior-reviewer signals — keep them precise.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). Respect `stop caveman` if user issues it.

## Origin

Adapted from EveryInc `compound-engineering-plugin` `ce-schema-drift-detector` agent. The plugin itself is NOT installed per CLAUDE.md "Approved Plugins, Skills & MCP Servers". This is a project-native re-implementation focused on this stack's schemas, not generic database migrations.

## What "schema drift" means in this context

A change is "drift" if BOTH are true:

1. It modifies a schema-bearing file (list below)
2. It is NOT mentioned in the ticket description, branch name, or commit messages — i.e. it was incidental, not intended

Drift is dangerous because:
- It changes a contract without going through `/contract-review`
- Reviewers focused on the ticket's stated intent miss it
- Downstream consumers break in production weeks later

## Schema-bearing files / patterns

| Surface | Files / paths |
|---------|---------------|
| GraphQL schema | `<CIF integration repo>/cif/**/*.graphql`, `<CIF integration repo>/cif/**/schema.js`, `<CIF integration repo>/cif/**/typeDefs.js` |
| OCC mocks / stubs | `<CIF integration repo>/cif/**/__mocks__/**`, `<CIF integration repo>/cif/**/__fixtures__/**` |
| PIM field maps | `<migration repo>/*-pim/**/*.json`, `<migration repo>/*-pim/**/PimProductMapping*.java` |
| AEM clientlib categories | `<webapp repo>/ui.*/src/main/content/jcr_root/etc/clientlibs/**/.content.xml`, `**/clientlib*/js.txt`, `**/clientlib*/css.txt` |
| Coveo field mappings | DT ecommerce repo `coveo-*/src/main/webpack/**/*-mapping.{js,ts,json}`, `discover-*/src/main/webpack/**/*-mapping.{js,ts,json}` |
| TypeScript types crossing module boundaries | `<DT ecommerce repo>/*-ui.frontend/src/main/webpack/app/types/**/*.ts` |
| Hybris impexp / sample data | `<commerce-platform repo>/hybris/config/customize/**/sampledata/**/*.impex`, `<commerce-platform repo>/hybris/config/customize/**/imports/**` |

## Step 1 — Read the ticket intent

Ask the user for:
1. ADO ticket number (or paste the title and acceptance criteria)
2. Source branch name

Extract the stated intent. Example: "ADO-12345 — Add wishlist sharing to PDP" implies changes to product, wishlist, possibly cart. NOT to PIM, OCC, or Coveo.

## Step 2 — Run the diff

```bash
git -C <repo-path> fetch origin <source-branch> <target-branch>
git -C <repo-path> diff origin/<target>...origin/<source> --name-only
```

Filter the result against schema-bearing patterns above.

## Step 3 — Classify each schema-bearing change

For each schema file in the diff:

| Classification | Definition | Action |
|----------------|------------|--------|
| **INTENT** | Mentioned in ticket / branch name / commit message | OK — proceed, log it for `/contract-review` |
| **DRIFT — minor** | Schema-bearing change unrelated to intent, but cosmetic (whitespace, comments, key ordering) | Flag — ask user to confirm or revert |
| **DRIFT — material** | Schema-bearing change unrelated to intent that changes behaviour (added/removed/renamed field, changed type, changed mapping) | **STOP** — output Escalation Alert. This is unintended contract drift |

## Step 4 — Cross-check commit messages

For each material drift, run:

```bash
git -C <repo-path> log origin/<target>..origin/<source> --oneline -- <drifted-file>
```

If the commit message for that file does not mention the contract change, that confirms drift. Quote the offending commit hash + message in the report.

## Step 5 — Output report

```
=== Schema Drift Audit — <ticket-id> ===
Stated intent: <one-line summary from ticket>
Branch: <source-branch>

Intentional schema changes (proceed to /contract-review):
  <file>   <commit>   <one-line description>

DRIFT — minor (confirm or revert):
  <file>   <commit>   <one-line description>

DRIFT — MATERIAL (STOP):
  <file>   <commit>   <one-line description>
  Owner: <name from contract registry>

Recommended decision:
  <PROCEED — no drift>
  <PROCEED WITH CONFIRMATION — minor drift, user to confirm intent>
  <STOP — MATERIAL DRIFT — revert or open separate PR with /contract-review sign-off>
```

## Step 6 — On material drift, output the Escalation Alert

```
ESCALATION REQUIRED -- STOP WORK
Reason:  Material schema drift detected -- contract change not in ticket intent
Area:    <file>
Owner:   <from CLAUDE.md Contract Registry>
Action:  Stop > Either revert the drift, OR split it into a separate PR with /contract-review sign-off > Record the decision in the original PR description
```

## When to run

- ALWAYS run before `/pr-create` if the branch touches any schema-bearing path
- Run as part of `/lead-review` Step 1 (governance) when reviewing offshore PRs — drift is a common silent governance failure
- Run on demand when investigating a "weird production error" that smells like a schema change no one announced

## Governance

This skill never modifies the diff or schemas. It only reports. Reverting drift is the developer's action, manually.

## Permissions

Allowed: Read repo files, run `git diff`, `git log`.
Blocked: Reverting changes, force-pushing, amending commits. The skill output is text — the user acts on it manually.

---

## Doc-drift mode (`/schema-drift docs`)

Same skill, different surface: detect when **code changes but related documentation does not**. Adapted from RuvNet `ruflo-docs` `doc-gen` drift-detection pattern (plugin NOT installed per CLAUDE.md).

### When to use

- Before `/pr-create` if the branch touches code referenced by an ADR, design doc, README, or `arch-doc` output
- During `/lead-review` to confirm offshore developers updated docs alongside code

### Doc-bearing paths in the workspace

| Surface | Files / paths |
|---------|---------------|
| Architecture Decision Records | `**/docs/adr/**/*.md`, `**/.claude/decisions/**/*.md` |
| Module READMEs | `**/*-ui.frontend/README.md`, `**/*-core/README.md`, `**/cif/**/README.md` |
| API contract docs | `**/docs/api/**/*.md`, `**/docs/contracts/**/*.md` |
| `/arch-doc` outputs | `**/docs/architecture/**/*.md` |
| Pipeline / deploy docs | `**/docs/deploy/**/*.md`, `**/docs/runbooks/**/*.md` |
| Top-level CLAUDE.md | `CLAUDE.md` (workspace), `*/CLAUDE.md` (per-repo) |

### Doc-drift detection steps

1. **From the diff, extract code symbols that are referenced in docs.** For each changed file in the diff, search the doc-bearing paths for mentions:
   ```bash
   git -C <repo-path> diff origin/<target>...origin/<source> --name-only
   # For each renamed / removed class, function, GraphQL type, OCC endpoint, REST route:
   grep -ri "<symbol-name>" <repo>/docs/ <repo>/README.md 2>/dev/null
   ```

2. **Check if the same PR touches the docs.** For each symbol with doc mentions, check if the doc file is also in the diff:
   - Yes → covered. No drift.
   - No → DOC DRIFT — flag the doc that needs updating.

3. **Check ADR currency.** If the diff touches a path covered by an ADR (e.g. CIF resolvers, hybris-api modules), check the ADR's `last-reviewed` date in frontmatter. If older than 6 months AND the code area is being modified, flag for ADR refresh.

4. **CLAUDE.md drift.** If the diff adds a new convention, hard stop, or contract — but CLAUDE.md isn't updated — flag. This is governance-critical.

### Doc-drift report

```
=== Doc Drift Audit — <ticket-id> ===

Code changes covered by docs:
  <symbol/path>   <doc file>   <status: covered | DRIFT>

DRIFTED docs (need update):
  <doc file>   <reason>   <suggested update>

ADRs needing review (>6mo old, code in same area changed):
  <adr file>   <last reviewed>   <areas now touched>

CLAUDE.md drift:
  <yes/no>   <reason if yes>

Recommended action:
  <Update the N drifted docs in this PR>  OR
  <Open a follow-up doc-only PR within 1 sprint, ticket: __>
```

### Governance

- Doc-drift alone is NOT a hard stop. It is a quality signal.
- CLAUDE.md drift IS a governance signal — escalate to `super` role.
- Auto-generation of docs is OUT OF SCOPE for this skill (the ruflo doc-gen auto-generation pattern was rejected — generated docs that nobody owns silently rot).
