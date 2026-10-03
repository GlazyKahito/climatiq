import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { GlobeArt } from '@/server/landing/geo-art';

/**
 * Static orthographic globe (server-rendered SVG) in the same resting view as the WebGL globe.
 * Doubles as the pre-hydration poster and the no-WebGL fallback. Heat dots are the real ERA5 replay grid when
 * the data file exists, otherwise they are simply absent.
 *
 * Light Sand first: a cream "paper" sphere, ink land, India in Wine Red. The night palette applies only under
 * [data-theme=dark] (Tailwind `dark:` variants).
 */
export function GlobePoster({ art, diameter, className, style }: { art: GlobeArt; diameter?: string; className?: string; style?: CSSProperties }) {
  const R = art.size / 2 - 2;
  const pad = R * 0.2;
  const vb = `${-pad} ${-pad} ${art.size + pad * 2} ${art.size + pad * 2}`;
  const scale = (art.size + pad * 2) / (2 * R);
  const c = art.size / 2;
  return (
    <div
      aria-hidden
      className={cn('absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2', className)}
      style={{ width: diameter ? `calc(${diameter} * ${scale.toFixed(4)})` : undefined, ...style }}
    >
      <svg viewBox={vb} className="size-full overflow-visible">
        <defs>
          <radialGradient id="cq-poster-sphere-l" cx="38%" cy="32%" r="78%">
            <stop offset="0" stopColor="#fdf9ef" />
            <stop offset="0.6" stopColor="#f5ebd0" />
            <stop offset="1" stopColor="#e3cf9f" />
          </radialGradient>
          <radialGradient id="cq-poster-sphere-d" cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#2b0f17" />
            <stop offset="0.65" stopColor="#13060a" />
            <stop offset="1" stopColor="#0b0306" />
          </radialGradient>
          <radialGradient id="cq-poster-atmo-l" cx="50%" cy="50%" r="50%">
            <stop offset="0.83" stopColor="#b53853" stopOpacity="0" />
            <stop offset="0.86" stopColor="#b53853" stopOpacity="0.16" />
            <stop offset="1" stopColor="#b53853" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cq-poster-atmo-d" cx="50%" cy="50%" r="50%">
            <stop offset="0.83" stopColor="#f2a27e" stopOpacity="0" />
            <stop offset="0.86" stopColor="#f2a27e" stopOpacity="0.32" />
            <stop offset="1" stopColor="#f2a27e" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cq-poster-rim-l" cx="50%" cy="50%" r="50%">
            <stop offset="0.8" stopColor="#9b1a39" stopOpacity="0" />
            <stop offset="1" stopColor="#9b1a39" stopOpacity="0.32" />
          </radialGradient>
          <radialGradient id="cq-poster-rim-d" cx="50%" cy="50%" r="50%">
            <stop offset="0.82" stopColor="#d98a6a" stopOpacity="0" />
            <stop offset="1" stopColor="#d98a6a" stopOpacity="0.45" />
          </radialGradient>
        </defs>
        <circle cx={c} cy={c} r={R * 1.17} fill="url(#cq-poster-atmo-l)" className="dark:hidden" />
        <circle cx={c} cy={c} r={R * 1.17} fill="url(#cq-poster-atmo-d)" className="hidden dark:inline" />
        <circle cx={c} cy={c} r={R} fill="url(#cq-poster-sphere-l)" className="dark:hidden" />
        <circle cx={c} cy={c} r={R} fill="url(#cq-poster-sphere-d)" className="hidden dark:inline" />
        <path d={art.graticule} fill="none" className="stroke-[#7f011f] opacity-[0.07] dark:stroke-[#f5ebd0]" strokeWidth="1" />
        <path
          d={art.land}
          className="fill-[#4a2a2c]/15 stroke-[#4a2a2c]/40 dark:fill-[#efe2c4]/15 dark:stroke-[#efe2c4]/30"
          strokeWidth="0.8"
        />
        {art.india && (
          <path d={art.india} className="fill-[#7f011f]/20 stroke-[#7f011f] dark:fill-[#ff5a7a]/20 dark:stroke-[#ff7a92]" strokeWidth="1.4" strokeLinejoin="round" />
        )}
        <g fill="none" strokeLinecap="round">
          {art.heat.map((h) => (
            <path key={h.fromC} d={h.d} stroke={h.color} strokeWidth="5.4" />
          ))}
        </g>
        <circle cx={c} cy={c} r={R} fill="url(#cq-poster-rim-l)" className="dark:hidden" />
        <circle cx={c} cy={c} r={R} fill="url(#cq-poster-rim-d)" className="hidden dark:inline" />
      </svg>
    </div>
  );
}
