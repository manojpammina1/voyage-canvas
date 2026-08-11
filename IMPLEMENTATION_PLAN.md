# Voyage Canvas - Final Implementation Plan

Status: **SCOPE LOCKED / IMPLEMENTATION READY**
Audience: Cursor Agent and implementation agents

This document is authoritative for implementation scope, dependency order, and acceptance criteria.

If another document conflicts with implementation scope, this document wins. Architecture boundaries in `ARCHITECTURE.md` remain authoritative and must not be weakened.

New functionality must **replace, not expand**, the approved scope.

## 0. Product outcome

Build one polished end-to-end AI cruise-planning product vertical slice:

```text
natural-language intent
  -> deterministic criteria capture
  -> progressive orbital materialization
  -> deterministic search
  -> partial live availability + price evidence
  -> lock / budget / compare
  -> approved policy Q&A with citation
  -> selected voyage
  -> simulated sign-in + session rotation
  -> price/inventory revalidation
  -> atomic short-lived hold
  -> signed checkout handoff
  -> existing checkout boundary
```

Also build one failure path:

```text
model failure
  -> preserve confirmed criteria/evidence
  -> GuidedVoyagePlanner
  -> same deterministic search/availability/pricing
```

## 1. Approved scope

### Must implement

- anonymous-first natural-language intent
- Adaptive Serenity Voyage Canvas
- deterministic criteria parser for hero fields
- typed `VoyageExperience` reducer/state
- streaming statuses/partial results
- deterministic search, availability, pricing
- Evidence objects with freshness/provenance
- semantic orbit + equivalent List view
- lock preference
- budget manipulation without LLM
- deterministic compare-two
- approved policy retrieval/RAG and citation
- model/embedding provider abstractions (mock + Gemini)
- one bounded orchestrator
- prompt-injection defense
- PII redaction
- commerce-claim grounding validator
- simulated authentication + session rotation
- atomic/idempotent hold with expiry/reconciliation
- signed booking handoff
- model-independent Guided Planner fallback
- accessibility/reduced motion
- OpenTelemetry/cost controls
- deterministic tests, retrieval eval, golden eval, red team
- hero + fallback Playwright E2E
- deterministic demo reset and backup recording

### Do not build

- autonomous payment
- real payment forms inside Voyage Canvas
- live RCG APIs
- live AEM implementation
- voice/multilingual
- weather/dining/excursion product agents
- broad multi-agent graph
- Kubernetes
- large vector server/platform
- WebGL/3D
- broad analytics dashboard
- more than one complete guest journey

## 2. Target repository structure

```text
C:\POC\RCG
|
+-- AGENTS.md
+-- README.md
+-- IMPLEMENTATION_PLAN.md
+-- ARCHITECTURE.md
+-- DOMAIN_CONTRACTS.md
+-- DESIGN.md
+-- EVAL_SPEC.md
+-- .env.example
+-- docker-compose.yml
+-- pnpm-workspace.yaml
+-- package.json
|
+-- apps/
|   +-- web/
|       +-- app/
|       |   +-- page.tsx
|       |   +-- existing-checkout/page.tsx
|       |   +-- api/
|       |       +-- experience/route.ts
|       |       +-- auth/mock/route.ts
|       |       +-- hold/route.ts
|       |       +-- booking/start/route.ts
|       |       +-- health/route.ts
|       +-- components/
|       |   +-- VoyageCanvas.tsx
|       |   +-- IntentPortal.tsx
|       |   +-- TravelerCore.tsx
|       |   +-- ConstraintOrbit.tsx
|       |   +-- JourneyOrbit.tsx
|       |   +-- VoyageNode.tsx
|       |   +-- BudgetControl.tsx
|       |   +-- PreferenceLock.tsx
|       |   +-- ComparisonLens.tsx
|       |   +-- EvidenceDrawer.tsx
|       |   +-- PriceEvidence.tsx
|       |   +-- AvailabilityEvidence.tsx
|       |   +-- PolicyEvidence.tsx
|       |   +-- StreamingProgress.tsx
|       |   +-- UncertaintyState.tsx
|       |   +-- CommitmentPanel.tsx
|       |   +-- GuidedVoyagePlanner.tsx
|       |   +-- AccessibleVoyageList.tsx
|       +-- experience/
|       |   +-- reducer.ts
|       |   +-- context.tsx
|       |   +-- events.ts
|       |   +-- selectors.ts
|       +-- web-component/voyage-canvas.ts
|       +-- styles/
|       |   +-- tokens.css
|       |   +-- motion.css
|       |   +-- canvas.css
|       +-- public/assets/
|
+-- packages/
|   +-- shared/src/
|   |   +-- domain.ts
|   |   +-- experience.ts
|   |   +-- evidence.ts
|   |   +-- events.ts
|   |   +-- schemas.ts
|   +-- commerce/src/
|   |   +-- catalog.ts
|   |   +-- search.ts
|   |   +-- pricing.ts
|   |   +-- comparison.ts
|   +-- inventory/src/
|   |   +-- availability.ts
|   |   +-- holds.ts
|   |   +-- reconciliation.ts
|   |   +-- bookingContext.ts
|   |   +-- db.ts
|   +-- content-adapter/src/
|   |   +-- adapter.ts
|   |   +-- ingestion.ts
|   |   +-- retrieval.ts
|   |   +-- citations.ts
|   |   +-- stores/
|   |       +-- mongoVectorStore.ts
|   +-- orchestrator/src/
|       +-- agent.ts
|       +-- modelGateway.ts
|       +-- embeddingGateway.ts
|       +-- providers/mock.ts
|       +-- providers/gemini.ts
|       +-- criteriaParser.ts
|       +-- tools.ts
|       +-- grounding.ts
|       +-- guardrails.ts
|       +-- session.ts
|       +-- prompts.ts
|       +-- observability.ts
|
+-- data/
|   +-- sailings.json
|   +-- ports.json
|   +-- pricing.json
|   +-- policies/
|
+-- eval/
|   +-- golden.jsonl
|   +-- retrieval.jsonl
|   +-- redteam.jsonl
|   +-- runEval.ts
|   +-- runRetrievalEval.ts
|   +-- runRedteam.ts
|
+-- scripts/
|   +-- seed.ts
|   +-- demo-reset.ts
|   +-- latest-trace.ts
|
+-- tests/e2e/
    +-- hero.spec.ts
    +-- fallback.spec.ts
```

## 3. Implementation dependency order

```text
T0  Repository + governance
T1  Adaptive Serenity design system
T2  Shared domain contracts
T3  Eval specification/seed cases
T4  Mongo + Redis + seed/reset foundation
T5  Deterministic search + pricing + comparison
T6  Inventory + holds + idempotency + reconciliation
T7  Criteria parser + anonymous session
T8  Voyage Canvas Orbit/List renderers
T9  Lock + budget + compare
T10 Approved content corpus + ingestion
T11 Embeddings + RetrievalAdapter
T12 Tool registry + schemas
T13 Generative/embedding gateway + mock/Gemini
T14 Bounded orchestration + streaming integration
T15 Grounding + injection defense + PII
T16 Auth rotation + hold + signed booking handoff
T17 Guided fallback + accessibility/reduced motion
T18 Eval execution + red team
T19 Observability + cost controls
T20 Hero + failure E2E
T21 Demo polish + local assets + evidence + backup recording
```

## 4. Review gates

### Gate A - after T2

Freeze domain contracts. Review authority boundaries, shared types, reducer permissions, tool/event schemas.

### Gate B - after T9

The compelling UX must already work with fixtures/mock deterministic services and **without an LLM**:

```text
intent -> criteria -> orbit -> evidence -> lock -> budget -> compare
```

Do not add AI until this vertical slice is solid.

### Gate C - after T17

Prove:

```text
natural language + tools + policy RAG + grounding + auth + hold + booking handoff + fallback
```

### Gate D - after T20

Require all automated assurance evidence before demo freeze.

---

# T0 - Repository scaffold + governance

## Objective

Establish a reproducible pnpm/TypeScript workspace that honors this handoff and Titan-generated governance.

## Dependencies

None.

## Implement

- preserve/copy the authoritative handoff docs at repository root
- initialize pnpm workspace
- add `apps/web`, `packages/*`, `data`, `eval`, `scripts`, `tests/e2e`
- add shared TypeScript/ESLint/Vitest config
- add `.gitignore`
- keep `.env.example`; never commit `.env`
- wire root scripts with placeholders only for packages that exist
- preserve `.cursor/rules/voyage-canvas.mdc`

## Acceptance

- `pnpm install` succeeds
- root workspace resolves packages
- `pnpm lint` and `pnpm typecheck` run on scaffold
- Cursor/Titan governance files remain unchanged unless explicitly generated by the governance workflow

## Stop condition

Do not implement product features in T0.

---

# T1 - Adaptive Serenity design system

## Objective

Convert `DESIGN.md` into reusable application tokens/primitives without copying prototype HTML wholesale.

## Implement

- `tokens.css` for color/typography/spacing/glass tiers
- `motion.css` including global reduced-motion handling
- core accessible primitives (button, evidence badge, glass panel, visually-hidden, live-region helper)
- local asset strategy under `public/assets`
- no third-party runtime image URLs in final demo path

## Acceptance

- token values match `DESIGN.md`
- primary controls pass contrast/focus checks
- reduced-motion media query disables nonessential orbit/pulse/particle motion
- no payment orbit patterns introduced

---

# T2 - Shared domain contracts (CONTRACT LOCK)

## Objective

Implement `DOMAIN_CONTRACTS.md` as TypeScript + Zod schemas in `packages/shared`.

## Implement

- SearchCriteria/Occupancy/CabinType
- VoyageExperience
- LockedPreference
- Sailing/VoyageOption
- ToolResult/ToolProvenance
- Evidence
- availability/price/comparison contracts
- policy/retrieval contracts
- bounded model actions
- ExperienceEvent/StatusStep/FallbackReason
- Hold/BookingContext
- GenerativeModel/EmbeddingModel contracts
- port/map contract

## Required reducer authority tests

- model action cannot write availableOptions
- model action cannot write Evidence
- model action cannot write Hold
- model action cannot write BookingContext
- model action cannot alter auth truth
- locked preference cannot be relaxed by model without explicit guest unlock

## Acceptance

- schemas validate known-good fixtures
- bad/unknown tool/event payloads fail validation
- authority tests green
- **Gate A review completed before T3/T4+ parallelization**

---

# T3 - Initial eval specification + seed cases

## Objective

Define expected AI/retrieval behavior before implementing model logic.

## Implement

- preserve/adapt provided `eval/golden.jsonl`, `eval/retrieval.jsonl`, `eval/redteam.jsonl`
- add schema validation for eval case formats
- no runner/model required yet

## Acceptance

- at least 10 golden cases
- retrieval labels for locked policy questions
- initial injection/authz/hallucination/PII/autonomy red-team cases
- cases assert behavior, not exact prose

---

# T4 - Mongo + Redis + deterministic seed/reset

## Objective

Create local infrastructure and deterministic demo reset.

## Implement

- Docker Compose with Mongo replica-set capability and Redis
- Mongo collections/indexes for inventory, holds, booking contexts, policy chunks as needed
- Redis session namespace/TTL
- `pnpm seed`
- `pnpm demo:reset`
- fixed synthetic demo IDs/dates/prices

## Acceptance

- `docker compose up -d` succeeds
- seed/reset is repeatable
- hero dataset uses March 2027 consistently
- no real RCG policy/content is represented as authoritative

---

# T5 - Deterministic commerce: search, pricing, comparison

## Objective

Make the non-AI commerce decision core complete and testable.

## Implement

- sailing catalog loader
- filter by destination/month/nights/occupancy/cabin/budget
- deterministic pricing fixture/service with quoteId/asOf/validUntil
- deterministic comparison delta service
- deterministic hero prices chosen to support budget interaction, e.g. three options around $4,280 / $4,620 / $4,740 if fixtures use those values

## Acceptance/tests

- same input -> same price
- cabin/occupancy affect price according to fixture rules
- budget filtering works
- comparison delta computed server-side
- no LLM dependency

---

# T6 - Inventory, holds, idempotency, reconciliation

## Objective

Implement the correctness-critical hold path.

## Implement

- authoritative cabin availability
- durable holds
- unique durable idempotency key
- Mongo transaction/conditional claim
- revalidation hook for quote/inventory
- Redis expiry signal only
- reconciliation worker/CAS release
- guest ownership checks

## Mandatory tests

- hold decrements/claims once
- sold-out rejects
- 20 concurrent attempts on final cabin -> exactly one success
- same idempotency key -> same hold/no second claim
- expired hold releases once
- parallel reconcilers do not double-release
- confirmed/non-held state not reclaimed
- cross-guest access denied

## Acceptance

All mandatory correctness tests green before AI work can mutate/trigger state.

---

# T7 - Criteria parser + anonymous session

## Objective

Capture useful structured intent before any model call so fallback can preserve progress.

## Implement

Deterministic parser support for hero fields:

- Caribbean destination
- March 2027 / month expression
- 7 nights
- adults/children counts
- balcony cabin
- under/max dollar budget

Redis session stores only safe planning state.

## Acceptance

The hero input:

`7-night Caribbean cruise in March 2027 for 2 adults and 2 kids, balcony, under $5,000`

must produce the expected structured criteria with `LLM_PROVIDER=mock` and even with model calls disabled.

---

# T8 - Voyage Canvas Orbit + List renderers

## Objective

Build the differentiated frontend using the same Experience Model for visual and accessible representations.

## Implement

- IntentPortal
- TravelerCore
- ConstraintOrbit
- JourneyOrbit/VoyageNode
- AccessibleVoyageList
- Evidence drawer shell
- streamed status region
- trusted local port/map data if geography is used

## UX rules

- orbit represents semantic relationships, not decoration
- no generated geography labels/coordinates
- expose consumer language such as `Your Trip`, `Explore`, `Why this fits`; internal architecture names need not become navigation labels
- initial experience is anonymous; do not display fictional loyalty/private profile state before authentication

## Acceptance

Fixture-driven page visually follows selected references while remaining reusable React code.

---

# T9 - Lock + budget + deterministic compare

## Objective

Deliver the core "AI-native direct manipulation" demo without relying on model calls.

## Implement

- lock/unlock preference
- budget control
- orbit/result reordering/filtering from deterministic services
- compare exactly two options
- deterministic comparison evidence
- explicit no-exact-match/closest-fit state when locks conflict with budget

## Acceptance

- locked balcony survives budget change
- moving budget does not call model
- comparison math is deterministic
- Orbit/List views stay state-equivalent
- **Gate B review passes**

---

# T10 - Approved content corpus + ingestion

## Objective

Create a small synthetic approved-content corpus for the policy/RAG path without claiming it is real RCG policy.

## Implement

- 3-4 synthetic docs under `data/policies/`
- mark docs clearly as demo/synthetic approved content
- fields: id/title/topic/effective or published date/content/keywords/contentVersion/classification
- content allow-list/classification validation
- chunking + metadata ingestion

## Safety gate

Ingestion must reject forbidden commerce classifications/fields (price, inventory, availability, discounts, taxes, fees, holds, booking status, loyalty balance).

## Acceptance

Corpus is small, reviewable, reproducible, and contains no secrets/real company-specific policy claims presented as truth.

---

# T11 - Embeddings + RetrievalAdapter

## Objective

Implement the only vector/retrieval home: `packages/content-adapter`.

## Implement

- separate `EmbeddingModel` interface
- mock + provider-backed embedding implementation as appropriate
- embed corpus at seed/ingestion time
- store vectors + model/content version metadata in Mongo `policy_chunks`
- brute-force cosine top-k in `retrieval.ts`
- optional metadata/topic filter
- citation/source metadata preservation
- `RetrievalAdapter` hides store implementation

## Acceptance

- locked retrieval eval cases return expected source within top 3
- no commerce truth appears in vector index
- no vector server required for POC
- orchestrator is store-agnostic

---

# T12 - Tool registry + schemas

## Objective

Expose exactly the six approved domain tools through typed server-side adapters.

## Tools

- search_sailings
- check_availability
- get_pricing
- get_policy_content
- create_hold
- start_booking

## Implement

- Zod argument/result schemas
- ToolResult envelope
- auth context propagation
- timeouts/error codes
- deterministic freshness metadata
- explicit confirmation requirement for create_hold

## Acceptance

- malformed/free-form model arguments cannot reach services
- credentials are never exposed to model
- all state-changing calls require server-side authz/idempotency controls

---

# T13 - Generative + embedding gateway, mock + Gemini

## Objective

Add provider-neutral AI adapters without coupling business logic to a model vendor.

## Implement

- `GenerativeModel` and `EmbeddingModel` gateways
- MockProvider for offline CI/demos
- Gemini provider implementation/config
- model IDs from environment/config only
- fast vs capable routing semantics
- timeout, token/context caps, telemetry hooks

## Do not call LLM for

- page load
- budget slider
- lock/unlock
- sorting
- comparison math
- availability refresh
- pricing refresh
- hold
- booking handoff

## Acceptance

- `LLM_PROVIDER=mock` fully supports tests
- switching provider does not change orchestrator/domain contracts

---

# T14 - Bounded orchestration + streaming integration

## Objective

Create one simple bounded orchestrator, not a multi-agent graph.

## Flow

```text
input
 -> deterministic criteria exists
 -> optional intent resolve/clarify
 -> validate criteria/actions
 -> deterministic required tools
 -> observe results
 -> optional grounded narrative
 -> validate response
 -> stream semantic events
```

## Implement

- max tool steps = 4
- only approved BoundedAction values
- structured event stream
- partial verified evidence as tools finish
- do not stream unverified price/inventory

## Acceptance

Hero search can run end-to-end and stream status/evidence; mock provider remains offline-capable.

---

# T15 - Grounding + injection defense + PII

## Objective

Make trustworthy AI behavior structural rather than prompt-only.

## Implement

- retrieved context marked untrusted
- pre-model allow-list/PII redaction
- system/tool authority isolated from retrieved text
- narrative evidence-reference support
- commerce-claim provenance validator
- citation validator
- redacted traces

## Acceptance

- fake-price request cannot produce unsupported authoritative value
- injection in retrieved policy cannot call tools/change auth
- PII fixtures do not appear in model payload/logs
- current-turn commerce claim validation passes/fails correctly

---

# T16 - Auth rotation + hold + signed booking handoff

## Objective

Prove progressive auth and the controlled transition from assistant to checkout.

## Implement

- `Simulate Sign In`
- rotate anonymous -> authenticated session ID
- copy safe planning state
- bind server-side guest identity
- expire anonymous session
- explicit guest-confirmation UI token
- hold endpoint invokes deterministic inventory service
- price/inventory revalidation before hold success
- countdown/expiry state
- signed short-lived BookingContext
- `/existing-checkout` validates signature/expiry and labels boundary clearly

## CTA

`Continue to secure checkout`

Never `Confirm & Pay` inside Voyage Canvas.

## Acceptance

- anonymous hold denied
- auth rotates session
- cross-guest hold denied
- retry-safe hold
- signed handoff validated
- payment not implemented in assistant

---

# T17 - Guided fallback + accessibility + reduced motion

## Objective

Make failure a real usable journey and close frontend accessibility gaps.

## Implement

- fallback event on timeout/error/policy block/circuit open/feature disable
- preserve confirmed criteria/evidence
- GuidedVoyagePlanner using same deterministic APIs
- keyboard-complete flow
- semantic node buttons
- focus management
- aria-live statuses
- Orbit/List switch
- no hover-only essential detail
- non-color-only evidence/uncertainty
- global reduced-motion handling
- stop-generation control where streaming narrative exists

## Acceptance

Model failure never produces a dead-end error page; deterministic search remains usable.

**Gate C review after T17.**

---

# T18 - Execute evals + red team

## Objective

Turn `EVAL_SPEC.md` and seed datasets into executable release gates.

## Implement

- retrieval eval runner (Recall@1/3)
- golden structured behavior assertions
- faithfulness/citation scoring where useful
- red-team runner
- machine-readable summary artifacts

## Acceptance

- locked retrieval cases top-3 pass
- invented commerce values = 0
- unauthorized tool calls = 0
- locked red-team cases contained/rejected = 100%

---

# T19 - Observability + cost controls

## Objective

Produce one understandable trace for the hero path and demonstrate production-minded controls.

## Implement

OpenTelemetry spans for request/parser/model/embedding/retrieval/tools/grounding/hold/handoff.

Record:

- latency
- provider/model tier
- tokens/estimated cost
- tool calls
- evidence IDs
- fallback reason
- redacted errors

Controls:

- per-session/request quotas
- model timeout
- max tool steps
- retrieval top-k cap
- context/output caps
- no model for deterministic interactions

## Acceptance

`pnpm latest-trace` (or equivalent) produces one readable hero trace with no raw PII.

---

# T20 - Hero + failure Playwright E2E

## Hero E2E

1. open host page
2. submit hero prompt
3. criteria materialize
4. streamed status progression visible
5. three voyage possibilities appear
6. verified availability/price evidence appears
7. lock balcony
8. move budget 5000 -> 4400
9. verify lock remains and options change deterministically
10. compare two voyages
11. ask child-document policy question
12. citation/source appears
13. select voyage
14. simulate sign-in
15. explicitly confirm hold
16. hold timer/evidence appears
17. continue to checkout
18. existing-checkout page validates handoff

## Failure E2E

1. force model timeout/mock failure
2. submit same request
3. confirmed criteria retained
4. fallback state shown
5. GuidedVoyagePlanner renders
6. same deterministic search/pricing/availability works
7. verified evidence still visible

## Acceptance

Both E2Es green in deterministic CI mode.

**Gate D review after T20.**

---

# T21 - Demo freeze

## Objective

Make the live interview reproducible and stop feature development.

## Implement

- move all runtime imagery/assets local
- remove obsolete prototype dates/names
- use March 2027 consistently
- verify no external runtime asset dependency for hero path
- deterministic `pnpm demo:reset`
- evaluation/red-team summary artifact
- one complete hero trace artifact
- backup recording of hero + fallback paths
- concise README/demo script

## Acceptance / Definition of Done

```text
[ ] Natural-language hero prompt works
[ ] Traveler constraints materialize
[ ] Three voyage possibilities appear
[ ] Results stream progressively
[ ] Price/availability are deterministic Evidence
[ ] Balcony lock works
[ ] Budget manipulation reorganizes options without LLM
[ ] Compare-two uses deterministic deltas
[ ] Policy answer has approved-content citation
[ ] Anonymous planning works
[ ] Authentication rotates session
[ ] Hold is transactionally safe/idempotent
[ ] Price/inventory are revalidated at hold
[ ] Hold expires/reconciles safely
[ ] BookingContext is signed/guest-bound
[ ] AI never performs payment
[ ] Existing checkout boundary is visible
[ ] Model outage preserves progress
[ ] Guided fallback works
[ ] Prompt injection red-team passes
[ ] PII absent from model payloads/traces
[ ] Commerce hallucination gate passes
[ ] Keyboard-only flow works
[ ] Reduced-motion works
[ ] Orbit/List equivalent state exists
[ ] Hero E2E passes
[ ] Failure E2E passes
[ ] Retrieval eval passes
[ ] Golden eval passes
[ ] Red team passes
[ ] Complete OTel trace exists
[ ] Demo reset is deterministic
[ ] Backup recording exists
```

After these conditions pass: **freeze code. Do not add more futuristic features.**

## 5. Parallel execution after T2

Only after Gate A contract lock:

```text
                   T2 CONTRACT LOCK
                          |
          +---------------+---------------+
          |               |               |
          v               v               v
   Backend core       Frontend UX       Knowledge/AI
    T4-T7              T8-T9            T10-T15
          |               |               |
          +---------------+---------------+
                          v
                     Integration
                     T16-T19
                          |
                          v
                       E2E T20
                          |
                          v
                    Demo freeze T21
```

Do not let parallel agents invent alternate domain/event/tool contracts.

## 6. Final product principle

> **The traveler is the stable core. AI may reorganize possibilities around them, but locked preferences remain under guest control and every commerce-sensitive object is grounded in deterministic evidence.**
