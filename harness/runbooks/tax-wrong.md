# Runbook -- Tax Wrong (Sales Tax / VAT)

**Symptoms:** "Tax wrong by state X", "VAT not applied for EU customer", "tax-exempt customer charged tax", "tax displayed at PDP differs from cart total".

**Severity:** P0 if a whole jurisdiction is wrong (regulatory risk). P1 if a customer segment. P2 if isolated.

## Step 1 -- Collect (no PHI)

- Customer billing state / country
- Product SKU(s) in the cart
- Expected tax amount (from customer or tax matrix)
- Observed tax amount
- Customer type (guest / B2B / tax-exempt registered)
- Order ID (last 4 only)

## Step 2 -- Determine the tax authority chain

Tax computation flows:

1. Cart -> Hybris OCC -> Hybris tax service
2. Tax service consults: jurisdiction map + product tax class + customer exemption
3. Returns line-item tax + total tax
4. Storefront displays

| Layer | Where | Look for |
|---|---|---|
| 1. Storefront cart | Browser DevTools network | GraphQL cart query: `tax`, `taxRate`, `jurisdiction` |
| 2. CIF resolver | Adobe I/O activation logs (cart resolver) | Resolver invokes tax service correctly |
| 3. Hybris tax service | `Ecommerce/hybris/log/tax.log` (read-only) | Jurisdiction lookup, exemption check, line-item rate application |
| 4. Tax config | `Ecommerce/hybris/config/*` -- FILE-LEVEL HARD STOP, never read directly | Path-only reference |
| 5. Third-party tax engine (if integrated) | Tax engine console (no Claude tool) | Engine response |

## Step 3 -- Common causes (ranked by severity)

| # | Cause | Severity | How to confirm | Recommended action |
|---|---|---|---|---|
| 1 | Tax rate stale for jurisdiction (recent law change) | P0 -- regulatory | Compare tax service output to current jurisdiction rate | ESCALATE TO the commerce owner + Tax/Finance: rate update. **Notify Finance immediately on every P0.** |
| 2 | Product mapped to wrong tax class | P1 | Tax service log shows wrong class for the SKU | ESCALATE TO the commerce owner + PIM team: product tax class correction |
| 3 | Tax-exempt customer not honoured | P1 -- compliance | Customer has exemption certificate, service ignored | ESCALATE TO the commerce owner + Sales Ops: customer exemption record |
| 4 | Wrong jurisdiction (state vs ZIP mismatch) | P1 | Billing address state != ZIP code state | ESCALATE TO the architecture owner (frontend) + the commerce owner: address validation gap |
| 5 | VAT calculated as US sales tax (or vice versa) | P0 -- whole market wrong | Customer in EU sees no VAT line / US customer sees VAT | ESCALATE TO the commerce owner: market routing bug -- HOLD checkout until fixed |
| 6 | Display rounding inconsistency | P3 | Tax service returns correct, display rounds wrong | ESCALATE TO the architecture owner (frontend) |
| 7 | Promo / discount applied AFTER tax (should be before) | P1 | Tax computed on pre-discount total | ESCALATE TO the commerce owner: tax-on-discounted-base config |

## Step 4 -- ADO ticket draft template

```
Title: [P?] Tax wrong for <state/country> -- <customer type>

Customer impact: <count of reports, jurisdiction>
Severity:        P0 / P1 / P2 / P3
Layer:           <tax service / config / customer exemption / display>
Confidence:      <%>

Symptom:
  - Billing jurisdiction: <state/country>
  - Customer type: <guest / B2B / tax-exempt>
  - Expected tax: <amount> at <rate>%
  - Observed tax: <amount> at <rate>%

Reproducer (in stage):
  1. Set test customer billing address to <jurisdiction>
  2. Add SKU <id> to cart
  3. Observe tax line

Evidence:
  - Hybris tax.log: <line excerpts, redacted>
  - Tax service response: <fields>
  - Jurisdiction rate per <Tax Authority / matrix>: <rate>

Suggested next step:
  ESCALATE TO <the commerce owner / Tax/Finance> for <reason>

Approval needed:
  - P0 regulatory: Tech Lead + Finance + the commerce owner
  - Hot fix: Tech Lead + the AEM owner (deploy)
```

## Hard stop reminders

- Tax config files live in `Ecommerce/hybris/config/` -- file-level hard stop, NEVER read
- P0 tax issues have regulatory + audit exposure -- notify Finance immediately, do not delay
- Tax-exempt customer data may include certificate ID -- redact in any displayed evidence
- If the bug under-collects tax: PRIORITY higher than over-collection (cannot retroactively refund all customers; can credit the over-collected case)
