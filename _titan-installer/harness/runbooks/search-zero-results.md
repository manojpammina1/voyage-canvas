# Runbook -- Search Returns 0 Results for Known Product

**Symptoms:** "Search for product X returns nothing but I know it exists", "category filter shows 0 results", "search broken in market X".

**Severity:** P1 if site-wide. P2 if one product / one category. P3 if one query string only.

## Step 1 -- Collect from the customer / reporter

- Exact search query (no PHI risk for a product name)
- Market / locale (en-US, de-DE, etc.)
- Product SKU if known
- Was the product visible last week? (helps date the regression)

## Step 2 -- Verify the product EXISTS in PIM

Source of truth: PIM. If the product is missing from PIM, search can't return it.

| Check | How |
|---|---|
| Product exists in PIM | Ask the user to verify in PIM UI (no Claude tool for PIM) |
| Product has search fields populated | Title, category, description must be present |
| Product has the correct locale variant | If reporter is on de-DE, German fields must be populated |

If PIM is missing data: ESCALATE TO PIM team -- not a Search bug.

## Step 3 -- Verify Coveo / Discover index state

| Check | Owner | How |
|---|---|---|
| Coveo index includes the SKU | Search team | Coveo admin console -- search by SKU directly |
| Discover field mapping is current | Search team + the architecture owner | Discover admin -- inspect query rules + field mappings |
| Last successful crawl | Search team | Coveo admin -> Sources -> last successful update timestamp |

If the index does NOT contain the SKU but PIM does: stale index. ESCALATE TO Search team for re-crawl.

## Step 4 -- Verify the storefront query path

| Layer | Where | Look for |
|---|---|---|
| 1. Storefront network panel | Browser DevTools | Network call to Coveo / Discover endpoint -- HTTP 200 with `totalCount: 0` |
| 2. DT search component | `the storefront/ecommerce repo/.../coveo-*` or `discover-*` | Field mapping mismatch -- query field name vs index field name |
| 3. Storefront filter state | Same | Filter applied that excludes everything (e.g. price range, in-stock) |

If query returns 200 with 0 results but the SKU IS in the index: query construction bug. ESCALATE TO the architecture owner (frontend) + Search team.

## Step 5 -- Common causes (ranked by frequency)

| # | Cause | How to confirm | Recommended action |
|---|---|---|---|
| 1 | Stale Coveo / Discover index | Index timestamp older than last PIM update | ESCALATE TO Search team: trigger re-crawl |
| 2 | Filter combination excludes the product | Network panel: query has restrictive filters | ESCALATE TO the architecture owner (frontend): UX defect or expected behaviour |
| 3 | Wrong locale variant | Reporter on de-DE but field only populated in en-US | ESCALATE TO PIM team + Localisation: populate locale fields |
| 4 | Field mapping drift between PIM and search | Coveo / Discover field name doesn't match PIM | ESCALATE TO Search team + the architecture owner: contract drift, register fix |
| 5 | Product unpublished or out-of-stock filter | PIM status flag | ESCALATE TO PIM team if unintended; otherwise expected |
| 6 | Coveo source disabled / suspended | Coveo admin shows source status | ESCALATE TO Search team: re-enable source |

## Step 6 -- ADO ticket draft template

```
Title: [P?] Search returns 0 results for <product or query> in <market>

Customer impact: <count of reports>
Severity:        P1 / P2 / P3
Layer:           <PIM / index / storefront / filter>
Confidence:      <%>

Symptom:
  - Query "<term>" in <market> returns 0 results
  - Product SKU <id> exists in PIM (confirmed by <user>)

Reproducer (in stage):
  1. Open <storefront URL> in <locale>
  2. Search for <term>
  3. Observe 0 results
  4. Inspect network call to <Coveo / Discover endpoint>

Evidence:
  - PIM: product present, last updated <date>
  - Coveo index: last crawl <date>
  - Network: totalCount = 0

Suggested next step:
  ESCALATE TO <Search team / the architecture owner / PIM team> for <reason>

Approval needed:
  <Search team lead for re-index>
```

## Hard stop reminders

- Search index credentials / Coveo API keys live in approved env vars only -- never paste a key into a ticket
- Cross-repo contract: Coveo / Discover field mappings are owned by Search team + the architecture owner (CLAUDE.md contract registry)
- If the issue is product-level data (PIM), it's NOT a Search bug -- route to PIM team first
