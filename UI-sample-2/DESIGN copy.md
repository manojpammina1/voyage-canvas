---
name: Aura Oceanic
colors:
  surface: '#f4faff'
  surface-dim: '#d2dbe1'
  surface-bright: '#f4faff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#ecf5fb'
  surface-container: '#e6eff5'
  surface-container-high: '#e0e9ef'
  surface-container-highest: '#dbe4ea'
  on-surface: '#141d21'
  on-surface-variant: '#404850'
  inverse-surface: '#293236'
  inverse-on-surface: '#e9f2f8'
  outline: '#707881'
  outline-variant: '#bfc7d1'
  surface-tint: '#006399'
  primary: '#005d90'
  on-primary: '#ffffff'
  primary-container: '#0077b6'
  on-primary-container: '#f3f7ff'
  inverse-primary: '#94ccff'
  secondary: '#006875'
  on-secondary: '#ffffff'
  secondary-container: '#9cecfb'
  on-secondary-container: '#016d7a'
  tertiary: '#4c51a0'
  on-tertiary: '#ffffff'
  tertiary-container: '#646aba'
  on-tertiary-container: '#f9f6ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cde5ff'
  primary-fixed-dim: '#94ccff'
  on-primary-fixed: '#001d32'
  on-primary-fixed-variant: '#004b74'
  secondary-fixed: '#9feffe'
  secondary-fixed-dim: '#83d3e1'
  on-secondary-fixed: '#001f24'
  on-secondary-fixed-variant: '#004f59'
  tertiary-fixed: '#e0e0ff'
  tertiary-fixed-dim: '#bfc2ff'
  on-tertiary-fixed: '#070a61'
  on-tertiary-fixed-variant: '#393e8c'
  background: '#f4faff'
  on-background: '#141d21'
  surface-variant: '#dbe4ea'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
---

## Brand & Style

The design system is rooted in a **Nautical Minimalism** aesthetic, blending the precision of modern SaaS tools with the airy, expansive feel of a premium maritime experience. The target audience values clarity, efficiency, and a high-end feel.

The UI leverages a refined **Glassmorphism** style, using translucent layers and backdrop filters to create a sense of depth and lightness. Unlike typical glassmorphism, this system utilizes high-contrast accents to ensure functionality and readability aren't sacrificed for the aesthetic. The emotional response should be one of calm focus, reliability, and modern sophistication.

## Colors

The palette is centered on a vibrant **Sea Blue** (#0077B6) which serves as the primary action color. To maintain the "airy" feel, the background is a **Pure White** (#FFFFFF), while secondary surfaces use a very light **Ice Blue** (#F0F9FF) to provide subtle structural contrast without adding visual weight.

- **Primary:** Sea Blue (#0077B6) for call-to-actions, active states, and critical information.
- **Secondary:** Ice Blue (#90E0EF) for soft accents, hover states on light backgrounds, and subtle decorative elements.
- **Surface:** Pure White (#FFFFFF) for the base layer to maximize brightness.
- **Contrast/Text:** Deep Navy (#03045E) for primary typography to ensure high legibility against white and light blue backgrounds.

## Typography

This design system utilizes **Geist** for its entire typographic scale. Geist provides a technical, clean, and highly legible framework that complements the nautical, premium theme.

Headlines should be bold and tightly tracked to command attention, while body text maintains generous line heights to preserve the airy feel of the layout. All labels use a slightly heavier weight to ensure they remain distinct against glassmorphic backgrounds.

## Layout & Spacing

The design system employs a **Fluid-Fixed Hybrid Grid**. Content is housed within a centered container with a maximum width of 1280px. For internal spacing, an 8px linear scale is used to maintain mathematical harmony.

- **Desktop:** 12-column grid with 24px gutters and 48px outer margins.
- **Tablet:** 8-column grid with 20px gutters and 32px outer margins.
- **Mobile:** 4-column grid with 16px gutters and 16px outer margins.

Large whitespace gaps (64px+) should be used between major sections to reinforce the premium, uncrowded "oceanic" feel.

## Elevation & Depth

Elevation is achieved primarily through **Glassmorphic Tiers** rather than traditional heavy shadows.

- **Base Layer:** Pure White (#FFFFFF), opaque.
- **Level 1 (Cards/Modals):** White background at 70% opacity with a 20px Backdrop Blur. Borders are 1px solid, colored at 20% opacity of the Sea Blue primary color.
- **Level 2 (Dropdowns/Overlays):** White background at 85% opacity with 32px Backdrop Blur and a very soft, diffused Sea Blue tint in the shadow (#0077B6 at 10% opacity, 20px blur, 4px Y-offset).

Avoid using pitch-black shadows; always tint shadows with the primary Sea Blue to keep the atmosphere "nautical" and "cool."

## Shapes

The shape language is **Rounded**, reflecting the soft edges of water and polished maritime equipment. Standard components like buttons and cards use a 0.5rem (8px) radius. Larger containers or hero sections should utilize `rounded-xl` (1.5rem / 24px) to emphasize the premium, friendly nature of the design system.

## Components

### Buttons
Primary buttons use a solid Sea Blue (#0077B6) background with White text. Secondary buttons should be glassmorphic: a 1px Sea Blue border with a very faint Ice Blue tint on hover. 

### Cards
Cards are the primary expression of the glassmorphism style. Use 70-80% opacity white backgrounds with a subtle 1px border (#0077B6 at 15% opacity). Padding within cards should be generous (min 24px).

### Input Fields
Inputs use a "Pure White" background with a 1px border in a light grey-blue. On focus, the border transitions to a 2px Sea Blue with a soft outer glow (glow color: primary blue at 20% opacity).

### Chips & Tags
Chips are pill-shaped (radius: 3). Use Ice Blue (#90E0EF) with Sea Blue text for a low-contrast, high-readability look.

### Navigation
The navigation bar should be a "sticky" glassmorphic element (Backdrop Blur: 20px, Opacity: 80%) with a thin bottom border to separate it from the main content. Active links are indicated by a 2px Sea Blue underline with rounded caps.