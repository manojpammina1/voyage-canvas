---
name: Voyage Canvas
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#424751'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#727783'
  outline-variant: '#c2c6d3'
  surface-tint: '#175ead'
  primary: '#003e7a'
  on-primary: '#ffffff'
  primary-container: '#0055a4'
  on-primary-container: '#afccff'
  inverse-primary: '#a8c8ff'
  secondary: '#9b4500'
  on-secondary: '#ffffff'
  secondary-container: '#fc8a40'
  on-secondary-container: '#672c00'
  tertiary: '#00435c'
  on-tertiary: '#ffffff'
  tertiary-container: '#005c7c'
  on-tertiary-container: '#83d4ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#a8c8ff'
  on-primary-fixed: '#001b3c'
  on-primary-fixed-variant: '#004689'
  secondary-fixed: '#ffdbc9'
  secondary-fixed-dim: '#ffb68d'
  on-secondary-fixed: '#331200'
  on-secondary-fixed-variant: '#763300'
  tertiary-fixed: '#c2e8ff'
  tertiary-fixed-dim: '#77d1ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004d68'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
  glass-surface: rgba(255, 255, 255, 0.4)
  glass-border: rgba(255, 255, 255, 0.6)
  evidence-verified: '#00C853'
  ocean-deep: '#002D54'
  sunset-glow: '#FFF1E6'
typography:
  display-xl:
    fontFamily: Geist
    fontSize: 64px
    fontWeight: '700'
    lineHeight: 72px
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Geist
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-caps:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.08em
  evidence-data:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-max: 1440px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 64px
  stack-gap: 12px
  canvas-pane-width: 400px
---

## Brand & Style

The design system embodies the concept of **"Adaptive Serenity."** It is designed to transform the high-cognitive load of cruise planning into an immersive, premium workspace that feels both high-tech and human-centric. The system targets a sophisticated demographic that values transparency, reliability, and emotional connection.

### Design Style: Glassmorphism & Immersive Airy
The aesthetic is defined by a **Glassmorphic** approach, utilizing heavy backdrop blurs, frosted surfaces, and hairline borders to create depth without visual weight. 

- **Immersive Layers:** Surfaces should feel like semi-transparent panes floating over a soft, ambient background (e.g., a high-key video of a family on a beach).
- **Premium Tactility:** Interactions should feel lightweight. Buttons use subtle inner glows and high-refraction borders rather than heavy shadows.
- **Progressive Materialization:** The UI is not static; it "materializes" as the user provides intent, moving from a centralized "Traveler Core" to a structured "Evidence Canvas."

## Colors

The palette is derived from maritime themes, blending the authority of **Ocean Blues** with the warmth of **Sunset Oranges**.

- **Primary (Ocean Blue):** Used for navigation, structural anchors, and verified state icons.
- **Secondary (Sunset Orange):** Reserved for high-intent CTAs, price highlights, and celebratory moments in the booking flow.
- **Tertiary (Sky Blue):** Used for interactive chips and non-critical accents.
- **Glass Surfaces:** Surfaces are not solid white. They use `rgba(255, 255, 255, 0.4)` with a `backdrop-filter: blur(20px)` to maintain legibility while preserving the immersive background video.
- **Evidence Verified:** A specific emerald green used exclusively for "Verified Price" and "Policy Confirmed" badges to signal SOX-compliant, deterministic data.

## Typography

The typography system balances the technical precision of **Geist** with the universal legibility of **Inter**.

- **Geist (Headlines/Labels):** Used for all structural and data-heavy labels. Its monospaced-adjacent tracking provides a sense of technical verification and modern luxury.
- **Inter (Body):** Used for AI-generated narratives and long-form policy descriptions to ensure maximum reading comfort.
- **Hierarchy:** Use `display-xl` sparingly for the initial "Welcome" or "Journey Title." `label-caps` should be used for metadata like "VALID UNTIL" or "GUEST COUNT."

## Layout & Spacing

This design system uses a **Fluid Workspace Canvas** model rather than a standard linear grid.

- **The Traveler Core:** Upon entry, the UI centers on a radial or horizontal stack of traveler avatars (Traveler Core). As the plan progresses, this core shifts to a "Global Header" state.
- **3-Pane Desktop Workspace:**
    1.  **Left (Constraints):** Fixed width (320px) glass pane for filters and "Locked" preferences.
    2.  **Center (Canvas):** Fluid area for generative sailing cards and journey paths.
    3.  **Right (Evidence/Cart):** Contextual pane that slides in when a specific sailing or price is selected.
- **Mobile Adaptive Lens:** Single-column layout focusing on one "Decision Object" at a time with a persistent "Price Evidence" bar docked at the bottom.

## Elevation & Depth

Depth is achieved through **Tonal Layering** and **Backdrop Blurs** rather than traditional drop shadows.

- **Level 1 (Background):** Immersive, low-contrast video (Family beach scene) with a `darken(10%)` overlay.
- **Level 2 (Canvas):** `glass-surface` with 20px blur. This is the base for sailing cards.
- **Level 3 (Active Evidence):** High-opacity glass (60%) with a `1px white` inner border to make "Verified" objects feel more solid and authoritative.
- **Level 4 (Modals/Overlays):** 80% opacity white or ocean-deep blue with heavy blur to isolate the user during checkout/payment phases.

## Shapes

The shape language is **Rounded**, reflecting the soft lines of a luxury ship’s hull and the organic nature of travel.

- **Cards:** Use `rounded-lg` (16px) to create a friendly, approachable container.
- **Inputs & Chips:** Use `rounded-full` (Pill-shaped) for traveler age tags and filter constraints to distinguish them from structural content.
- **Evidence Badges:** Small `rounded-sm` (4px) corners to imply a "stamp of approval" or document-like feel.

## Components

### Traveler Core (Dynamic Members)
- **Visuals:** Avatars change based on age input (Child, Teen, Adult, Senior icons or stylized illustrations).
- **State:** In the "Planning" phase, they are large and central. In the "Selection" phase, they minimize to a persistent header.

### Evidence Objects (Verified Cards)
- **Anatomy:** Title, Verified Timestamp (e.g., "Verified 2m ago"), Source API indicator, and "Lock" icon.
- **Style:** Stronger border contrast than standard cards; use `evidence-verified` green for checkmarks.

### Progressive Selection -> Payment
- **Selection:** Cards use a "Glass-to-Solid" transition. When selected, the background blur increases, and the border glows with `secondary-orange`.
- **Checkout:** A focused, single-pane glass sheet that hides the background video activity to reduce cognitive load.
- **Payment:** Elements use standard commerce patterns (PCI-compliant fields) but styled with Geist labels to maintain brand cohesion.

### Interaction States
- **Lock Preference (🔒):** A toggle icon on cards. When active, the icon fills with `primary-blue` and the card surface gains a subtle blue tint, signaling to the generative engine not to modify this constraint.