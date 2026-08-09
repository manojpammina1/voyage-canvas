# Runbook -- Translation Missing (Non-EN Locale Shows English Fallback)

**Symptoms:** "German site shows English text", "checkout error message in EN on FR site", "product spec table not translated".

**Severity:** P1 if site-wide for a market. P2 if one page family. P3 if isolated keys.

## Step 1 -- Collect

- Locale showing English fallback (de-DE, fr-FR, ja-JP, etc.)
- Page URL or component
- Approximate key (e.g. "Add to cart" button, error message text)
- Time observed (helps date GlobalLink imports)

## Step 2 -- Localise the source

The org has multiple translation pipelines:

| Locale source | Where | Owner |
|---|---|---|
| Hybris i18n root | `Ecommerce/cq-webapp/the relevant migration-repo module/src/main/resources/i18n-root/<locale>.json` | the commerce owner + Localisation |
| AEM clientlib locale | `the AEM webapp repo/.../i18n` (per clientlib) | the AEM owner |
| DT Ecommerce module locale | `*-ui.frontend/i18n/` or `locales/` | the architecture owner (per module) |
| GlobalLink (translation workflow) | GlobalLink web console (no Claude tool) | the commerce owner + Localisation |
| PIM locale variants (product copy) | PIM UI | PIM team + Localisation |

## Step 3 -- Run `/common/i18n-check` on the relevant directory

This skill audits locale parity. Most translation-missing issues surface as:

- Missing key in the non-EN locale file
- Identical value in EN and non-EN (placeholder copy/paste, never translated)
- Interpolation drift (`{name}` in EN, `{0}` in non-EN)
- GlobalLink export drift (key added to EN but never exported)

Invoke:
```
/common/i18n-check <path-to-locale-directory>
```

The output identifies which keys are missing or untranslated.

## Step 4 -- Common causes (ranked by frequency)

| # | Cause | How to confirm | Recommended action |
|---|---|---|---|
| 1 | Key recently added to `en.json`, GlobalLink export not yet run | `/common/i18n-check` flags GlobalLink drift | ESCALATE TO the commerce owner + Localisation: trigger GlobalLink export |
| 2 | Translation done in GlobalLink but not re-imported to repo | GlobalLink console shows "translated" but repo missing the value | ESCALATE TO the commerce owner + Localisation: re-import translated bundle |
| 3 | Locale file has parse error (single broken JSON) | `/common/i18n-check` flags parse error | ESCALATE TO whoever last touched the file (`git log -- <file>`) |
| 4 | Product copy not translated in PIM | EN product copy present, non-EN missing | ESCALATE TO PIM team + Localisation: populate locale variant |
| 5 | Locale not yet supported (e.g. new market launch incomplete) | Reporter on locale with < full key coverage by design | ESCALATE TO Localisation: confirm launch status; not necessarily a bug |
| 6 | Cache serving stale locale bundle | Recent translation update, frontend stale | ESCALATE TO the AEM owner: dispatcher cache invalidation for locale paths |
| 7 | Clientlib not including the locale category | AEM clientlib `categories` array missing the locale clientlib | ESCALATE TO the AEM owner: clientlib registration |
| 8 | Interpolation drift (placeholder mismatch) | EN has `{name}`, locale has different format | ESCALATE TO the commerce owner + Localisation: GlobalLink format alignment |

## Step 5 -- ADO ticket draft template

```
Title: [P?] Translation missing -- <locale> shows English fallback

Customer impact: <market, count of reports>
Severity:        P1 / P2 / P3
Layer:           <Hybris i18n / AEM clientlib / DT module / PIM / GlobalLink>
Confidence:      <%>

Symptom:
  - Locale: <de-DE / fr-FR / etc.>
  - Page / component: <URL or component>
  - Affected text: <key or visible string>

i18n-check result:
  - <missing key / untranslated / parse error / GlobalLink drift>

Reproducer:
  1. Visit <URL> with locale <code>
  2. Observe <English fallback>

Evidence:
  - `/common/i18n-check` output (relevant excerpt)
  - GlobalLink export status: <date if visible>

Suggested next step:
  ESCALATE TO <owner> for <reason>

Approval needed:
  <none for investigation; the commerce owner + Localisation for GlobalLink action>
```

## Hard stop reminders

- `Ecommerce/hybris/config/globalLink*.properties` / `*.xml` are GlobalLink config files -- **file-level hard stop per CLAUDE.md**. NEVER read or modify.
- NEVER paste machine-translated strings (Google Translate / DeepL) into locale files. Translation MUST route through GlobalLink for review and brand consistency.
- Translation key renames break in-flight GlobalLink jobs -- coordinate with Localisation before any key rename
- A missing translation is a customer-facing brand issue. Acknowledge in escalation; not just a "cosmetic" P3
