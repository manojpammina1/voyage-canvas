# Voyage Canvas

RCG Part 1 **Agentic Cruise Planning Assistant** — anonymous NL intent → deterministic commerce → policy RAG → hold → signed checkout handoff. Payment stays in existing checkout; the LLM never owns price or inventory.

## Quick start (interview demo)

```bash
cd voyage-canvas
pnpm install --no-frozen-lockfile
docker compose up -d
pnpm seed
pnpm dev
```

Open **http://localhost:3000**

Before each demo run (optional):

```bash
pnpm demo:reset
```

## 5-minute demo script (browser only)

Talk track while clicking — no terminal needed during the demo.

| # | Say (brief) | Do |
|---|-------------|-----|
| 1 | “Guest describes the trip in natural language — no forms first.” | Click **Explore voyages** (hero prompt pre-filled) |
| 2 | “Three verified options materialize; prices are deterministic, not invented.” | Point at orbit nodes **$4,280 / $4,620 / $4,740** |
| 3 | “Guest locks balcony and scrubs budget — no LLM on the slider.” | **Lock balcony preference** → drag budget toward **$4,400** |
| 4 | “Compare two sailings — delta is server-side math.” | Click **Compare** on two nodes → comparison panel |
| 5 | “Policy answers cite approved synthetic content only.” | **Ask policy (demo)** → children travel docs citation |
| 6 | “Progressive auth before commerce commitment.” | Select a voyage → **Simulate sign in** |
| 7 | “Explicit confirm + atomic hold; inventory is transactional.” | Check confirm box → **Create short-lived hold** |
| 8 | “Assistant stops at signed handoff — checkout owns payment.” | **Continue to secure checkout** → **Handoff OK** page |
| 9 | “If the model fails, criteria are preserved.” | Back → **Simulate AI outage** → **Search again** |

**Fallback path (optional):** Step 9 shows **Guided voyage planner** with the same deterministic APIs.

## Architecture one-liner

> AI may propose. Application validates. Services decide. Evidence proves. Guest confirms. Checkout transacts.

## Verification (optional, before interview)

```bash
pnpm typecheck
pnpm test
pnpm eval:retrieval
pnpm eval
pnpm redteam
pnpm e2e
pnpm latest-trace
curl -s http://localhost:3000/api/health
```

`LLM_PROVIDER=mock` — no paid model calls required for CI or demo.

## Docs

| File | Purpose |
|------|---------|
| `AGENTS.md` | Implementation governance |
| `IMPLEMENTATION_PLAN.md` | Scope lock + task order |
| `ARCHITECTURE.md` | Trust boundaries |
| `DOMAIN_CONTRACTS.md` | Shared types/tools/events |
| `CHECKPOINT.md` | Checkpoint testing guide |
| `DESIGN.md` | UX tokens and behavior |

## Stack

- **apps/web** — Next.js orbital canvas UI
- **packages/** — shared, commerce, inventory, content-adapter, orchestrator
- **data/** — March 2027 hero fixtures + synthetic policy corpus
- Mongo + Redis via `docker-compose.yml`

## Scope note

Playwright covers the hero checkout handoff and model-outage fallback paths. UI visual polish
vs `UI-sample/` can follow after the interview.
