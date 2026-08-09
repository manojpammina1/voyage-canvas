# /phi-guard — Tiered PHI / PII Scanner

Scan text, code, or files for PHI (Protected Health Information) and PII (Personally Identifiable Information) before they enter a commit, log, response, or test fixture. Applies a tiered policy: BLOCK / REDACT / FLAG based on category and the project's medical-device domain context.

**Caveman intensity for this skill:** **off**. PHI/PII findings are safety-critical — output must be uncompressed regardless of session-wide intensity.

**On activation:** Disable caveman compression for this skill's output (use `/caveman off` for the duration of the scan, then restore caller's intensity after).

## Origin

Adapted from RuvNet `ruflo-aidefence` `pii-detect` pattern. The plugin itself is NOT installed per CLAUDE.md "Approved Plugins, Skills & MCP Servers". This is a native re-implementation calibrated for **dental medical-device PHI**, not generic PII, with NO external API calls.

## When to use

- Before committing code that touches user-facing strings, error messages, logs, or test fixtures
- During `/lead-review` as a defence-in-depth check
- When importing data (e.g. mock data files, sample CSVs) into the workspace
- When the user pastes raw data into chat — scan before processing

## Tiered policy

Domain context: medical device company. PHI is the highest sensitivity tier. The CLAUDE.md G3 rule is absolute: PHI/PII never enters code, tests, or logs. This skill enforces that with three response tiers based on category.

| Category | Examples | Tier | Action |
|----------|----------|------|--------|
| **Patient identifiers** | Patient names + DOB, Patient ID, MRN (Medical Record Number), insurance member ID | BLOCK | Refuse to proceed. Emit Escalation Alert. Recommend redacting from source before retry. |
| **Patient clinical data** | Diagnosis, procedure code, treatment notes, adverse event reports | BLOCK | Same — refuse. PHI under HIPAA. |
| **Patient biometric** | Dental imaging file metadata (DICOM), scan IDs tied to a patient | BLOCK | Same. |
| **Dental practice data** | Real practice names, addresses linked to billing | BLOCK | Contractual-confidentiality — refuse. |
| **Customer reviews / verbatims** | Customer feedback with names | BLOCK | Confidential business data. |
| **Sales rep individual data** | Internal sales rep names tied to deal data | REDACT | Suggest replacing with role-based identifier (`SALES_REP_REGION_X`). Continue after user confirms redaction. |
| **Generic PII — email** | `user@example.com`, contact emails | REDACT | Suggest replacement with `<email-redacted>` for internal references. |
| **Generic PII — phone** | Phone numbers in any format | REDACT | Suggest replacement with `<phone-redacted>` |
| **Generic PII — physical address** | Street addresses, ZIP codes tied to a person | REDACT | Same |
| **Credentials in plain text** | API keys, tokens, passwords, JKS/PFX passphrases | BLOCK | Hard governance violation — escalate per `?gov` (security, immediate). |
| **OCC / Hybris credentials** | OAuth secrets, hybris admin passwords, system token values | BLOCK | Hard stop per CLAUDE.md — irrotatable secret paths. Never log even partial. |
| **Names without clinical context** | "John Smith" appearing in a generic test fixture | FLAG | Warn — recommend fictional names. Continue if user explicitly confirms it's safe. |
| **Internal-only product names pre-launch** | Code names for unreleased products | FLAG | Recommend confirming with the product owner that the name is shareable. |

## Detection patterns

These are heuristics — they have false positives. The skill output must always recommend a human review, not auto-block silently. (Auto-block silently == ruflo's pattern; we explicitly reject that.)

### High-confidence patterns

- **Credit card** — Luhn check on 13–19 digit sequences
- **SSN (US)** — `\b\d{3}-\d{2}-\d{4}\b` outside test fixtures
- **API key shapes** — base64 strings of length 32+, `Bearer`-style tokens, JWT format (`eyJ...`)
- **Email** — RFC 5322 simplified regex
- **Phone (US)** — `\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b`
- **Phone (international)** — `\+\d{1,4}[\s-]?\d{6,}`

### Medium-confidence patterns

- **MRN** — typically alphanumeric 6–10 char sequences in contexts mentioning `patient`, `chart`, `record`. Surface for human confirmation.
- **DOB** — date patterns adjacent to a person name. Surface.
- **Dental procedure codes** — CDT codes (`D####`) in contexts mentioning patient/treatment. Surface — these alone are public, but tied to a person they become PHI.

### Context signals (raise confidence)

If any of these terms appear in the same file / line as a name-like token, treat with higher sensitivity:
- `patient`, `chart`, `clinical`, `diagnosis`, `procedure`, `treatment`, `prescription`, `lab result`, `adverse event`, `complaint`, `MDR`, `FDA report`

## Step 1 — Receive input

The skill takes one of:
- A file path: `/phi-guard <path>`
- A text blob (pasted into chat)
- A git diff: `/phi-guard --diff <source-branch> <target-branch>`

## Step 2 — Run detection

Apply the patterns above. Track each finding with:
- Line / position in input
- Category from the policy table
- Tier (BLOCK / REDACT / FLAG)
- Confidence (HIGH / MEDIUM)
- Snippet (first 20 chars + last 20 chars, with the middle redacted — never log the full match)

## Step 3 — Decide overall action

| Findings | Overall action |
|----------|----------------|
| Any BLOCK | OVERALL BLOCK — emit Escalation Alert, refuse to continue |
| No BLOCK, any REDACT | OVERALL REDACT — list each finding with suggested replacement |
| Only FLAG | OVERALL FLAG — list findings, ask user to confirm intent |
| Nothing found | OVERALL CLEAR — proceed |

## Step 4 — Output

```
=== PHI/PII Scan ===
Input: <file path | diff | text>
Lines scanned: N

Findings:
  Line <N>: [<tier>] [<confidence>] <category>
    Snippet: <first 20 chars>...<last 20 chars>
    Suggested action: <BLOCK | REDACT to X | confirm intent>

Overall: <CLEAR | FLAG | REDACT | BLOCK>

Action:
  <next steps based on overall>
```

## Step 5 — On overall BLOCK, emit Escalation Alert

```
ESCALATION REQUIRED -- STOP WORK
Reason:  PHI/PII detected at <tier> level — <category>
Area:    <file:line or input source>
Contact: area owner per `?gov` / the Titan session header (security/data) — IMMEDIATE
Action:  Stop > Do NOT commit/save the input as-is > Redact at source > 
         Re-run /phi-guard to confirm clear before proceeding > Record
         confirmation in PR or change log if relevant
```

## Governance principles (project-specific)

1. **No auto-redaction without user confirmation.** The skill suggests redactions; the user applies them. Auto-redaction risks hiding a real-data leak instead of removing it.
2. **No silent telemetry.** Findings are reported to the user only. NEVER sent to an external service. This is the explicit rejection of the ruflo aidefence pattern of cloud-based scanning.
3. **No PHI leaves the scan boundary.** The skill must NOT include matched PHI in error messages, logs, or its own output. Use snippet redaction (first 20 + last 20 chars with `...` in middle).
4. **Medical-device context is the default.** Generic PII tools are calibrated for fintech/e-commerce. This project's calibration treats clinical context as the highest tier.
5. **G3 from CLAUDE.md is the source of truth.** This skill is a check, not a substitute, for G3 in `/dev-mode`.

## What this skill does NOT do

- Does NOT auto-fix code (out of scope — risky)
- Does NOT scan production data sources (out of scope — Privacy team owns that)
- Does NOT scan binary files (DICOM, XML/JPG dental imaging) — files in `**/imaging/**`, `**/scans/**` should be hard-blocked from commit at the .gitignore level instead
- Does NOT replace the organization's Privacy / Compliance review — it is a developer-side safety net

## Permissions

Allowed: Read input text/files, run regex matching, write redacted snippets to skill output.
Blocked: Writing redacted content back to files (user does that), sending findings to external services, auto-quarantining files.

## When to escalate beyond this skill

- If the same file repeatedly triggers BLOCK findings: there's a data pipeline issue. Escalate per `?gov` to investigate the source.
- If a commit history (`git log -p`) contains PHI: that is a real incident. STOP. Escalate immediately per `?gov` / the Titan session header — do NOT amend or force-push to "fix" (that creates an incident response problem, not a fix). Compliance owns the response.
