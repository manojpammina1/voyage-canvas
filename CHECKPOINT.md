# Voyage Canvas — Checkpoints

Work in `/Users/manojpammina/Desktop/Interview-Prep/RCG/voyage-canvas`. Titan installer sources preserved under `_titan-installer/`.

### Next (interview)

**Demo freeze (T21)** — use `README.md` 5-minute script. Playwright E2E (T20) **skipped** for interview scope.

---

## Interview demo — READY (T21)

Use **`README.md`** for the full talk track. Summary:

1. `docker compose up -d && pnpm seed && pnpm dev`
2. Browser walkthrough: intent → orbit → lock/budget → compare → policy → sign-in → hold → checkout → fallback
3. Optional pre-flight: `pnpm demo:reset`, `pnpm typecheck`, `pnpm eval:retrieval`

---

## Checkpoint 3 — COMPLETE (T16–T19 / Gate C)

### One-time setup (terminal)

```bash
cd /Users/manojpammina/Desktop/Interview-Prep/RCG/voyage-canvas
pnpm install --no-frozen-lockfile
docker compose up -d          # Mongo + Redis (required for hold/sign-in)
pnpm seed                     # sailings + inventory + policy chunks
pnpm --filter @voyage/web dev
```

Open **http://localhost:3000** in your browser.

### What to click (happy path)

| Step | What you do | What you should see |
|------|-------------|---------------------|
| 1 | Click **Explore voyages** (hero prompt is pre-filled) | 3 voyages on the orbit ($4280 / $4620 / $4740) |
| 2 | Click a voyage node to select it | Selection card updates; **Commitment** panel appears in left pane |
| 3 | Click **Simulate sign in** | Message: signed in; session rotated |
| 4 | Check the hold confirmation box → **Create short-lived hold** | Hold success message with expiry time |
| 5 | Click **Continue to secure checkout** | Redirect to `/existing-checkout` — green “Handoff OK” |
| 6 | Go back, click **Ask policy (demo)** in bottom bar | Short policy answer snippet appears (children travel docs) |
| 7 | Click **Simulate AI outage** | **Guided voyage planner** screen; click **Search again** — same deterministic search works |

### Optional automated checks (terminal)

```bash
pnpm typecheck
pnpm --filter @voyage/content-adapter test
pnpm --filter @voyage/orchestrator test
pnpm eval:retrieval          # policy search quality
pnpm eval                    # golden behavior cases
pnpm redteam                 # injection / PII / auth cases
pnpm latest-trace            # writes .voyage/traces/latest.json
curl -s http://localhost:3000/api/health | jq   # mongo+redis OK
```

### Key files (checkpoint 3)

| Path | Why |
|---|---|
| `apps/web/app/api/auth/mock/route.ts` | Simulated sign-in + session rotation |
| `apps/web/app/api/hold/route.ts` | Atomic hold (auth required) |
| `apps/web/app/api/booking/start/route.ts` | Signed checkout handoff |
| `apps/web/app/existing-checkout/page.tsx` | Checkout boundary page |
| `apps/web/components/CommitmentPanel.tsx` | Sign-in / hold / checkout UI |
| `apps/web/components/GuidedVoyagePlanner.tsx` | AI outage fallback |
| `apps/web/app/api/experience/route.ts` | SSE policy + search stream |


### Next checkpoint

Interview demo — see **`README.md`**. UI gloss vs `UI-sample/` is post-interview.

---

## Checkpoint 2c — COMPLETE (T10–T15)

Policy RAG, tool registry, mock orchestrator, grounding. See `data/policies/`, `@voyage/content-adapter`, `@voyage/orchestrator`.

---

## Checkpoint 2b — COMPLETE (T8–T9 / Gate B UI)

Orbital canvas UI wired to deterministic planning (no LLM):

1. **IntentPortal** — NL hero prompt → `/api/plan`
2. **TravelerCore** + **ConstraintPane** — locks + budget scrub (left pane)
3. **JourneyOrbit** — value-curve arc, voyage nodes, selection card, Caribbean route map
4. **AccessibleVoyageList** — equivalent list view (Orbit/List toggle)
5. **EvidenceDrawer**, **ComparisonLens**, **BottomIntentBar**

### Try it

```bash
cd /Users/manojpammina/Desktop/Interview-Prep/RCG/voyage-canvas
pnpm install --no-frozen-lockfile   # if lockfile stale
pnpm --filter @voyage/web dev
```

1. Submit hero prompt (pre-filled)
2. See 3 voyages on the orbit arc ($4280 / $4620 / $4740)
3. Lock balcony, scrub budget — options reorder without AI
4. Toggle List view — same state
5. Compare two options — deterministic delta panel

### Key files

| Path | Why |
|---|---|
| `apps/web/components/VoyageCanvas.tsx` | Workspace shell |
| `apps/web/components/JourneyOrbit.tsx` | Orbital UI |
| `apps/web/lib/planService.ts` | Server-side deterministic plan |
| `apps/web/app/api/plan/route.ts` | Planning API |
| `apps/web/styles/orbit.css` | Orbit layout/styles |

### Next checkpoint (say "continue checkpoint 2c")

**2c — T10–T15:** Policy corpus, retrieval, tools, mock gateway, orchestrator.

## Checkpoint 1 — COMPLETE (Batch 0 + T0–T3 / Gate A)

What landed:

1. **Batch 0** — sibling repo, handoff docs at root, Titan harness under `.claude/`
2. **T0** — pnpm workspace: `apps/web`, `packages/{shared,commerce,inventory,content-adapter,orchestrator}`
3. **T1** — Adaptive Serenity tokens/primitives in `apps/web/styles/*` + `components/primitives.tsx`
4. **T2** — Domain contracts + Zod schemas + authority reducer tests in `packages/shared`
5. **T3** — Eval seed schema validation (`pnpm eval:validate`)

### Files to read first

| Path | Why |
|---|---|
| `packages/shared/src/domain.ts` | Core types + GuestAuthCtx / cabinId |
| `packages/shared/src/reducer.ts` | Authority boundary (model cannot write commerce/auth) |
| `packages/shared/src/schemas.ts` | Zod contracts + eval case schemas |
| `packages/shared/tests/authority.test.ts` | Gate A proof |
| `apps/web/styles/tokens.css` | Design tokens |
| `apps/web/app/page.tsx` | Scaffold landing (NL intent copy) |
| `docs/references/ui/` | Visual composition truth |

### Verify

```bash
cd /Users/manojpammina/Desktop/Interview-Prep/RCG/voyage-canvas
pnpm install
pnpm typecheck
pnpm --filter @voyage/shared test
pnpm eval:validate
pnpm --filter @voyage/web dev   # optional UI peek
```

## Checkpoint 2a — COMPLETE (T4–T7)

What landed:

1. **T4** — `docker-compose.yml` (Mongo replica set + Redis), March 2027 hero fixtures in `data/`, `pnpm seed` / `pnpm demo:reset`
2. **T5** — `@voyage/commerce` catalog/search/pricing/comparison (deterministic; hero balcony 2+2 → $4280 / $4620 / $4740)
3. **T6** — `@voyage/inventory` availability, atomic/idempotent holds, CAS reconciliation, signed `BookingContext`
4. **T7** — `@voyage/orchestrator` criteria parser + Redis/memory anonymous session store

### Files to read first

| Path | Why |
|---|---|
| `data/sailings.json` / `ports.json` / `pricing.json` | Hero March 2027 fixtures |
| `packages/commerce/src/pricing.ts` | Deterministic quote math |
| `packages/inventory/src/holds.ts` | Atomic hold + idempotency |
| `packages/inventory/src/reconciliation.ts` | CAS held→expired restore-once |
| `packages/orchestrator/src/criteriaParser.ts` | Hero NL → SearchCriteria |
| `packages/orchestrator/src/session.ts` | Safe Redis planning session |
| `scripts/seed.ts` | Demo seed/reset |

### Verify

```bash
cd /Users/manojpammina/Desktop/Interview-Prep/RCG/voyage-canvas
pnpm install
pnpm --filter @voyage/shared test
pnpm --filter @voyage/commerce test
pnpm --filter @voyage/orchestrator test
pnpm --filter @voyage/inventory test
pnpm typecheck
# if docker available:
docker compose up -d
pnpm seed
pnpm demo:reset
```

### Notes

- Inventory unit tests use `mongodb-memory-server` replica set (transactions). Concurrent 20-way last-cabin stress is documented for docker Mongo; sequential last-cabin contention is covered in-unit.
- No payment, no LLM calls in these packages.

### Next checkpoint (say "continue checkpoint 2c")

**2c — T10–T15:** Policy corpus, retrieval, tools, mock gateway, orchestrator.
