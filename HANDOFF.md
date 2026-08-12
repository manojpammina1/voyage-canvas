# HANDOFF — Voyage Canvas (RCG Principal Engineer take-home)

> Context transfer for a fresh session. Everything below was verified against the repo unless
> marked *reported*. Read `IMPLEMENTATION_PLAN.md` §2/§4 (in `C:\POC\RCG`) before changing contracts.

---

## 1. What this is

Manoj is interviewing for **Principal Engineer (Full-Stack)** at Royal Caribbean Group. Two 45-min
take-homes, deliberately built as **one connected narrative**:

- **Part 1** — System design (20–25 min present + 20–25 min deep-dive Q&A). Chose **Option 5:
  agentic cruise-planning assistant**.
- **Part 2** — Strategy: enabling agentic development across the org, 30/60/90 roadmap.
  Part 1's product is Part 2's "worked production-grade agentic feature."

**Product = "Voyage Canvas"** — an adaptive cruise-planning workspace (not a chatbot). The guest and
their constraints are the center of the UI; cruises appear as manipulable journeys.

**The one-line positioning to protect:**
> "This is not a chatbot that happens to search cruises. It is a governed commerce orchestration
> layer in which the model interprets intent, while trusted enterprise systems remain authoritative
> for pricing, inventory, authorization, booking, and payment."

---

## 2. Frozen architecture invariants (do not violate)

1. **Bounded actions only** — the LLM proposes typed actions against a `VoyageExperience` model. It
   never emits HTML/JS and never writes `availableOptions`, `evidence`, prices, or availability.
2. **Provenance grounding** — every commerce-sensitive claim (price, availability, date, taxes,
   discounts, hold expiry, booking status) must trace to a deterministic tool result from the
   current turn.
3. **Inventory authority** — hold creation is a single Mongo transaction (idempotency check →
   conditional decrement → durable insert). Redis is a TTL signal/cache only, never the authority.
4. **No payment tool.** The assistant produces a signed booking-context deep link and hands off to
   the existing checkout. It never charges.
5. **Trust zones** — anonymous discovery → identity boundary → commitment (hold/booking) →
   existing checkout. No state-changing action while anonymous; auth rotates the session id.
6. **Model-independent fallback** — criteria captured by UI chips + a deterministic parser, so the
   guided-search fallback survives a model outage.
7. **RAG is for approved policy/descriptive content only** — never pricing or availability.
8. **Provider abstraction** — `LLM_PROVIDER=gemini|mock`. Gemini is the POC endpoint only.

---

## 3. Repo state (verified)

`C:\code\voyage-canvas` — pnpm workspace, ~90 TS/TSX files, 9 test files.

```
apps/web/          Next.js App Router; 17 components; experience/ reducer + context
packages/shared    domain types, Zod schemas, reducer, authority tests
packages/commerce  search, pricing, comparison (deterministic deltas)
packages/inventory holds, availability, reconciliation, bookingContext
packages/content-adapter  policy RAG (Mongo policy_chunks + brute-force cosine; mock/gemini embeddings)
packages/orchestrator     agent loop, modelGateway, grounding, guardrails, tools, session
eval/              golden.jsonl (10) · redteam.jsonl (8) · retrieval.jsonl (5)
data/              3 sailings, 5 policy docs, ports.json, pricing.json
```

**Verified good:** accessibility is real (reduced-motion, `aria-live`, `aria-hidden` on decorative
orbit rings, orbit nodes are real `<button>`s); dates normalized to **March 2027** (no 2024
residue); zero remote image references; hero prices **$4,280 / $4,620 / $4,740** so the
$5,000 → $4,400 budget filter demo works; real Gemini + mock providers, no hardcoded model names.

**Demo script** lives in `README.md` (9 steps, browser-only). Playwright E2E (T20) was skipped.

**Run:** `docker compose up -d && pnpm seed && pnpm dev`. The intent screen renders without Docker;
canvas/orbit stages need Mongo.

---

## 4. Backend audit — three say/do gaps (IMPORTANT for interview honesty)

A full audit was run. **What holds** (verified): payment boundary (exactly 6 tools, no payment
tool), auth/trust zones (anonymous hold rejected before any DB write; auth context derived
server-side; session id rotates on sign-in), deterministic comparison deltas, reducer rejects
model writes to authority fields, atomic hold via Mongo transaction on the primary path.

**Three gaps where the deck would over-claim** — either fix them or narrow the claim:

| # | Gap | Evidence |
|---|---|---|
| 1 | **Mixed-initiative is 1/6 wired.** `modelGateway.ts:212` produces `proposedActions`, but `agent.ts:166-173` reads only `criteriaPatch` + `clarificationQuestion` — `proposedActions` is parsed then **discarded**. Only `ASK_CLARIFICATION` is ever model-emitted. Also `BoundedAction` is a plain string union with `payload: unknown` / `z.unknown()`, not the specified discriminated union — payload shape is never validated. |
| 2 | **Grounding is narrower than described.** `grounding.ts:3` is a **price-only regex** matched against `totalUsd`; it runs **per streamed chunk** (a `$4,` / `280` split can slip through) and on violation **discards the whole message**. `validatePolicyCitations` is dead code. |
| 3 | **Holds never expire.** `reconcileExpiredHolds` has **no caller outside tests** — no cron, interval, or route. The restore is also a separate write after the CAS (at-most-once). A non-transactional fallback path (`holds.ts:161`), triggered by string-matching a driver error, does three independent writes. |

Minor: `BOOKING_CONTEXT_SECRET` defaults to `'replace-me'` with no startup guard; signature compare
isn't constant-time; RAG scoring has hardcoded per-fixture boosts (`vectorStore.ts:60-71`).

**Suggested order:** schedule the reconciler + delete the non-txn fallback (~30 min) → post-turn
grounding buffering + availability/dates (~1–2 hrs) → wire `proposedActions` *or* consciously
narrow the claim.

---

## 5. Design system — resolved conflict

There were **three** competing sources. Resolution:

- ✅ **Canonical:** `voyage-canvas/DESIGN.md` — *"Voyage Canvas / Adaptive Serenity"*.
  primary `#003e7a`, sunset accent `#9b4500` / `#fc8a40`, `evidence-verified` `#00C853`,
  `ocean-deep`, `sunset-glow`.
- ❌ Discard *"Aura Oceanic"* (primary `#0077b6`, teal secondary, no warm accent).
- ⚠️ `tokens.css` was **mislabelled** — header said Adaptive Serenity, values were Aura Oceanic.
  **This is why the UI read flat: the sunset accent was never in the tokens at all.**

**Typography (per DESIGN.md):** `--font-display` = **Geist** (display-xl, headline-lg,
headline-lg-mobile, label-caps); `--font-body` = **Inter** (body-md, evidence-data).

**Token guardrail:** 37 distinct `var(--…)` tokens are referenced across 10 files. Change values,
**never rename a variable.**

**Assets (verified in place):** `apps/web/public/assets/hero-desktop.webp` (84 KB) and
`hero-mobile.webp` (94 KB) — cruise ship at sunset over turquoise water, matching the warm accent.

---

## 6. UI work — status

**Just completed (*reported* — verify):** tokens rewritten to the canonical palette; Geist + Inter
loaded via `next/font`; hero images wired into `.vc-ambient` (`canvas.css:17`) with a white scrim
and media-query swap; sunset accent reserved for verified price + primary CTA.

**Verify:** `pnpm typecheck`, `pnpm --filter @voyage/web test a11y`, then screenshot the intent
screen and the canvas. Check text contrast over the photo background — that's the main risk of
putting a photo behind glass.

**Deliberately deferred (natural second pass):**
1. **Give the commitment stage its own focused view.** `CommitmentPanel` is currently buried inside
   `ConstraintPane` (left rail). The plan's Stage F says the interface *simplifies* as certainty
   rises — collapsing the 3-pane into a single focused commit view is the emotional peak of the demo.
2. **Make the evidence chip visually dominant.** The `asOf` / `validUntil` / "Verified 2:14 PM"
   provenance marker is the whole differentiator; it should out-weigh the ship name.

Both need component restructuring, so they were kept out of the CSS/tokens pass.

---

## 7. Part 2 — the governance harness ("Titan")

Manoj already built and operates an internal **Claude Code governance + adoption platform** at his
current employer: guardrail hooks in the agent loop, ~15 reviewer subagents + a review orchestrator,
66 commands, telemetry/cost dashboard, config-driven installer. It already implements most of what
Part 2 asks RCG to *plan* — so Part 2 is a **proven playbook**, not a hypothetical.

- **Location:** `C:\codebase\titan\titan` (still double-nested; `C:\codebase\generic` is a stale
  duplicate without the T12 work — consolidate and retire it).
- **The improvement that matters:** Titan is company-neutral but **Claude-Code-specific**. Making it
  *agent-neutral* (one governance core → `.claude/` **and** `AGENTS.md` renders) is exactly Part 2's
  anti-lock-in thesis. Spec: `C:\POC\RCG\T12_TITAN_AGENT_NEUTRAL.md`.
- **IP guardrail:** present **patterns, architecture, and lessons only**. Do not use the internal
  product name, real repo names, agent counts, or internal metrics. Phrasing: *"At my current company
  I designed and operate an internal AI-development governance and adoption platform. I'll discuss
  only the transferable architecture, governance patterns, and lessons."*

---

## 8. Key documents

| Path | What |
|---|---|
| `C:\POC\RCG\IMPLEMENTATION_PLAN.md` | Build spec — **§2 invariants and §4 contracts are authoritative for code** |
| `C:\POC\RCG\PRODUCT_SPEC.md` | Product definition, AI capabilities/limits, how-to-use, screen→task map |
| `C:\POC\RCG\T12_TITAN_AGENT_NEUTRAL.md` | Agent-neutral harness spec |
| `C:\POC\RCG\DEV_KICKOFF.md` | Line-by-line build runbook (T0–T21) |
| `voyage-canvas/DESIGN.md` | Canonical design system |
| `voyage-canvas/README.md` | 5-minute demo script + talk track |

Two finished `.docx` decks exist in `~/Downloads` (Part 1 architecture, Part 2 strategy). They are
**behind the current state** — they still describe chat + `SailingCard/CabinCard/PriceCard` and a
Claude-specific harness, and predate Voyage Canvas. They need updating before the interview.

---

## 9. What's left, in priority order

1. **Verify the UI pass** (typecheck, a11y test, screenshots, contrast over the photo).
2. **Close the three backend say/do gaps** — reconciler scheduling first (30 min), then grounding.
3. **Update the two decks** to Voyage Canvas + the agent-neutral harness.
4. Optional second UI pass: commitment view + evidence hierarchy.
5. Optional: consolidate the Titan repo path and retire `C:\codebase\generic`.
6. Record hero-path and failure-path backup videos before the interview.

**Scope is frozen.** Any new idea must replace a scoped item, not add to it. MUST-haves are the
Voyage Canvas hero journey, deterministic commerce, inventory correctness, grounding, the failure
path, evaluation, and the decks — in that order.
