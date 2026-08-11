# Titan Runbook Library

Triage flows for the top recurring production issues in the AEM ecommerce platform.

Each runbook is a focused, step-by-step triage flow that production support (`/prodsupport-mode`) uses to localise the cause, gather evidence, and draft an ADO ticket for the dev team.

## How to use

From within `/prodsupport-mode`, invoke a runbook by referencing its path. Claude reads the runbook and walks the user through the steps.

Example:
```
Customer reports order didn't go through.
Open: harness/runbooks/order-not-completed.md
```

## Runbook index

| File | Trigger phrase / category |
|---|---|
| `order-not-completed.md` | Order didn't go through, payment declined |
| `search-zero-results.md` | Search returns nothing for known product |
| `configurator-wrong.md` | Configurator showing wrong shade / size / spec |
| `price-wrong.md` | Price displayed wrong, discount not applied |
| `tax-wrong.md` | Tax wrong by state / VAT wrong by country |
| `email-not-sent.md` | Order confirmation / shipping / reset email missing |
| `saml-login-fails.md` | SSO bounces back, login loop |
| `slow-page-load.md` | Page TTFB > 3s, intermittent slowness |
| `translation-missing.md` | Non-EN locale showing English fallback |
| `image-broken.md` | Product image broken / 404 |

## Adding a new runbook

1. Identify the recurring incident category (5+ similar tickets in a quarter)
2. Author a new `<category>.md` following the existing template:
   - Symptoms (verbatim customer phrasing)
   - Severity matrix
   - Collect (what to ask customer, no PHI)
   - Localise the source (which layer)
   - Read evidence (where to look)
   - Common causes (ranked, with owner)
   - ADO ticket draft template
   - Hard stop reminders
3. Add the entry to this README index
4. Update `harness/commands/roles/prodsupport-mode.md` runbook table

Runbooks are governance files -- changes go through `super` role (the architecture owner (`?gov who owns architecture`)).

## Hard stop conventions across all runbooks

Every runbook MUST honour:

- **Hybris irrotatable secrets** — never read `Ecommerce/hybris/config/*.properties`, `*.p12`, `*.jks`, `globalLink*`. Path reference only.
- **PHI / PII redaction** — display customer email as `<email-redacted>` or domain only; full names, addresses, phones, card PANs, IPs all redacted per `/prodsupport-mode` G-PS3.
- **No direct action** — every "Recommended action" line carries an `ESCALATE TO <owner>` tag. Production support hands off; the role does not execute fixes.

## Cross-reference

| Role / skill | When to invoke |
|---|---|
| `/roles/prodsupport-mode` | Primary consumer of these runbooks |
| `/ops/incident-response` | P0/P1 escalation when prodsupport runbook surfaces an outage |
| `/roles/sre-mode` | When runbook escalates to deploy / rollback / cache invalidation |
| `/common/i18n-check` | Used by `translation-missing.md` runbook |
