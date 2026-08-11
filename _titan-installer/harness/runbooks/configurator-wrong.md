# Runbook -- Configurator Shows Wrong Shade / Size / Spec

**Symptoms:** "Configurator showing wrong shade list", "size option missing for product X", "spec table doesn't match the product".

**Severity:** P1 if a whole product family is wrong. P2 if one product. P3 if cosmetic / wrong order.

## Step 1 -- Collect

- Product SKU
- Which option set is wrong (shade / size / material / quantity / etc.)
- What the customer expects vs sees
- Market / locale

## Step 2 -- Verify in PIM (source of truth)

Configurator options come from PIM. Check there FIRST:

- Open the SKU in PIM
- Verify the option set: are shades / sizes / specs populated correctly?
- Verify locale variant if reporter is non-EN

If PIM is wrong: ESCALATE TO PIM team. Not a frontend bug.

## Step 3 -- Verify the PIM-to-frontend contract

Configurator state flows: PIM -> `the migration repo/the PIM module/` Java service -> GraphQL via CIF -> `the storefront/ecommerce repo/.../configurator-ui.frontend/` React.

| Check | Where | Look for |
|---|---|---|
| PIM service response | Migration repo: `the PIM module/.../PimProductService.java` (read source for endpoint shape) | Endpoint returns expected option set |
| GraphQL contract | CIF Integration Layer schema | `Product.shades`, `Product.sizes`, etc. fields present |
| Storefront network panel | Browser DevTools | GraphQL response has the expected fields populated |
| React component | DT Ecommerce configurator | Rendering logic matches the data shape |

## Step 4 -- Common causes (ranked by frequency)

| # | Cause | How to confirm | Recommended action |
|---|---|---|---|
| 1 | PIM data outdated (recent change not synced) | PIM shows correct, frontend wrong | ESCALATE TO PIM team + the architecture owner: trigger PIM sync / cache invalidation |
| 2 | PIM has wrong values entered | PIM matches what customer sees | ESCALATE TO PIM team: data correction request |
| 3 | Cache (AEM dispatcher or CIF cache) serving stale response | New PIM value, frontend stale | ESCALATE TO the AEM owner: dispatcher cache invalidation for the product page |
| 4 | GraphQL schema field renamed/removed | Console shows GraphQL error or null field | ESCALATE TO the commerce owner + the architecture owner: contract drift fix |
| 5 | Frontend rendering bug (sort order, filter) | Network data correct, render wrong | ESCALATE TO the architecture owner (frontend): React component bug |
| 6 | Locale variant missing in PIM | EN correct, non-EN wrong | ESCALATE TO PIM team + Localisation: populate locale fields |

## Step 5 -- ADO ticket draft template

```
Title: [P?] Configurator wrong for <SKU> -- <option set>

Customer impact: <count of reports, market>
Severity:        P1 / P2 / P3
Layer:           <PIM / cache / CIF / frontend>
Confidence:      <%>

Symptom:
  - Configurator for SKU <id> shows <wrong values>
  - Expected: <correct values per PIM>

Reproducer (in stage):
  1. Open product detail page for SKU <id>
  2. Inspect configurator panel
  3. Verify GraphQL response in network panel

Evidence:
  - PIM: <correct / incorrect> -- last updated <date>
  - GraphQL response: <field names + values, redacted of any internal IDs if sensitive>
  - Frontend render: <observed>

Suggested next step:
  ESCALATE TO <PIM team / the commerce owner / the architecture owner / the AEM owner> for <reason>

Approval needed:
  <PIM team for data correction; the AEM owner for cache invalidation>
```

## Hard stop reminders

- PIM data is owned by PIM team + the architecture owner (CLAUDE.md contract registry)
- `the PIM module/` is a Migration repo Hard Stop -- code changes need PIM team + the architecture owner sign-off
- Configurator UI lives in DT Ecommerce -- changes go through normal `/dev-mode` flow
