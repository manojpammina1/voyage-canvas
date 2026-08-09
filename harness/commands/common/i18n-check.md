# /i18n-check -- Internationalisation File Integrity

Read-only audit. Detects missing keys across locale files, finds orphaned keys (translated but never referenced in code), and surfaces GlobalLink-workflow drift.

Use this skill inside any role (most often `/dev-mode` or `/designer-mode`).

## What it checks

1. **Locale parity** — every key in `en.json` exists in every other locale (`de.json`, `es.json`, `fr.json`, `it.json`, `ja.json`, etc.). Missing keys = visible English fallback in non-EN markets.
2. **JSON validity** — each locale file parses cleanly. A single trailing comma or unclosed brace breaks the whole locale at runtime.
3. **Orphaned keys** — keys translated but never referenced in code. These bloat bundles and confuse the GlobalLink translation queue.
4. **Untranslated keys** — keys where the value is identical across locales (likely a placeholder copy/paste from `en.json` that was never translated).
5. **Interpolation parity** — placeholder counts match across locales: `Hello {name}` should be `Hallo {name}` in `de.json`, not `Hallo {0}` or `Hallo`.
6. **GlobalLink drift** — flags keys added to `en.json` after the last GlobalLink export date (configurable via comment marker).

## Where i18n lives

Resolve the i18n directory per repo via `config.repos[]` / `?gov <repo> i18n` rather than a hardcoded table — locations and locale sets vary by repo and module. Typical shapes to expect:

| Repo role | i18n directory pattern | Locales present |
|---|---|---|
| Hybris/Ecommerce repo | `cq-webapp/<i18n-module>/src/main/resources/i18n-root/` | en, de, es, fr, it, ja, ko, pt, zh |
| Webapp repo | `shop-ui.frontend/src/main/webpack/locales/` (varies) | en, de, es, fr |
| Frontend repo | per-module `*-ui.frontend/i18n/` or `locales/` | Varies; check module |

Always pass the directory path explicitly:

```
/i18n-check <path-to-repo>\cq-webapp\<i18n-module>\src\main\resources\i18n-root
```

## What it does NOT do

- Does NOT translate. Translation routes through GlobalLink — never paste machine-translated strings.
- Does NOT write to locale files. Read-only. Output is a findings report.
- Does NOT touch the Hybris repo's `hybris/config/globalLink*.properties` — those are Hybris irrotatable-secret files (file-level hard stop). Path-reference only.

## Output format

```
i18n audit — <directory>
========================
Reference locale: en.json
Locales found:    en, de, es, fr, it, ja, ko, pt, zh

JSON validity:
  ✓ en.json (8564 keys)
  ✓ de.json (8550 keys)
  ✗ es.json — parse error line 4231: unexpected token "}"
  ...

Locale parity (vs en.json):
  de.json — 14 missing keys
    - checkout.errors.expiredCard
    - checkout.errors.declinedAvs
    - product.configurator.shadeMatch
    ... 11 more
  es.json — N/A (parse error blocks audit)
  fr.json —  3 missing keys
    ...

Orphaned keys (in locale, not in code):
  legal.disclaimerOldFooter (last referenced 2024-Q3)
  payment.adyenLegacy
  ...

Untranslated (value identical to en):
  de.json:  product.specs.heading = "Product specifications"  (likely placeholder)
  fr.json:  cart.empty = "Your cart is empty"  (likely placeholder)
  ...

Interpolation drift:
  de.json: greeting.welcome — en has {name}, de has no placeholder
  ja.json: cart.itemCount — en has {count}, ja has {0} (old format)
  ...

GlobalLink drift (since 2026-04-15):
  Added to en.json but not exported: 47 keys
  Removed from en.json but still in locales: 6 keys

Summary:
  Total issues: 78 (1 critical parse error, 17 missing, 31 untranslated, 23 orphaned, 6 drift)
  Recommended next step: fix es.json parse error → request GlobalLink export → cleanup orphans
```

## How to fix common findings

Resolve current owners for each finding type via `?gov i18n` / `data/reviewer-map.json` rather than a hardcoded name — they vary by repo and rotate. Typical fix per finding:

| Finding | Fix |
|---|---|
| `es.json` parse error | Find the broken line via JSON validator; restore from previous commit if available. Flag whoever last touched it via `git -C <repo> log --oneline -- es.json`. |
| Missing keys | Add to `en.json`, mark for GlobalLink export. Do NOT add machine-translated values to other locales. Owner: feature owner. |
| Orphaned keys | Remove from ALL locales in a single PR. Never remove from `en.json` only. Owner: feature owner (last referencer). |
| Untranslated values | Submit to GlobalLink for translation. Mark with `// @globallink-pending` comment if your locale format allows. Owner: translation coordinator. |
| Interpolation drift | Update non-EN locales to match `en.json` placeholder format. Coordinate with GlobalLink before changing keys in flight. |
| GlobalLink export drift | Trigger GlobalLink export against the current `en.json`; reconcile incoming translated files. |

## Permissions

Allowed: read locale files, run JSON.parse, walk code directories for key references, generate audit report.
Blocked: writing to any locale file, modifying `globalLink*.properties` / `globalLink*.xml` (Hybris hard stop), invoking GlobalLink directly.

## Reminders

- Before fix: *"Never paste machine translations. Route through GlobalLink."*
- Before key rename: *"Coordinate with GlobalLink — in-flight translations may be queued against the old key."*
- `globalLink*.properties` referenced: *"Path-only reference. Do not read or modify Hybris translation config."*

## Ownership

Resolve current owners per area (Hybris i18n root, AEM i18n/clientlib locale, React component i18n, GlobalLink workflow, cross-repo locale rollout coordination) via `?gov i18n` / `?reviewers` / `data/reviewer-map.json` — do not restate a name table here.
