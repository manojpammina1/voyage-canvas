# /orchestrate-review — Autonomous PR-Review Orchestrator

Autonomous end-to-end review: plans which specialist reviewers to run, fans them out in parallel, self-critiques the aggregated findings, runs the CI gate, and issues a single GO/NO-GO verdict — without the human needing to pick agents or remember the CI-gate step.

**Status: opt-in / unadvertised (pilot).** Not listed in the mode picker or the `UserPromptSubmit` reminder. Invoke explicitly: `/orchestrate-review`. Closes ROI roadmap backlog item #4 (Wave 2 — quality lever).

Difference from `/parallel-review`: `/parallel-review` requires the human to already know it's review time and runs a fixed agent set. `/orchestrate-review` decides its own agent set from the diff (autonomous planning), adds a fresh-context adversarial self-critique pass before the verdict, and folds in the CI build/test gate automatically.

---

## Step 0 — Collect diff

Same as `/common/parallel-review` Step 0:

**If ADO MCP is connected:**
1. Ask for the PR number if not already known.
2. Call `list_pull_requests` to get source and target branches.
3. Fetch the PR diff metadata from ADO.

**If ADO MCP is unavailable** — use git:
```bash
git -C "<repo-path>" fetch origin "<source>" "<target>"
git -C "<repo-path>" diff origin/<target>...origin/<source>
```

If neither works, ask the user to paste the diff directly.

Store `REPO`, `SOURCE_BRANCH`, `TARGET_BRANCH`, `DIFF`, `FILES_CHANGED` (`--name-only`).

## Step 1 — Governance gate (inline — do not delegate)

Check `FILES_CHANGED` directly against the hard-stop set (identical to `/common/parallel-review` Step 1 / `harness/CLAUDE.md`): resolve owners for any matched path via `?gov <path>` / `data/reviewer-map.json`, which is compiled from `protected_paths[]` in `titan.config.json`. This includes credentials/tokens/PHI-PII in the diff, release/golden-copy pipeline files, cloud-deploy config directories, commerce-integration config files, committed secret/option files, hybris-api/impl or PIM module paths, CI/CD pipeline directories, system-token paths, GraphQL schema field changes, cross-naming moves in the migration repo, and any path flagged as an irrotatable-secret store (never read contents of those).

If a hard stop is found: output the Escalation Alert, set `Governance: BLOCK`, and **stop — do not proceed to Step 2.**

## Step 2 — Plan + fan-out (delegate)

Launch the `review-orchestrator.md` subagent, passing `REPO`, `SOURCE_BRANCH`, `TARGET_BRANCH`, `DIFF`, `FILES_CHANGED`. It builds the review plan (which of the 13 reviewer subagents to run and why), performs its own inline governance re-check, launches the selected subagents in one parallel batch, and returns the aggregated findings list.

If `review-orchestrator.md` itself reports `Governance: BLOCK` (defense in depth — should already have been caught in Step 1), stop and surface the alert.

## Step 3 — Adversarial verification (delegate)

Pass the aggregated findings + `DIFF` to `adversarial-verifier.md` — fresh context, no visibility into the other agents' reasoning. It returns confidence-adjusted findings with false positives dropped and severities corrected.

If `AGGREGATED FINDINGS` from Step 2 was empty, skip this step (nothing to verify) and proceed to Step 4.

## Step 4 — CI gate

Invoke `/common/ci-gate` on the changed modules. Do not hardcode build/test commands — `/common/ci-gate` resolves them from `harness/data/aem-build-map.json`. Capture `CI GATE PASSED` or `CI GATE BLOCKED` plus any test failure details.

If the CI gate touches a hard-stop module (`hybris-impl`, `hybris-api`, `.cloudmanager`), it will emit its own Escalation Alert — surface that as-is.

## Step 5 — Synthesize verdict

Combine Steps 1–4 into one output:

```
ORCHESTRATE-REVIEW — <repo> — <source> -> <target>

REVIEW PLAN
  Agents run: <n> (<list>)
  Agents skipped: <n>
  Plan narrowed: true|false

Governance  : N violations — [BLOCK | PROCEED]
Findings (post-adversarial-verification):
  Defects: N   Violations: N   Warnings: N   Observations: N
CI Gate     : PASSED | BLOCKED (N test failures)

FINDINGS
  [defect]     <file>:<line>  <message>
  ...

VERDICT: APPROVE | APPROVE WITH NITS | REQUEST CHANGES | ESCALATE — <team>
```

Verdict rules (same semantics as `/lead-review`):
- Governance BLOCK → verdict is always `ESCALATE — <team>`, no other categories shown.
- CI Gate BLOCKED → verdict is at most `REQUEST CHANGES` (failing build/tests cannot APPROVE).
- Defects or violations present → `REQUEST CHANGES`.
- Only warnings/observations → `APPROVE WITH NITS`.
- Nothing found and CI gate passed → `APPROVE`.

## Step 6 — Emit telemetry

Emit one metadata-only `_orchestrate_review` event (see `harness/hooks/telemetry-capture.py` for the envelope) with:
```
meta = {
  reviewers_spawned: <n>,
  models_used: ["sonnet","haiku",...],
  findings_count: <n before verification>,
  findings_after_verify: <n after verification>,
  governance: "BLOCK" | "PROCEED",
  ci_gate: "PASS" | "BLOCK" | "SKIP",
  plan_narrowed: true|false
}
```
No diff text, file contents, or finding messages in telemetry — counts and labels only, per the existing privacy contract.

## Cost guardrails

- The small-diff escape hatch lives in `review-orchestrator.md` Step 1 (narrows to 2 agents under 3 changed files with no HIGH/CRITICAL paths).
- Expect roughly the same total cost as `/parallel-review` plus one Haiku-tier adversarial pass plus `/ci-gate`'s build/test runtime — the adversarial step is the only new LLM cost on top of the existing fan-out.
- If cost band for the active role is `arch-mode` (soft cap $20, `skip_warn: true` per `pricing.json`), no extra warning is shown; other roles inherit the standard `cost-estimate.py` advisory.

## Output rules

- Governance block overrides everything — show only the Escalation Alert and stop.
- Do not show PASS/empty categories in the final output.
- Every finding must include `file:line` so it is clickable in the IDE.
- This skill produces the same verdict vocabulary as `/lead-review` / `/common/parallel-review` so downstream tooling (dashboards, PR templates) doesn't need a second parser.
