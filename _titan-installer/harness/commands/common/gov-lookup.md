# /common/gov-lookup — Governance Retrieval

Ground a governance question (hard-stop rule, contract owner, escalation contact, build note) in the **current** `CLAUDE.md` / `reviewer-map.json` / `aem-build-map.json` instead of an agent's inlined, possibly-stale copy of those tables. Every result carries a `source` citation (`file:line-range` or `file#key`) so the answer is traceable, not asserted.

**Status: fully supported.** Backing script: `harness/scripts/gov-retrieve.py`. Zero-token fast path also exists via `?gov` (see `answer-cache.py` — exact-match prefix only, same contract as `?build`/`?reviewers`/`?ki`).

## When to invoke

- Any subagent (notably `review-orchestrator.md`, `adversarial-verifier.md`) that needs to confirm a hard-stop, owner, or escalation contact for a specific changed file, instead of trusting an inlined table that may have drifted since the agent file was last edited.
- A developer asking "who owns this file", "is this a hard stop", "what's the build note for this module" — try `?gov <query>` first (zero tokens); fall back to this skill for anything the exact-match cache misses.

## Step 1 — Run the retrieval script

```bash
python .claude/scripts/gov-retrieve.py --query "<free text>" [--file "<changed-path>"] [--kind hardstop|contract|contact|convention|known-issue] [--top-k 5] --format md
```

- Pass `--file` whenever a specific changed path is known — exact glob matches score highest and will surface the correct `reviewer-map.json` rule even with no query text.
- Pass `--kind` to bias toward hard-stop tables vs. contract registry vs. build notes.
- If the script returns no results, say so plainly — do **not** fall back to reciting a remembered table from training data or from another agent's inlined copy. "No governance match found for `<query>`" is the correct answer when retrieval is empty; per org rules, do not guess.

## Step 2 — Present the answer with citation

```
GOVERNANCE LOOKUP — "<query>"

<answer text>

Source: <file:line-range or file#key>
```

If the script's `redaction_note` field is present (query targeted an irrotatable-secret path), output that note verbatim and stop — do not attempt to read or describe the file itself.

## Step 3 — When multiple results are close in score

Show up to 3, each with its own citation, and let the caller (human or agent) pick — do not silently merge or pick "the most likely one" when scores are within 1.0 of each other.

## Non-goals

- This is retrieval, not reasoning. It does not decide whether a file change is a violation — it surfaces the current rule text so a reviewer subagent or human can decide.
- It never returns content from `hybris/config/**`, `hybris-system-token/`, `certs/**/*.p12`, `azure/saml/**/*.jks`, `globalLink*` — those are hard-excluded from the index (mirrors `protect-secrets.py`).
- Local only — no external egress, no calling out to any web/API source. If governance content isn't in `CLAUDE.md` / `reviewer-map.json` / `aem-build-map.json`, the answer is "not found," not a web lookup.
