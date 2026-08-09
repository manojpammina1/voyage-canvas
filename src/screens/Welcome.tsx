import Button from '../components/Button';
import LottieAnim from '../components/LottieAnim';
import { useWizard } from '../store/wizard-state';

// Screen 1 of 10 — Welcome.
// Goal: introduce Titan in one sentence; make "Get started" obvious.
// Lemonade rule: one screen, one decision.
// Animated hero: CSS-keyframe SVG fallback now; swap to Lottie when assets/lottie/welcome.json arrives.

export default function Welcome(): JSX.Element {
  const setScreen = useWizard((s) => s.setScreen);
  const nextScreen = useWizard((s) => s.nextScreen);

  const advance = (): void => {
    setScreen(nextScreen());
  };

  return (
    <div className="flex flex-col items-center text-center">
      <LottieAnim
        name="welcome"
        size={208}
        className="mb-8"
        fallback={
          <div className="w-56 h-56 rounded-card bg-titan-blue-soft flex items-center justify-center relative overflow-hidden">
            {/* Harness illustration: central Claude/Titan node feeding 5 satellites
                via animated pulses. Reads as: framework wrapping multiple consumers. */}
            <svg viewBox="0 0 240 240" className="w-full h-full" aria-hidden="true">
              <defs>
                <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%"   stopColor="#2F6FED" stopOpacity="1"   />
                  <stop offset="100%" stopColor="#1E4FBF" stopOpacity="0.85" />
                </radialGradient>
                <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#2F6FED" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#2F6FED" stopOpacity="0.15" />
                </linearGradient>
              </defs>

              {/* Outer dashed ring — slow rotation, darker for visibility */}
              <g style={{ transformOrigin: 'center', animation: 'spin 18s linear infinite' }}>
                <circle cx="120" cy="120" r="100" fill="none" stroke="#1E4FBF" strokeOpacity="0.55"
                        strokeWidth="1.75" strokeDasharray="4 8" />
              </g>

              {/* Connection lines — solid visible from start so all 5 are guaranteed drawn */}
              {[
                { x: 120, y: 40  },  // N
                { x: 198, y: 92  },  // NE
                { x: 170, y: 188 },  // SE
                { x: 70,  y: 188 },  // SW
                { x: 42,  y: 92  },  // NW
              ].map((s, i) => (
                <line
                  key={i}
                  x1="120" y1="120" x2={s.x} y2={s.y}
                  stroke="#2F6FED"
                  strokeOpacity="0.45"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              ))}

              {/* Travelling pulses along each line (small bright dots) */}
              {[
                { x: 120, y: 40,  d: 0.0 },
                { x: 198, y: 92,  d: 0.4 },
                { x: 170, y: 188, d: 0.8 },
                { x: 70,  y: 188, d: 1.2 },
                { x: 42,  y: 92,  d: 1.6 },
              ].map((s, i) => (
                <circle
                  key={`p${i}`}
                  cx={120} cy={120} r="3"
                  fill="#2F6FED"
                  style={{
                    animation: `pulse-out 2.6s ease-out infinite`,
                    animationDelay: `${s.d}s`,
                    transformOrigin: '120px 120px',
                    // we'll use individual keyframes per target via inline style
                    ['--tx' as never]: `${s.x - 120}px`,
                    ['--ty' as never]: `${s.y - 120}px`,
                  } as React.CSSProperties}
                />
              ))}

              {/* Satellite nodes */}
              {[
                { x: 120, y: 40  },
                { x: 198, y: 92  },
                { x: 170, y: 188 },
                { x: 70,  y: 188 },
                { x: 42,  y: 92  },
              ].map((s, i) => (
                <g key={`sat${i}`}>
                  <circle cx={s.x} cy={s.y} r="11" fill="#FFFFFF" stroke="#2F6FED" strokeWidth="2" />
                  <circle cx={s.x} cy={s.y} r="4"  fill="#2F6FED" />
                </g>
              ))}

              {/* Center node — Claude / Titan core. Slow pulse. */}
              <g style={{ transformOrigin: '120px 120px', animation: 'pulse-core 2.8s ease-in-out infinite' }}>
                <circle cx="120" cy="120" r="34" fill="url(#coreGrad)" />
                <circle cx="120" cy="120" r="34" fill="none" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="2" />
                {/* Titan mark — geometric "T" monogram (assets/titan-mark.svg),
                    rendered white over the dark core in place of the reference
                    implementation's logo removed in the Titan de-branding pass. Source viewBox
                    32x32, scaled/centered so it sits inside the r=34 circle. */}
                <g transform="translate(104 104) scale(1.0)">
                  <rect x="2" y="4" width="28" height="6" rx="2" fill="#FFFFFF" />
                  <rect x="13" y="4" width="6" height="24" rx="2" fill="#FFFFFF" />
                </g>
              </g>
            </svg>

            {/* Inline keyframes for travelling-pulse + core-pulse (Tailwind doesn't
                cover CSS variables in animations natively, so we define inline). */}
            <style>{`
              @keyframes pulse-out {
                0%   { transform: translate(0, 0)         scale(1);   opacity: 0.9; }
                70%  { transform: translate(var(--tx), var(--ty)) scale(0.6); opacity: 0;   }
                100% { transform: translate(var(--tx), var(--ty)) scale(0.6); opacity: 0;   }
              }
              @keyframes pulse-core {
                0%, 100% { transform: scale(1);    }
                50%      { transform: scale(1.06); }
              }
            `}</style>
          </div>
        }
      />

      <h1 className="text-4xl font-bold text-titan-gray-dark mb-4 tracking-tight">
        Welcome to Titan
      </h1>
      <p className="text-lg text-titan-gray-mid max-w-xl mb-10 leading-relaxed">
        Titan wires Claude Code into your daily engineering workflow —
        with the right guardrails, the right tools, and the right context for
        your role. Let's get you set up in a few clicks.
      </p>

      <Button
        size="lg"
        onClick={advance}
        autoFocus
      >
        Get started
      </Button>

      <p className="mt-6 text-sm text-titan-gray-mid">
        Takes about 2 minutes for non-developers · 5–10 minutes for developers
      </p>
    </div>
  );
}
