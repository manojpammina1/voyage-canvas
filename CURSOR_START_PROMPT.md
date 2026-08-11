# Cursor Plan-Mode Start Prompt

You are implementing the Voyage Canvas project.

READ FIRST - do not modify files yet:

- `@AGENTS.md`
- `@IMPLEMENTATION_PLAN.md`
- `@ARCHITECTURE.md`
- `@DOMAIN_CONTRACTS.md`
- `@DESIGN.md`
- `@EVAL_SPEC.md`

Then inspect the repository.

The scope is locked.

Do not redesign the product or architecture.
Do not add features outside `IMPLEMENTATION_PLAN.md`.
Do not weaken authority boundaries in `ARCHITECTURE.md`.
Do not modify Titan governance.
Do not implement code yet.

First:

1. Reconcile the repository's current state against T0-T21.
2. Mark every task `complete`, `partial`, or `not started` with evidence.
3. Verify `DOMAIN_CONTRACTS.md` is sufficient for frontend, backend, AI, retrieval, auth/hold, and evaluation work.
4. Identify blockers or contradictions only; do not invent extra requirements.
5. Produce an execution plan in the exact dependency order defined by `IMPLEMENTATION_PLAN.md`.
6. Identify files/directories expected to be created or changed per task.
7. Identify which tasks can run in parallel only after the T2 contract lock.

If an architecture change appears necessary, stop and raise it instead of changing the architecture.

Return only:

- repository findings
- T0-T21 status table
- blockers/contradictions
- proposed execution batches
- expected files per batch
- verification commands per batch

DO NOT WRITE IMPLEMENTATION CODE YET.

After the plan is reviewed and approved, wait for an explicit command such as:

`Plan approved. Execute T0-T3 only. Run applicable gates, report files/tests/deviations, then STOP before T4.`
