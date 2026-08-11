# Runbook -- SAML / SSO Login Fails

**Symptoms:** "Login bounces back to the login page", "SSO loop -- can't get into site", "Can authenticate to corporate IdP but the site rejects me".

**Severity:** P0 if all SSO users blocked. P1 if a single user group. P2 if isolated.

## Step 1 -- Collect (no PHI)

- Customer email domain only (`@example.com`) -- never full email
- IdP they auth against (Okta / AAD / corporate IdP)
- Approximate UTC time
- Customer type (DSO admin / sales rep / internal user)
- Browser + clean cookies attempted?

## Step 2 -- HARD STOP -- JKS file rule

`Ecommerce/hybris/config/azure/saml/**/*.jks` files are SAML signing keystores. They are **irrotatable** per CLAUDE.md. **NEVER read, display, or modify these files.** Any exposure is a permanent security incident.

For triage, reference the file path only (e.g. `azure/saml/prod.jks`). Never `cat`, `head`, `grep`, or `Read` the file.

## Step 3 -- Confirm the IdP succeeded first

SSO is two parties: customer's IdP and the SP. Confirm IdP side BEFORE blaming our side:

| Check | Where | Look for |
|---|---|---|
| IdP assertion was issued | IdP audit log (customer's IT, no Claude tool) | Successful authn event for the user |
| Assertion reached our side | AEM SAML provider log | Inbound SAMLResponse received |

If the IdP didn't issue an assertion: not our problem. Customer's IT must investigate.

## Step 4 -- Read the SP logs

| Layer | Where | Look for |
|---|---|---|
| 1. AEM SAML provider log | AEM Cloud Manager logs (filter on `saml`, `sso`, `auth`) | Assertion validation result |
| 2. Hybris SAML config | commerce-platform repo `hybris/config/saml-*.xml` -- HARD STOP, path reference only | (do not read) |
| 3. AEM dispatcher | `/var/log/dispatcher/` | Redirect chain after callback |

## Step 5 -- Common causes (ranked by frequency)

| # | Cause | How to confirm | Recommended action |
|---|---|---|---|
| 1 | SAML clock skew (IdP vs server time off by > 5 min) | AEM SAML log shows `assertion expired` or `not yet valid` | ESCALATE TO the AEM owner: NTP sync investigation |
| 2 | Certificate / signature mismatch | Log shows `signature validation failed` or `unknown signing certificate` | ESCALATE TO the commerce owner + the architecture owner: IdP rotated cert without our update. **JKS is irrotatable on our side** -- coordinate with IdP team. |
| 3 | Audience / entityID mismatch | Log shows `audience restriction failed` | ESCALATE TO the commerce owner: SP entityID config drift |
| 4 | User has no account provisioned | IdP succeeded, AEM has no matching user | ESCALATE TO Sales Ops / Customer Success: account provisioning |
| 5 | Wrong group assertion claims | User in IdP group X, our side expects group Y | ESCALATE TO the commerce owner + Customer's IdP admin: claim mapping |
| 6 | RelayState loop bug | Browser shows infinite redirect | ESCALATE TO the architecture owner + the AEM owner: redirect chain investigation |
| 7 | AEM dispatcher caching auth response | Same user gets stale session | ESCALATE TO the AEM owner: dispatcher rule for SAML callback paths |

## Step 6 -- ADO ticket draft template

```
Title: [P?] SAML SSO failing for <user group / customer>

Customer impact: <count of reports, group affected>
Severity:        P0 / P1 / P2
Layer:           <IdP / clock / cert / config / provisioning / redirect>
Confidence:      <%>

Symptom:
  - User domain: <@example.com>
  - IdP: <Okta / AAD / other>
  - Browser: <browser>
  - Time of attempt: <UTC>

IdP side:
  - <confirmed assertion issued / not confirmed>

the SP side:
  - AEM SAML log: <validation result, no JKS contents>
  - Dispatcher log: <redirect chain>

Reproducer (in stage with test SSO user):
  1. Visit <storefront SSO login URL>
  2. Auth at IdP
  3. <observe failure point>

Suggested next step:
  ESCALATE TO <owner> for <reason>

Approval needed:
  - Cert / config change: the commerce owner + the architecture owner
  - JKS rotation: NOT POSSIBLE -- irrotatable per CLAUDE.md. Coordinate with IdP for IdP-side change.
```

## Hard stop reminders

- `azure/saml/**/*.jks` files are **irrotatable**. NEVER read. NEVER display. NEVER modify. Any exposure is a permanent security incident -- escalate to the commerce owner + the architecture owner immediately.
- SAML assertions contain PII (email, name, claims) -- redact every assertion excerpt in displayed evidence
- DO NOT propose "rotate the cert" as a fix on our side -- the JKS is irrotatable. Fix must happen on the IdP side or via config that does not touch the JKS file
