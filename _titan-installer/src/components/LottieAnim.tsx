import { useEffect, useState, type ReactNode } from 'react';
import Lottie from 'lottie-react';

// LottieAnim — renders a Lottie JSON if present at /assets/lottie/<name>.json,
// otherwise renders the fallback children (typically an inline SVG with CSS
// keyframes). This lets us ship animated UI today with CSS-SVG and hot-swap
// to an adopter-supplied brand's Lottie files later, without touching screen code.
//
// Lottie JSONs are loaded lazily via fetch() against the bundled Vite asset.
// If the file 404s, fallback stays visible.

interface Props {
  name: string;                  // <name>.json under src/assets/lottie/
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  fallback: ReactNode;           // inline SVG fallback (always rendered first)
  size?: number;                 // px square; passes to Lottie style
}

type AnimationData = Record<string, unknown>;

const ANIM_CACHE = new Map<string, AnimationData | null>();

export default function LottieAnim({ name, className, loop = true, autoplay = true, fallback, size }: Props): JSX.Element {
  const [animData, setAnimData] = useState<AnimationData | null>(() => ANIM_CACHE.get(name) ?? null);
  const [tried, setTried] = useState<boolean>(ANIM_CACHE.has(name));

  useEffect(() => {
    if (tried) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/assets/lottie/${name}.json`);
        if (!cancelled && r.ok) {
          const data = (await r.json()) as AnimationData;
          ANIM_CACHE.set(name, data);
          setAnimData(data);
        } else {
          ANIM_CACHE.set(name, null);
        }
      } catch {
        ANIM_CACHE.set(name, null);
      } finally {
        if (!cancelled) setTried(true);
      }
    })();
    return () => { cancelled = true; };
  }, [name, tried]);

  if (animData) {
    return (
      <div className={className} style={size ? { width: size, height: size } : undefined}>
        <Lottie animationData={animData} loop={loop} autoplay={autoplay} />
      </div>
    );
  }
  return <div className={className}>{fallback}</div>;
}
