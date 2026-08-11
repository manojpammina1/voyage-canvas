# /missing-scenarios -- Surface missing business logic and edge cases

Read the file(s) the developer indicates. Work through all relevant analysis sections below. Report findings in three buckets: **Missing**, **Risky**, **OK**.

---

## Domain -- Cart & Checkout (DT ecommerce shop modules, `shop-ui.frontend`)

- [ ] Empty cart state handled
- [ ] Cart with backordered / out-of-stock items handled
- [ ] Quantity minimum / maximum enforcement (dental supplies have order minimums)
- [ ] Price display handles null / undefined pricing from Hybris
- [ ] Currency formatting accounts for locale
- [ ] Checkout flow handles session expiry mid-flow
- [ ] Order submission failure gives user actionable feedback
- [ ] Duplicate order submission prevented (loading state + disable submit)

## Domain -- My Account (DT ecommerce my-account modules)

- [ ] Registration handles existing email gracefully
- [ ] Order history handles empty state and pagination
- [ ] Invoice download handles unavailable document (404 from Hybris)
- [ ] Address book: add / edit / delete / set-default all handled
- [ ] Password change validates current password before accepting new one
- [ ] Account locked / suspended state handled

## Domain -- Product / Configurator (DT ecommerce configurator modules)

- [ ] Product not found (404 from PIM) handled
- [ ] Product images unavailable -- fallback image shown
- [ ] Price not available for user's market / role -- handled without breaking layout
- [ ] Restricted products (require credentials or account type) -- access gated correctly
- [ ] Bundle products -- individual item availability checked, not just bundle-level

## Domain -- Search (DT ecommerce coveo/discover modules)

- [ ] Zero results state handled (helpful message, not blank page)
- [ ] Facet combinations that return zero results handled
- [ ] Search field mappings match Coveo/Discover index schema

## General React / Redux

- [ ] Loading state shown for all async operations
- [ ] Error state handled and displayed for all Redux sagas/slices/thunks
- [ ] Race condition: stale result does not overwrite new state
- [ ] Redux state reset on logout -- no stale user data in guest session
- [ ] Accessibility: new UI components have `aria-` attributes and keyboard navigation

## General AEM / HTL

- [ ] Component handles missing/null JCR properties without NullPointerException
- [ ] Dialog fields have validation
- [ ] Component is usable in both Author and Publish runmodes

---

## Output format

For each **Missing** or **Risky** item:
1. State exactly what scenario is unhandled
2. Point to the file and line number
3. Suggest the minimal fix
4. Flag if this needs a Hybris/CIF contract check or Lead Architect review

Summarize the count of Missing / Risky / OK at the top of the response.
