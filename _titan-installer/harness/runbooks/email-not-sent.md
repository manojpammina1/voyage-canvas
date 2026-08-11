# Runbook -- Email Confirmation Never Sent

**Symptoms:** "Order placed but no confirmation email", "password reset email never arrived", "shipping notification missing".

**Severity:** P1 if order confirmation missing (customer can't tell if order succeeded). P2 for shipping / marketing. P3 for nice-to-have notifications.

## Step 1 -- Collect (no PHI)

- Order ID last 4 (for order emails)
- Email type (order confirmation / shipping / password reset / promo)
- Approximate UTC time
- Customer's email domain only (e.g. `@gmail.com`, `@outlook.com`) -- NEVER full email

## Step 2 -- Confirm the order / event actually succeeded

Before chasing email, verify the upstream event:

| Email type | Upstream event to confirm |
|---|---|
| Order confirmation | Order placed in Hybris (`order.log`) |
| Shipping notification | Shipment created (carrier integration log) |
| Password reset | Reset request reached AEM (auth log) |
| Promo / marketing | Marketing campaign trigger fired |

If the upstream event DID NOT happen, this is not an email problem. Route to the upstream cause.

## Step 3 -- Trace the email pipeline

Email pipeline typically: Hybris OCC -> Adobe I/O Runtime action `send-email` -> email service provider (e.g. Adobe Campaign, SendGrid -- confirm with the commerce owner which is current).

| Layer | Where | Look for |
|---|---|---|
| 1. Hybris trigger | `Ecommerce/hybris/log/email.log` or `order.log` | Hybris attempted to send the email |
| 2. Adobe I/O action invocation | `aio rt activation list --action send-email --limit 20` | Action was invoked, exit code 0, no errors |
| 3. Adobe I/O action logs | `aio rt activation logs <id>` | Action logic ran, email payload built correctly |
| 4. Email service provider | Provider console (web UI, no Claude tool) | Delivery status: sent / queued / bounced / rejected |
| 5. Receiving mailbox | Customer's spam folder | Common cause -- check before assuming pipeline failure |

## Step 4 -- Common causes (ranked by frequency)

| # | Cause | How to confirm | Recommended action |
|---|---|---|---|
| 1 | In customer's spam folder | Customer paste of inbox + spam search | ESCALATE TO customer support: advise customer to check spam |
| 2 | Email provider marked the org's email domain as suspicious | Provider console shows reputation drop / blocked recipient | ESCALATE TO the commerce owner + Email Ops: provider reputation issue |
| 3 | Bounce — invalid email address | Provider shows hard bounce | ESCALATE TO customer support: customer fix email on file |
| 4 | Adobe I/O action timeout / cold start | Activation log shows `timeout` or `error` | ESCALATE TO the commerce owner: investigate cold-start mitigation |
| 5 | Hybris event never fired | `email.log` has no entry for the order | ESCALATE TO the commerce owner: order pipeline event bug |
| 6 | Template render error | Adobe I/O log shows template substitution failure | ESCALATE TO the commerce owner: template missing variable / new field |
| 7 | Email service provider outage | Provider status page | ESCALATE TO the commerce owner: confirm provider incident, communicate ETA |
| 8 | Rate-limit / throttling | Provider returned 429 / quota exceeded | ESCALATE TO the commerce owner + Email Ops |

## Step 5 -- ADO ticket draft template

```
Title: [P?] Email not sent -- <email type> for <event>

Customer impact: <count of reports, time window>
Severity:        P1 / P2 / P3
Layer:           <Hybris / Adobe I/O action / provider / mailbox>
Confidence:      <%>

Symptom:
  - Email type: <order confirmation / shipping / reset / promo>
  - Customer domain: <@example.com>
  - Time of event: <UTC>

Upstream event:
  - <confirmed / not confirmed>
  - Hybris log line: <redacted excerpt>

Reproducer (in stage):
  1. Trigger the upstream event with test customer
  2. Confirm Hybris attempts send (`email.log`)
  3. Check Adobe I/O activation log
  4. Check provider delivery status

Evidence:
  - Hybris email.log: <excerpt>
  - aio rt activation <id>: <result>
  - Provider status: <sent / queued / bounced>

Suggested next step:
  ESCALATE TO <owner> for <reason>

Approval needed:
  <none for investigation; the commerce owner for fix>
```

## Hard stop reminders

- Full customer email address is PHI -- display domain only (`@gmail.com`)
- Email service provider API keys live in approved env vars -- never paste a key
- Order confirmation missing = high customer-anxiety event. Acknowledge urgency in escalation
- Adobe I/O action source lives in CIF Integration Layer / Migration -- code changes need the commerce owner
