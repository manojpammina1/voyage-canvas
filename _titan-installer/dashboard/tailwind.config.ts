import type { Config } from 'tailwindcss';

// Titan default palette — a neutral placeholder, NOT a brand palette.
// The original reference implementation's brand-specific colour tokens were
// removed and replaced with this neutral set in the Titan de-branding pass
// (Phase 6 step 23 of the extraction plan; `titan-*` className references
// renamed repo-wide in Phase 7). An adopter who wants their own brand
// replaces these hex values directly, and, longer-term, the
// `branding.accent` value in titan.config.json drives `titan-blue-main` at
// render time — see docs/CONFIG-REFERENCE.md.
const titanTokens = {
  'titan-blue': {
    main: '#2F6FED',          // primary CTA — neutral placeholder blue
    deep: '#1E4FBF',          // hover/pressed
    soft: '#DCE7FD'           // light surface, hero backgrounds
  },
  'titan-gray': {
    main: '#3A3F47',          // secondary CTA, button outline, body
    dark: '#0B0C0E',          // headlines
    mid: '#636B76',           // muted body
    light: '#E6E8EB',         // borders, dividers, badges
    bg: '#F5F6F8'             // page background tint
  },
  'titan-success': '#1F8B4C',
  'titan-warning': '#E89110',
  'titan-danger':  '#D62828',
  'titan-white':   '#FFFFFF'
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: titanTokens,
      fontFamily: {
        // No bundled font — the Montserrat woff2 files + @font-face block
        // were the reference implementation's licensed brand font and are not redistributed (removed
        // in the Titan de-branding pass, see styles/globals.css). System UI
        // stack only; an adopter who wants a specific typeface supplies
        // their own @font-face block and prepends it here.
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
      },
      // Lemonade-style soft rounding + generous spacing
      borderRadius: {
        'card': '20px',
        'pill': '999px'
      },
      boxShadow: {
        'card':       '0 6px 24px -8px rgba(8, 10, 12, 0.12)',
        'card-hover': '0 12px 36px -10px rgba(15, 98, 254, 0.18)'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' }
        },
        orbit: {
          '0%':   { transform: 'translate(-50%, -50%) rotate(0deg) translateX(72px) rotate(0deg)' },
          '100%': { transform: 'translate(-50%, -50%) rotate(360deg) translateX(72px) rotate(-360deg)' }
        },
        'dot-pulse': {
          '0%, 60%, 100%': { transform: 'scale(0.6)',  opacity: '0.4' },
          '30%':           { transform: 'scale(1.0)',  opacity: '1.0' }
        },
        'check-pop': {
          '0%':   { transform: 'scale(0) rotate(-45deg)', opacity: '0' },
          '50%':  { transform: 'scale(1.2) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'scale(1.0) rotate(0deg)', opacity: '1' }
        },
        'confetti-rise': {
          '0%':   { transform: 'translateY(0) scale(0)',     opacity: '0' },
          '20%':  { transform: 'translateY(-20px) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-80px) scale(0.5)', opacity: '0' }
        },
        'draw-line': {
          '0%':   { strokeDashoffset: '200' },
          '100%': { strokeDashoffset: '0' }
        }
      },
      animation: {
        'float':           'float 4s ease-in-out infinite',
        'orbit':           'orbit 5s linear infinite',
        'dot-pulse':       'dot-pulse 1.4s ease-in-out infinite',
        'dot-pulse-d1':    'dot-pulse 1.4s ease-in-out 0.2s infinite',
        'dot-pulse-d2':    'dot-pulse 1.4s ease-in-out 0.4s infinite',
        'check-pop':       'check-pop 0.6s ease-out forwards',
        'confetti-rise':   'confetti-rise 1.5s ease-out forwards',
        'draw-line':       'draw-line 1.2s ease-out forwards'
      }
    }
  },
  plugins: []
} satisfies Config;
