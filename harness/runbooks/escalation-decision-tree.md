# Runbook: Escalation Decision Tree

Use when you receive an incident or customer ticket and need to know **who to contact** and how fast.

## Step 1 — Classify the symptom area

Match the symptom to the correct area using the table below. Pick the FIRST match.

| Symptom | Area | Primary contact | Backup |
|---------|------|----------------|--------|
| Cart add, cart update, cart display errors | React/Redux frontend | the architecture owner (`?gov who owns architecture`) | — |
| Checkout flow errors (address, payment, order placement) | CIF / Hybris OCC | the commerce/CIF owner (`?gov who owns commerce`) | the architecture owner (`?gov who owns architecture`) |
| Payment declined, CyberSource error | Hybris payment | the commerce/CIF owner (`?gov who owns commerce`) | the security team (`?gov who owns security`) |
| Login / logout / session expiry | CIF auth / OCC session | the commerce/CIF owner (`?gov who owns commerce`) | the architecture owner (`?gov who owns architecture`) |
| My Account (profile, orders, invoices, addresses) | CIF / OCC | the commerce/CIF owner (`?gov who owns commerce`) | the architecture owner (`?gov who owns architecture`) |
| Product detail page (PDP) missing or 404 | PIM / AEM | PIM team | the AEM/pipeline owner (`?gov who owns aem`) |
| Product price wrong or missing | Hybris pricing / PIM | the commerce/CIF owner (`?gov who owns commerce`) | PIM team |
| Search results missing or wrong | Coveo / Discover | Search team | the architecture owner (`?gov who owns architecture`) |
| AEM page 500 or blank | AEM / OSGi | the AEM/pipeline owner (`?gov who owns aem`) | — |
| AEM author not loading | AEM Cloud Manager | the AEM/pipeline owner (`?gov who owns aem`) | Cloud Manager admin |
| Pipeline / CI failure | AEM CI/CD | the AEM/pipeline owner (`?gov who owns aem`) | — |
| Adobe I/O Runtime action error | CIF serverless | the commerce/CIF owner (`?gov who owns commerce`) | the architecture owner (`?gov who owns architecture`) |
| Telemetry / analytics not updating | Titan toolkit | the architecture owner (`?gov who owns architecture`) | — |
| Suspected credential or data exposure | Security / compliance | the architecture owner (`?gov who owns architecture`) (immediate) | the commerce/CIF owner (`?gov who owns commerce`) |
| Any PHI / patient data suspected in logs | Privacy / compliance | the architecture owner (`?gov who owns architecture`) (immediate) | Legal |

## Step 2 — Determine priority

| Criteria | Priority |
|----------|----------|
| Production down for all users / checkout completely broken | **P0** |
| Production degraded for >10% of users / checkout intermittent | **P1** |
| Single customer affected / non-critical feature broken | **P2** |
| Cosmetic issue, typo, minor UX defect | **P3** |

## Step 3 — SLA obligations

| Priority | Respond by | Contain by | Resolve by |
|----------|-----------|-----------|-----------|
| P0 | 15 minutes | 2 hours | 8 hours |
| P1 | 1 hour | Next business day | Next sprint |
| P2 | 4 hours | This sprint | This sprint |
| P3 | Next business day | Backlog | Backlog |

## Step 4 — Contact method

| Priority | How to reach |
|----------|-------------|
| P0 | Phone + Teams message + ADO ticket (all three) |
| P1 | Teams message + ADO ticket |
| P2 | ADO ticket only |
| P3 | ADO backlog item only |

**the architecture owner (`?gov who owns architecture`):** Contact info in `titan.config.json` `contacts.people` — resolve with `?gov who owns architecture`
**the AEM/pipeline owner (`?gov who owns aem`):** resolve with `?gov who owns aem`
**the commerce/CIF owner (`?gov who owns commerce`):** resolve with `?gov who owns commerce`
**PIM team:** Contact via the org's PIM project board (`?gov who owns pim`)
**Search team:** Contact via the org's search platform board (`?gov who owns search`)

## Step 5 — Draft the escalation message

```
Priority: P[0/1/2]
Symptom: [one sentence, no PII, no technical jargon]
Impact: [estimated number of users affected]
Environment: [stage / production]
ADO ticket: [number]
Steps to reproduce: [brief, no sensitive data]
What's been tried: [any workarounds attempted]
```

Send this to the primary contact. Do not include error codes, stack traces, internal server names, or customer PII/PHI in the escalation message.

## Escalation hard stops

If symptom involves any of the following: STOP triage, contact the architecture owner (`?gov who owns architecture`) immediately, do not investigate further:
- Any suspected exposure of `hybris/config/` credentials
- Any log output containing what appears to be a CyberSource key, SAML keystore, or GlobalLink API key
- Any customer data (orders, addresses, payment info) appearing in publicly accessible logs or URLs
