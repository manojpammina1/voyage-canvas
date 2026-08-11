# Runbook -- Price Displayed Wrong

**Symptoms:** "Price showing $X but should be $Y", "list price wrong", "discount not applied", "B2B contract price not honoured".

**Severity:** P1 if site-wide or affects checkout total. P2 if display-only on PDP. P3 cosmetic.

## Step 1 -- Collect

- Product SKU
- Customer type (guest / B2B / DSO admin / sales rep)
- Expected price + source (catalog, contract, promo)
- Observed price
- Market / locale + currency
- Order ID (last 4) if already in cart

## Step 2 -- Identify the price source

The org has multiple price layers — confirm which one is wrong:

| Layer | Owner | When it's the cause |
|---|---|---|
| 1. PIM list price | PIM team | Base list price wrong for everyone |
| 2. Hybris price service | the commerce/CIF owner (`?gov who owns commerce`) | Tier / volume / contract price wrong |
| 3. Promotion engine | the commerce/CIF owner (`?gov who owns commerce`) | Discount code not applied / wrong amount |
| 4. B2B contract price | the commerce/CIF owner (`?gov who owns commerce`) + Sales Ops | Customer-specific price not honoured |
| 5. Currency / FX | the commerce owner + the architecture owner | Wrong currency or wrong FX rate |
| 6. Frontend display | the architecture owner | Network shows correct price, render wrong |

## Step 3 -- Read logs in order

| Layer | Where | Look for |
|---|---|---|
| 1. Storefront network | Browser DevTools | GraphQL response: `price`, `listPrice`, `discountAmount`, `currency` |
| 2. CIF resolver | Adobe I/O `aio rt activation logs` | Resolver computes price from Hybris -- verify response |
| 3. Hybris price service | `Ecommerce/hybris/log/price.log` (read-only) | Tier evaluation, contract lookup, promo application |
| 4. PIM | PIM UI (no Claude tool) | Base list price + currency variants |

## Step 4 -- Common causes (ranked by frequency)

| # | Cause | How to confirm | Recommended action |
|---|---|---|---|
| 1 | Promotion expired but still showing | Promo end date passed but discount still applied | ESCALATE TO the commerce owner: promo config / cache invalidation |
| 2 | Wrong tier for B2B customer | Customer group misassigned in Hybris | ESCALATE TO the commerce owner + Sales Ops: customer group correction |
| 3 | Cache serving stale price after PIM update | New PIM price, frontend stale | ESCALATE TO the AEM owner: dispatcher cache invalidation |
| 4 | Currency / FX rate stale | Wrong currency or last-FX-update timestamp old | ESCALATE TO the commerce owner: FX service refresh |
| 5 | Promo timezone bug | Promo "active" in UTC but customer in PST | ESCALATE TO the commerce owner + the architecture owner: promo date timezone normalisation |
| 6 | Tax-included vs tax-excluded display | EU customer expects tax-included, sees tax-excluded | ESCALATE TO the architecture owner (frontend) + the commerce owner (Hybris): display config |
| 7 | Contract price not loaded | B2B customer missing contract assignment | ESCALATE TO the commerce owner + Sales Ops |
| 8 | Frontend rounding bug | Network value correct, display wrong | ESCALATE TO the architecture owner (frontend) |

## Step 5 -- ADO ticket draft template

```
Title: [P?] Price wrong for <SKU> in <market> -- <customer type>

Customer impact: <count of reports, customer type>
Severity:        P1 / P2 / P3
Layer:           <PIM / Hybris price service / promo / B2B / frontend>
Confidence:      <%>

Symptom:
  - SKU <id>: displayed <observed>, expected <correct>
  - Customer type: <guest / B2B / DSO>
  - Market: <code>, currency: <code>

Reproducer (in stage with test customer):
  1. Log in as test customer of type <type>
  2. View SKU <id>
  3. Observe price <observed>

Evidence:
  - PIM list price: <amount> (last updated <date>)
  - GraphQL response: <fields, redacted of any sensitive contract IDs>
  - Hybris price.log: <relevant excerpt>

Suggested next step:
  ESCALATE TO <owner> for <reason>

Approval needed:
  <none for investigation; the commerce owner for promo/contract fixes>
```

## Hard stop reminders

- `Ecommerce/hybris/config/*.properties` (price service DB connection strings) -- never read
- B2B contract IDs may identify the customer -- redact to last 4
- A promo bug that DECREASES checkout total below intended is high-severity (revenue impact) -- flag immediately
