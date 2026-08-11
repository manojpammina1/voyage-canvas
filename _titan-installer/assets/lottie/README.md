# Lottie animations

Drop Lottie JSON files into this directory to replace the inline SVG fallbacks.

The `LottieAnim` wrapper in `src/components/LottieAnim.tsx` loads from `/assets/lottie/<name>.json` at runtime. If a file is present, it animates; if not, the inline SVG fallback shown in the calling screen stays visible.

## Expected names

| Filename | Used on | Suggested theme |
|----------|---------|------------------|
| `welcome.json` | Welcome screen hero | Brand-blue arc / rocket / abstract flow |
| `onboarding-po.json` | Onboarding (PO / Manager / ProdSupport) | Checklist / sticky note |
| `onboarding-build.json` | Onboarding (Dev / Lead / Arch / QA / Security / SRE / Designer) | Code brackets / blueprint |
| `install-progress.json` | Install Progress (during phases) | Loading bar / spinner |
| `done-success.json` | Done screen | Checkmark + confetti |
| `button-loading.json` | Buttons when `loading=true` | 3-dot pulse |

## Brand consistency

Pick Lottie files in titan-blue or neutral palettes. If files are off-brand, the wrapper supports a `style={{ filter: 'hue-rotate(180deg)' }}` override on the calling component — but cleanest is to pick files that already use the titan blue range (see `branding.accent` in titan.config.json, default `#2F6FED`).

## Where to get free Lottie files

- https://lottiefiles.com/free-animations
- https://iconscout.com/free-lottie

Verify license allows internal commercial use before bundling.

## Naming + format

- Lowercase, hyphenated filenames
- One animation per JSON
- Keep individual files under 200 KB (Lottie can balloon if too many vector points)
- Test by dropping in, running `npm run dev:electron`, and confirming the animation replaces the CSS-SVG fallback
