# /common/aem-logs — Triage an AEM (author/publish/CIF) log symptom

Structured log-triage flow for AEM frontend/backend symptoms across the AEM stack (AEMaaCS, local SDK, legacy CQ). Locates the right log source per environment, redacts every excerpt, classifies the signature to an owner, and hands off to `/common/debug` for the fix. Use inside any role — most often `/dev-mode` or `/sre-mode`.

**Caveman intensity for this skill:** `lite`. Escalation alerts are never compressed.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite`.

## Hard rules

1. **Every log excerpt is redacted before display** — same contract as `/common/hybris-logs`:
   ```bash
   python .claude/hooks/redact_lib.py < excerpt.txt
   ```
   Only the masked stdout may be shown. Never echo `redact_lib.py`'s stderr findings verbatim.
2. **No SSH to AEM environments** — this is an existing hard rule (`ops/incident-response.md`): AEMaaCS logs come from Cloud Manager UI or `aio app logs` only.
3. **`aio app logs` for the CIF integration repo is Lead Architect only** — same restriction as `incident-response.md`. If you are not in `/arch-mode` with deploy authority, ask the user to run it and paste the (pre-redaction) output back.
4. Claude never holds Cloud Manager, Adobe I/O, or Dynatrace credentials.

## When to use

- OSGi bundle won't resolve, HTL/Sling script error, replication stuck, dispatcher cache issue, Oak query slowness.
- Symptom is AEM/frontend — if it's Hybris/OCC-backend, use `/common/hybris-logs` instead.

## Step 1 — Capture the symptom + stack flavor

Same discipline as `/common/debug` Step 1. Additionally identify **which AEM stack**:
- **AEMaaCS** — repos whose `config.repos[].role_in_stack` includes `aem` (current production AEM Cloud Service).
- **Local SDK** — developer's own AEM instance.
- **Legacy CQ** — the legacy CQ 5.5-lineage modules in the commerce-platform repo (flag as legacy, expect fewer people who know it).

## Step 2 — Locate the log source (branches by stack)

| Stack | Source | How |
|---|---|---|
| **AEMaaCS — author/publish** | Cloud Manager → Environments → download logs | Browser only — per the existing "no SSH" rule. Guide the user to the exact screen; they download and paste back. |
| **AEMaaCS — CIF integration repo** | `aio app logs` | Lead Architect only (per `incident-response.md`). Others: ask the architect to run it, or escalate. |
| **Local SDK** | `crx-quickstart/logs/error.log`, `crx-quickstart/logs/request.log`, `crx-quickstart/logs/stdout.log` | Read directly — local dev machine files. |
| **Legacy CQ** (`cq-webapp`, `scada-webapp`) | Server-side logs, ops-guided | No committed local log path — ask ops or the owner for this area (`?gov <path>`) for the environment's log location; treat as manual/guided in v1. |

## Step 3 — Collect + redact

```bash
# Local SDK example — grep the exact error with context (Sling/OSGi stack traces are
# usually contiguous; widen -A if the trace looks truncated)
grep -n -B2 -A30 "<exact error signature from Step 1>" crx-quickstart/logs/error.log > /tmp/excerpt.txt
python .claude/hooks/redact_lib.py < /tmp/excerpt.txt
```

Only the masked stdout may be displayed. For Cloud Manager / `aio app logs` output pasted back by the user, apply the same redaction step before looking at it further.

## Step 4 — Classify the signature → owner

Resolve the actual name for each row via `?gov <path>` / `data/reviewer-map.json` rather than a hardcoded list here.

| Signature pattern | Likely area | Owner |
|---|---|---|
| `BundleException`, "unresolved" / "unsatisfied" OSGi component | OSGi bundle wiring | AEM/OSGi owner (`?gov <path>`) |
| `HTL`/`org.apache.sling.scripting.sightly` script error | HTL template | Frontend or AEM infra owner depending on layer (`?gov <path>`) |
| `Sling Models` injection failure ("no adaptable", "cannot inject") | Sling Model / component Java | Frontend owner (`?gov <path>`) |
| Replication queue blocked / `ReplicationException` | Author↔Publish sync | AEM owner (`?gov <path>`) |
| Dispatcher 403/404, cache-miss storm | Dispatcher / CDN config | AEM owner (`?gov <path>`) |
| `OakMerge`, Oak query traversal warning ("index not used") | JCR/Oak query performance | AEM owner (`?gov <path>`) — cross-reference `slow-page-load.md` runbook |
| Clientlib category not found / merge error | `.cloudmanager/` or clientlib config | AEM/Cloud Manager owner (`?gov <path>`) — **Hard Stop**, escalate per the Titan session header before touching `.cloudmanager/` |
| CIF GraphQL resolver error / OCC timeout surfaced in AEM | Cross-repo (CIF ↔ commerce backend) | Contract owners from `?gov <path>` (CIF + backend) |

## Step 5 — Known-issue fast path

`?ki <keyword>` fast path, or `/prodsupport/known-issues` for fuzzy match. Cross-reference: `slow-page-load.md`, `image-broken.md`, `search-zero-results.md`, `translation-missing.md`.

## Step 6 — Hand off to a fix

Triage-only. Root-cause fix goes through `/common/debug` inside `/dev-mode`.

## Step 7 — Codify

After resolution, append a known-issues registry entry — no customer identifiers.

## Anti-patterns to refuse

- SSHing into an AEM environment to "just check the log quickly."
- Running `aio app logs` yourself when not in `/arch-mode` with deploy authority.
- Displaying a Cloud-Manager-downloaded log without redacting it first, on the reasoning that "it's an AEM log, not a Hybris one" — customer data can appear in AEM request logs too.

## Permissions

Allowed: read local `crx-quickstart/logs/*`, `grep`/`tail`/`redact_lib.py`, guide Cloud Manager / `aio app logs` lookups, `?ki` lookups.
Blocked: SSH to any AEM environment, running `aio app deploy`/logs outside Lead Architect scope, displaying unredacted excerpts, writing/editing code, holding platform credentials.
