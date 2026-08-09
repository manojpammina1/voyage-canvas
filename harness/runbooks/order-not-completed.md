# Runbook -- Order Not Completed / Payment Declined

**Symptoms:** "I tried to check out and got an error", "payment declined but my card works elsewhere", "order says pending but never confirmed".

**Severity:** P1 if multiple customers report within 30 min. P2-P3 if isolated.

## Step 1 -- Collect from the customer (no PHI in output)

Ask for:
- Last 4 digits of the order ID
- Browser / device
- Approximate UTC time of the attempt
- Payment method type (Visa / MC / AmEx / PayPal / Apple Pay)
- Error message they saw (exact text — they paste, you redact PHI before display)

## Step 2 -- Reproduce in stage with a test card

Test PANs (CyberSource sandbox -- already in approved fixture list):
- Success: `4111 1111 1111 1111`
- Decline (insufficient funds): `4000 0000 0000 0002`
- 3DS required: `4000 0000 0000 3220`

Never use a real customer PAN. Refuse if pasted.

## Step 3 -- Read logs in order

| Layer | Where | Look for |
|---|---|---|
| 1. Storefront (DT) console | Browser DevTools network panel | Failed GraphQL call to `/cart/place-order` -- HTTP code |
| 2. CIF GraphQL resolver | Adobe I/O activation logs: `aio rt activation logs <id>` (filter on placeOrder) | Resolver-level exception, OCC client timeout, GraphQL field null |
| 3. Hybris OCC | `Ecommerce/hybris/log/access.log` + `payments.log` | OCC request/response, payment processor response code |
| 4. CyberSource | CyberSource Decision Manager / Business Center (web UI, no Claude tool) | Transaction status, decline reason code |

Stop at the first layer that shows a definitive error. Do not keep digging.

## Step 4 -- Common causes (ranked by frequency)

| # | Cause | How to confirm | Recommended action |
|---|---|---|---|
| 1 | Card issuer declined (insufficient funds, fraud rule, expired) | CyberSource decline code 200/201/231/481 | ESCALATE TO customer support: ask customer to use a different card. No code fix. |
| 2 | 3DS challenge failed | CyberSource code 475/476 | ESCALATE TO customer support: walk customer through 3DS re-attempt |
| 3 | OCC timeout | `payments.log` shows `Connection timed out` to OCC | ESCALATE TO the commerce owner (Hybris/CIF): investigate OCC latency. May be capacity issue |
| 4 | CIF resolver bug (null field, schema mismatch) | Adobe I/O log shows resolver exception | ESCALATE TO the commerce owner: hot fix on CIF Integration Layer |
| 5 | Storefront state desync (cart total mismatch) | Network panel shows 400 from `place-order` with "cart-total-mismatch" | ESCALATE TO the architecture owner (frontend): cart saga state bug |
| 6 | CyberSource certificate expiry | `payments.log` shows TLS handshake failure | ESCALATE TO the commerce owner (Hybris/CIF): irrotatable cert per CLAUDE.md -- PERMANENT issue, contact CyberSource |

## Step 5 -- ADO ticket draft template

```
Title: [P?] Order placement failing -- <one-line summary, no PHI>

Customer impact: <count of reports, time window>
Severity:        P1 / P2 / P3
Layer:           <storefront / CIF / Hybris / CyberSource>
Confidence:      <%>

Symptom:
  - <what customer sees, no PHI>

Reproducer (in stage):
  1. Open <product page URL>
  2. Add to cart, proceed to checkout
  3. Use test card 4111 1111 1111 1111
  4. <observed error>

Evidence:
  - Adobe I/O activation <id> -- <error type>
  - Hybris payments.log line <#> -- <redacted snippet>

Suggested next step:
  ESCALATE TO <owner> for <reason>

Approval needed:
  <none / Tech Lead / the AEM owner / the commerce owner>
```

## Hard stop reminders

- Never read `Ecommerce/hybris/config/*.properties` (DB passwords)
- Never read `certs/cybersource/**/*.p12` (payment certs -- irrotatable)
- Never display a real customer PAN, full email, or full name in output
- Card decline codes 200/201/231 are LEGITIMATE declines -- not a system bug. Do NOT propose a code fix.
