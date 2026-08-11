# UI Reference Selection

These files are **visual references only**. Do not copy them wholesale or treat their data/actions as authoritative product requirements.

| File | Original source | Use |
|---|---|---|
| `01-intent.html` | `code copy 10.html` | Adaptive Serenity entry composition; change primary UX to natural-language intent-first |
| `02-traveler-core.html` | `code copy 12.html` | Traveler/constraint core and orbital materialization |
| `03-caribbean-route.html` | `code copy 13.html` | Route/destination expansion; remove weather/excursion scope |
| `04-decision-orbit.html` | `code copy 8.html` | Primary budget/decision-orbit inspiration; keep Orbit/List idea |
| `05-evidence.html` | `code copy 6.html` | Selected journey/evidence composition; strengthen `asOf`/`validUntil`/source |
| `06-auth-hold.html` | `code copy.html` | Progressive auth/hold composition; final CTA is `Continue to secure checkout` |
| `caribbean-map-concept.png` | supplied concept screenshot | Atmospheric/visual inspiration only; generated labels are not trusted geography |

## Required corrections during implementation

Do not preserve:

- generated/fake geography labels
- obsolete 2024 dates
- named/loyalty user state before authentication
- AI payment/`Confirm & Pay` actions
- payment/security controls shown as orbit nodes
- hover-only essential interactions
- continuous motion without reduced-motion support
- runtime `googleusercontent` image dependencies
- excessive top/side navigation that makes the embedded assistant feel like a separate SaaS product
- weather/dining/excursions as POC features

Implement from `DESIGN.md`, `DOMAIN_CONTRACTS.md`, and `IMPLEMENTATION_PLAN.md` first. Use these HTML files only to understand composition, spacing, and visual direction.
