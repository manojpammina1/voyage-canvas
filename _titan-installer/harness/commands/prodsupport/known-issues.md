# /prodsupport/known-issues -- Known Issue Registry Lookup

> **Fast path: type `?ki <id-or-keyword>`** — exact id / whole-word symptom match answered locally from the registry, zero tokens. Use this skill for fuzzy matching and for appending new entries.

Before starting full triage on a customer symptom, check if it matches a known issue. Cuts triage time for repeat incidents.

## Input

Customer symptom — one sentence, redacted of any PII/PHI.

Example: "Customer cannot add item to cart — page shows spinner indefinitely"

## Step 1 — Load the known-issues registry

Registry location: `<workspace>/.claude/known-issues/registry.jsonl`

Each line is a JSON object:
```json
{
  "id": "KI-001",
  "symptom": "Cart add spins indefinitely on product detail page",
  "rootCause": "OCC session expiry not handled — cart call returns 401, UI does not re-auth",
  "workaround": "Ask customer to log out and log back in. Issue resolves on fresh session.",
  "fixVersion": "R2026-04",
  "status": "fixed",
  "runbook": "harness/runbooks/ki-001-cart-session-expiry.md"
}
```

If the registry file does not exist: create it at `<workspace>/.claude/known-issues/registry.jsonl` with an empty first line.

## Step 2 — Match symptom

Compare the customer symptom against the `symptom` field of each registry entry.

Match criteria (any of):
- Key noun phrase appears in both (e.g. "cart add", "checkout", "login")
- Error pattern is identical (e.g. "spinner", "404", "session expired")
- Same product area (e.g. "My Account", "order history", "price display")

## Step 3 — Output if match found

```
KNOWN ISSUE MATCH: KI-001
  Symptom match:  Cart add spins indefinitely
  Root cause:     OCC session expiry — 401 not handled in cart saga
  Status:         FIXED in R2026-04
  Workaround:     Ask customer to log out and log back in
  Fix deployed:   Yes — confirm customer is on R2026-04 or later
  Runbook:        harness/runbooks/ki-001-cart-session-expiry.md
  Customer msg:   "We have identified this issue. Please log out and log back in to resolve it.
                  If the issue persists after logging back in, please contact support."
```

If status is `open` (not yet fixed):
```
KNOWN ISSUE MATCH: KI-007 (OPEN — no fix deployed yet)
  Workaround:     [workaround text]
  Fix ETA:        [fixVersion if set, else "under investigation"]
  Escalate to:    [owner from runbook]
```

## Step 4 — No match found

```
NO KNOWN ISSUE MATCH
  Proceed with full triage via /prodsupport-mode
  If this resolves to a new root cause, add it to the registry (Step 5)
```

## Step 5 — Add a new entry after resolution

After resolving an issue that has no prior registry entry, prompt:

> "Add this to the known-issues registry? Provide: root cause, workaround, fix version."

Generate the JSONL entry:
```json
{ "id": "KI-0XX", "symptom": "<redacted symptom>", "rootCause": "<root cause>", "workaround": "<workaround>", "fixVersion": "<sprint or release>", "status": "open|fixed", "runbook": "" }
```

Paste this line into `<workspace>/.claude/known-issues/registry.jsonl`.

**Never include:** customer names, email addresses, order numbers, or any PII/PHI in registry entries. Use generic descriptions only.

## Escalation

If the matched known issue involves a Hybris irrotatable secret (password, cert, key): output Escalation Alert per CLAUDE.md and stop.
If the symptom could indicate a data breach or PHI exposure: immediately escalate to the owner for this area (see the Titan session header; `?gov <path>` for a specific file), do not continue triage.
