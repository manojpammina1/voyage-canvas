# /lead-review -- Tech Lead / Governance Review Mode

Activate. **Read-only** -- no commits, pushes, branches, or file writes to any repo this session.

**Caveman intensity for this role:** `full`. Review output is already structured (bulleted findings, GOVERNANCE/CONVENTION FAIL/MISSING SCENARIO lines) — full compression is safe. Escalation Alerts and governance violations stay uncompressed (Caveman auto-disables for security-critical output).

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`). Default intensity `full` is correct for this role — no level change needed. Caveman auto-disables for Escalation Alerts and governance findings (intended behaviour). Respect `stop caveman` or `normal mode` if user issues them — remain in lead-review with caveman off.

## Step 0 -- Pull PR context from ADO (if Azure DevOps MCP available)

If the Azure DevOps MCP server is connected (tools with `azure-devops` prefix are present):

1. Ask the user for the PR number or source branch name.
2. Identify the ADO project from the repo being reviewed: `config.repos[].id` is the ADO project name — resolve via `?gov repos` or the Titan session header.
3. Fetch the PR from ADO. Read:
   - Title and description (use as starting context for Step 1-4)
   - Linked work items (cross-reference with Jira ticket if Jira MCP is also available)
   - Reviewer assignments and vote status
   - Build policy results (pass/fail)
   - File change list (compare against diff from git)
4. If ADO MCP is unavailable, fall through to manual git diff approach below.

## Accessing Azure DevOps PRs

Workspace root has no git. Use `git -C <repo-path>`.

Local path for each ADO repo is `<workspace>/<config.repos[].dir>` — resolve via `?gov repos`.

ADO does not expose `refs/pull/*/merge`. Get branch names from top of PR page (`source -> target`):

```bash
git -C "$LOCAL" fetch origin "$SOURCE" "$TARGET"
git -C "$LOCAL" diff origin/$TARGET...origin/$SOURCE --name-only
git -C "$LOCAL" diff origin/$TARGET...origin/$SOURCE -U3
git -C "$LOCAL" log origin/$TARGET..origin/$SOURCE --oneline
```

If fetch fails: ask user to run locally and paste output.

## Exact line numbers in findings (MANDATORY)

Every finding MUST cite `file:line` with a real line number — never a placeholder.

**How to extract line numbers from the diff:**

Diff hunk headers have the form `@@ -OLD_START,OLD_COUNT +NEW_START,NEW_COUNT @@`.
The `+NEW_START` value is the first **new** line number in that hunk.
Count lines from there to pinpoint the exact offending line.

Example hunk:
```
@@ -45,6 +47,9 @@ export function CartItem({ item }) {
+  if (!item.price) {          ← line 47
+    return null;              ← line 48
+  }                           ← line 49
```
→ cite as `CartItem.tsx:47`

**If the file is local**, use the Read tool with `offset` + `limit` to confirm the exact line before citing it:
```
Read file: src/components/CartItem.tsx, offset: 45, limit: 15
```

**Format all findings as:**
```
CONVENTION FAIL -- src/components/CartItem.tsx:47 -- [what is wrong] -- [fix]
MISSING SCENARIO -- src/services/checkout.ts:112 -- [scenario] -- [fix]
GOVERNANCE VIOLATION -- <commerce-impl-module>/src/Foo.java:8 -- [what] -- [team, resolve via `?gov`]
```

Never write `file:line` as a literal — always substitute the real path and number.

## Deep review option

For a full parallel multi-agent review (correctness + reliability + maintainability + conventions + CIF contract + tests all running simultaneously), invoke `/parallel-review` after collecting the diff. Use it when:
- The PR is large (>5 files) or touches business-critical flows (cart, checkout, my account, registration)
- You want correctness and reliability analysis beyond governance + conventions
- Reviewing offshore work and want a systematic missing-scenarios pass

For small / trivial PRs the manual Steps 1–4 below are faster.

## Guardrails

- Governance before logic -- violation stops the review
- Offshore context gap: what business knowledge might be missing?
- No silent approval: every Missing/Risky finding needs ticket or decision before merge

## Review sequence

### Step 1 -- Governance violations (stop PR if found)

Scan for anything matching `protected_paths[]` (resolve owners with `?gov`):
- Credentials, tokens, API keys, PHI/PII anywhere
- Pipeline files: release/deploy pipeline YAML, `ci/`, `pipeline/`, `cd-deploy/`, `azure-pipeline.yml`, `azure-Pipelines/`
- `.cloudmanager/` modified; cross-repo contract config (e.g. `app.config.yaml`) changed; committed options/credential files
- Commerce-platform API/impl modules, integration-layer system-token directories touched without escalation record
- GraphQL field added/removed/renamed; cross-naming move in a migration-role repo without sign-off

Output Escalation Alert from CLAUDE.md. Report: **GOVERNANCE VIOLATION -- [path/to/file.ext:LINE | what | team]** (LINE = exact line number from diff hunk header or Read tool)

### Step 2 -- Conventions

Per-repo conventions (module naming, stylesheet choice, Redux pattern) are defined in `config.repos[].module_naming` / `config.stack.frontend` -- resolve with `?gov` for the specific repo under review rather than assuming a fixed table. General patterns to check regardless of repo:

- Java/-core, React/-ui.frontend, OSGi config/-ui.config, HTL/-ui.apps placement
- PascalCase components, camelCase sagas, kebab HTL
- HOC vs hooks: match file, no mixing
- LESS vs SCSS: match the module's configured stylesheet, never mix
- Redux: sagas/slices/thunks -- match file, never mix
- No `.cloudmanager/` or pipeline changes in a non-pipeline-owning repo
- Migration-role repos: one naming prefix only, never cross
- CIF/integration-layer repo: schema unchanged unless sign-off recorded; no system-token or cross-repo contract config committed; lint passes

Report: **CONVENTION FAIL -- [path/to/file.ext:LINE | what | fix]** (LINE = exact line number from diff hunk header or Read tool)

### Step 3 -- Missing scenarios

**Cart:** order min/max (Hybris server-side; UI must enforce too); session expiry mid-checkout; backordered/restricted products; duplicate submit (loading + disable); currency/locale.

**My Account:** locked/suspended; existing email on registration; invoice 404; address book (add/edit/delete/default); password change validates current first.

**Product:** PIM 404 (not-found UI, not broken); role-restricted (enforce, not just hide); bundle (per-item availability).

**Search:** zero results + facets (helpful empty state); field mappings match index schema.

**Hybris OCC:** errors -> user messages; 401 -> re-auth; non-ISO dates; null/missing fields.

**React/Redux:** loading + error state; state reset on logout; race conditions; `aria-*` + keyboard nav.

**AEM/HTL:** null JCR -> no NPE; Author + Publish; dialog validation.

Report: **MISSING SCENARIO -- [scenario | why it matters for this platform | path/to/file.ext:LINE | fix]** (LINE = exact line number of the code that should handle this scenario)

### Step 4 -- Architecture

- Boundary violated (frontend in -ui.apps?); Hybris/OCC dependency should go through the CIF layer?
- Logic duplicated elsewhere; migration step made harder?

Report: **ARCH CONCERN -- [what | why | recommendation]**

## Output

```
PR Summary: [1 sentence]
Governance: N -- [STOP/PROCEED WITH FIXES] | Convention FAILs: N | Missing: N | Arch: N
```

List findings. End: `APPROVE` / `APPROVE WITH NITS` / `REQUEST CHANGES` / `ESCALATE -- [team]`

## PR templates

**Missing:** "Doesn't handle [scenario]. On this platform, [reason]. Add handling for [case]. See [reference]."

**Convention:** "[What] belongs in [location]. Breaking [boundary] causes [consequence]. Move to [path]."

**Governance:** "Requires sign-off from the area owner (resolve via `?gov`). Raise request and add approval ref to PR description."
