# /arch-decision — Architectural Decision Record

Produce a structured Decision Record (SCQA format) for any architectural choice on the platform. The record survives the session, briefs offshore developers with the "why" behind constraints, and feeds into future arch-mode sessions as prior context.

**Invoke from within `/arch-mode`.** Output is Markdown — commit to `docs/decisions/` in the affected repo.

---

## ⚠ OUTPUT FORMAT OVERRIDE

This skill overrides the standard `/arch-mode` output format (Recommendation / Why / Trade-off / Risks / Next step) for this invocation. Follow the numbered steps below **in sequence**. Do not skip steps or collapse them into a single response.

- Step 1 must STOP and ask the user for all 6 inputs before proceeding. Do not draft anything from Step 2 until the user has answered.
- Step 2 produces the SCQA Markdown draft — not a prose recommendation.
- Step 3 spawns 3 parallel subagents. Do not skip this step even if the recommendation seems obvious.
- Step 5 writes a file. This is required — the record must persist beyond the session.

---

## Step 1 — Gather decision context

Ask the user for **all 6 items below** in a single prompt. Wait for the user's answers before proceeding to Step 2.

```
To produce your Decision Record, I need:
1. ADO ticket or topic that triggered this decision
2. Situation — what is the current state of the system?
3. Complication — what changed or was discovered that forces a decision now?
4. Options under consideration (minimum 2, including "do nothing")
5. Which repos are affected (resolve against `config.repos[]`)
6. Does this touch a Cross-Repo Contract? (GraphQL schema, OCC endpoint, PIM field, clientlib)
```

If the user already provided some of these in the message that invoked this skill, pre-fill those fields and ask only for the missing ones. Do not invent or assume missing answers.
1. ADO ticket or topic that triggered this decision
2. Situation — current state of the system relevant to this decision
3. Complication — what changed or was discovered that forces a decision now
4. Options under consideration (minimum 2, including "do nothing")
5. Which repos are affected (resolve against `config.repos[]`)
6. Whether this touches a Cross-Repo Contract (GraphQL schema, OCC endpoint, PIM field, clientlib category)

If the user provides an ADO ticket number and ADO MCP is connected, fetch the ticket title and description to pre-fill Situation and Complication.

---

## Step 2 — Draft the SCQA record

Write the initial draft using this exact template:

```markdown
# [DECISION-NNN] <title in imperative form>

**Date:** <YYYY-MM-DD>
**Status:** PROPOSED
**ADO Ticket:** <link or N/A>
**Author:** Lead Architect — <name, per Titan session header>
**Repos affected:** <list>
**Contract change:** <Yes — GraphQL / OCC / PIM / clientlib | No>
**Requires sign-off from:**
  - Owner for this area (if CIF / GraphQL / OCC — resolve via `?gov <path>`)
  - Owner for this area (if AEM / pipeline / .cloudmanager — resolve via `?gov <path>`)
  - PIM team (if PIM fields)

---

## Situation
<Current state — 2–4 sentences. What exists today that is relevant to this decision.>

## Complication
<What changed, broke, or was discovered that makes a decision necessary now. Why this cannot be deferred.>

## Question
<Single decision question — "Should we X or Y?" or "How should we implement Z?">

## Answer

### Option A — <name> [RECOMMENDED]
<Description of the approach — what we build, where it lives, how it integrates.>

**Pros:**
- <benefit>

**Cons / trade-offs:**
- <trade-off>

**Migration impact:** <Effect on the migration repo's naming/phase progression, per `config.repos[].module_naming`>
**Security impact:** <Auth, data exposure, or attack surface change introduced by this option>
**Contract impact:** <GraphQL field, OCC endpoint, PIM field, or clientlib category affected>

---

### Option B — <name>
<Description — brief>

**Pros / Cons:** <brief summary>
**Migration impact:** <brief>

---

### Option C — Do nothing
<What breaks or degrades if the decision is deferred indefinitely>

---

## Decision
<State the chosen option. One sentence with the primary justification.>

## Consequences

**Becomes easier:**
- <outcome>

**Becomes harder / ruled out:**
- <outcome>

**Follow-up tickets:**
- [ ] <ticket to create if decision is accepted>

## Sign-off record
| Role | Name | Date | Reference (email / ADO comment / Teams) |
|------|------|------|-----------------------------------------|
| Lead Architect | <name> | <date> | Author |
| CIF / GraphQL owner | <resolve via `?gov <path>`> | Pending | |
| AEM / Pipeline owner | <resolve via `?gov <path>`> | Pending | |
```

---

## Step 3 — Parallel challenge review

Spawn 3 reviewer agents simultaneously using the Agent tool. Pass the full draft SCQA record to each.

| Subagent | Focus | Model |
|----------|-------|-------|
| `migration-challenger.md` | Challenge the recommendation — surface unstated assumptions, missing alternatives, weak justifications | sonnet |
| `migration-reviewer.md` | Migration feasibility — does this make the in-flight module naming migration (per `config.repos[].module_naming`) harder? | sonnet |
| `migration-security-reviewer.md` | Security implications — auth exposure, data handling risk, new attack surface | sonnet |

---

## Step 4 — Incorporate reviewer feedback

For each reviewer returning `state: UNSATISFIED`:

- **Challenger flags a missing alternative** → Add it as a new Option in the record
- **Challenger flags a weak justification** → Strengthen the Decision and Consequences sections
- **Migration reviewer flags a risk** → Add it to Option A's Migration Impact and Consequences
- **Security reviewer flags a concern** → Add it to Option A's Security Impact and Consequences; if severe, change Status to BLOCKED

Show the user the delta between draft and revised version. Ask for confirmation before writing.

---

## Step 5 — Write the output file

Determine the next sequential decision number:
```bash
ls <repo>/docs/decisions/DECISION-*.md 2>/dev/null | wc -l
```
Next number = count + 1, zero-padded to 3 digits (e.g. `001`, `012`).

Write the final record to:
```
<repo>/docs/decisions/DECISION-<NNN>-<kebab-case-title>.md
```

If `docs/decisions/` does not exist:
```bash
mkdir -p <repo>/docs/decisions
```

Output:
```
Decision record written:
  docs/decisions/DECISION-NNN-<slug>.md

Status: PROPOSED
Next steps:
  1. Commit file to the branch and include in the PR description.
  2. Obtain sign-off from listed contacts before implementing.
  3. Update Status to ACCEPTED once all sign-offs are recorded.
  4. If this ADR supersedes an earlier decision, add a "Supersedes: DECISION-NNN" line.
```

---

## Guardrails

- Never record credentials, Hybris system token values, OCC base URLs, or session token samples.
- If the decision touches any Cross-Repo Contract, Status must remain PROPOSED until all required sign-offs are obtained and recorded in the Sign-off table.
- Decision records are append-only — never modify an existing DECISION-NNN file. Supersede with a new record.
- Do not commit the file until the user confirms the final content.
