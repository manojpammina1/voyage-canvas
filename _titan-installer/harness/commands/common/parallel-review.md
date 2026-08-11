# /parallel-review — Multi-Agent PR Review

Run all reviewer agents in parallel on a PR diff, then synthesise findings into a single lead-review verdict.

Invoke explicitly: `/parallel-review` (prompts for PR details), or called automatically from within `/lead-review` after Step 1 governance passes.

---

## Step 0 — Collect diff

Determine the diff source:

**If ADO MCP is connected** (tools with `azure-devops` prefix are present):
1. Ask for the PR number if not already known.
2. Call `list_pull_requests` to get source and target branches.
3. Fetch the PR diff metadata from ADO.

**If ADO MCP is unavailable** — use git:
```bash
git -C "<repo-path>" fetch origin "<source>" "<target>"
git -C "<repo-path>" diff origin/<target>...origin/<source>
```

If neither works, ask the user to paste the diff directly.

Store:
- `REPO` — which repo in `config.repos[]` this PR belongs to
- `SOURCE_BRANCH`, `TARGET_BRANCH`
- `DIFF` — the full unified diff text
- `FILES_CHANGED` — list of changed file paths (`--name-only`)

---

## Step 1 — Governance gate (inline — do not delegate)

Before spawning any parallel agents, check the diff directly for hard-stop violations:

**Stop immediately and output the Escalation Alert from CLAUDE.md if any of these are found:**

Check `FILES_CHANGED` and the diff body against `protected_paths[]` (resolve via `?gov <path>` / `data/reviewer-map.json`). This covers: credentials/tokens/API keys/PHI-PII in the diff, release/golden-copy pipeline files, cloud-deploy config directories, commerce-integration config files, committed secret/option files, hybris-api/impl or PIM module paths, CI/CD pipeline directories, system-token paths, GraphQL schema field changes, and cross-naming moves in the migration repo. Each match resolves to a named owner — surface it in the Escalation Alert.

If a hard stop is found: output the Escalation Alert, set `Governance: BLOCK`, and do not proceed to Step 2.

---

## Step 2 — Parallel agent launch

If governance passes, launch all reviewer agents simultaneously using the Agent tool. Pass `REPO`, `SOURCE_BRANCH`, `TARGET_BRANCH`, and `DIFF` to each.

Agents to run in parallel:

| Agent subagent file | Focus | Model | Always run? |
|--------------------|-------|-------|-------------|
| `correctness-reviewer.md` | Logic bugs, nulls, race conditions, state errors | sonnet | Yes |
| `reliability-reviewer.md` | Commerce-API error handling, session expiry, duplicate submit | sonnet | Yes |
| `maintainability-reviewer.md` | Module boundaries, styling, dead code, naming | haiku | Yes |
| `code-reviewer.md` | Convention check (Steps 2 of lead-review) | sonnet | Yes |
| `cif-contract-checker.md` | GraphQL / commerce-API contract validation | sonnet | Only if `FILES_CHANGED` includes `.graphql`, a hybris/commerce-API path, `app.config.yaml`, or integration-layer files |
| `test-validator.md` | Test existence and execution | haiku | Only if `FILES_CHANGED` includes new `.java`, `.tsx`, or `.jsx` files |
| `component-usage-reviewer.md` | Shared component compliance — flags raw HTML elements where a discovered shared component exists | haiku | Only if `FILES_CHANGED` includes `.tsx` or `.jsx` files |
| `react-races-reviewer.md` | Frontend race conditions, stale-closure bugs, fetch-after-unmount, double-dispatch sagas | sonnet | Only if `FILES_CHANGED` includes `.tsx`, `.jsx`, `.ts`, or `.js` files in React/Redux paths (per `config.stack.frontend`) |
| `strict-typescript-reviewer.md` | Strict TS correctness: discriminated unions, narrowing, no `any`, exhaustive switch, `unknown` over `any` for boundaries | sonnet | Only if `FILES_CHANGED` includes `.ts` or `.tsx` files |

**Model rationale:** Sonnet for agents that reason about logic or governance; Haiku for agents that pattern-match naming/structure — this cuts token cost on the cheapest agents by ~10x.

**Origin of the two race/TS reviewers:** Adapted from a third-party reviewer-agent pattern set. That plugin itself is NOT installed per CLAUDE.md "Approved Plugins, Skills & MCP Servers" — the patterns were ported as native agents for this harness.

Do not run agents sequentially. All applicable agents must be launched in a single parallel batch. Pass `model: "<model>"` on each Agent tool call per the table above.

---

## Step 3 — Missing scenarios check (inline)

After parallel agents return, run the missing-scenarios check directly (do not delegate):

**Cart:** order min/max enforced in UI; session expiry mid-checkout; backordered/restricted products; duplicate submit disabled; currency/locale in all OCC calls.

**My Account:** locked/suspended account; existing email on registration; invoice 404; address book (add/edit/delete/default); password change validates current password first.

**Product:** PIM 404 shows not-found UI, not broken page; role-restricted product enforced (not just hidden); bundle per-item availability shown.

**Search:** zero results with facets shows helpful empty state; field mappings match Coveo/Discover index schema.

**Hybris OCC:** all HTTP errors mapped to user messages; 401 triggers re-auth; non-ISO dates handled; null/missing fields guarded.

**React/Redux:** loading and error state present; state reset on logout; race conditions guarded; `aria-*` and keyboard nav on interactive elements.

**AEM/HTL:** null JCR properties don't cause NPE; component works in Author and Publish; dialog validation present.

---

## Step 4 — Architecture check (inline)

After all agent results are in, check:
- Module boundary violated (frontend logic in `-ui.apps`; Hybris call bypassing CIF layer)?
- Logic duplicated that already exists in another module or repo?
- Change makes a future migration step harder (naming drift, contract divergence)?

---

## Step 5 — Synthesise and output

Combine all agent reports and inline checks into the standard lead-review verdict format:

```
PR Summary: [1 sentence describing what the PR does]

Governance  : N violations — [BLOCK | PROCEED]
Conventions : N failures
Correctness : N defects, N warnings
Reliability : N defects, N warnings
Maintainability : N violations, N observations
Missing scenarios : N
Architecture : N concerns
CIF contract : N breaking changes (if checked)
Tests : [PASS | N gaps] (if checked)
```

List all findings grouped by category. Use the exact file:line format so findings are clickable in the IDE.

End with verdict:
- `APPROVE` — no findings
- `APPROVE WITH NITS` — observations only, no defects or violations
- `REQUEST CHANGES` — defects, violations, or missing scenarios found
- `ESCALATE — [team]` — governance block or contract breach

---

## Output rules

- Governance block overrides all other findings. If governance is BLOCK, show only the escalation and stop.
- Do not repeat the same finding from multiple agents. If correctness and reliability both flag the same line, merge into one finding under the higher-severity category.
- Do not show PASS categories in the final output — only show categories that have findings.
- Each finding must include file path and line number (or line range) when available.
