import { useId } from 'react';
import { cn } from '@/lib/utils';
import styles from './loader.module.css';

/**
 * Lightweight branded loading state for route-level `loading.tsx` files and Suspense fallbacks.
 * Pure CSS (no JS, no GSAP) so it can render from Server Components and costs nothing to ship.
 * It is indeterminate on purpose: it never shows a fabricated percentage.
 *
 *   // src/app/(app)/forecasts/loading.tsx
 *   export default function Loading() { return <CinematicLoader label="Loading forecasts" />; }
 */
export function CinematicLoader({
  label = 'Loading',
  detail,
  fullscreen = false,
  className,
}: {
  label?: string;
  detail?: string;
  fullscreen?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-5 text-center',
        fullscreen ? 'atmosphere fixed inset-0 z-[90]' : 'min-h-[50vh] w-full py-16',
        className,
      )}
    >
      <LoaderGlyph className="size-20" />
      <div className="flex flex-col items-center gap-2">
        <p className="font-display text-xs font-bold uppercase tracking-[0.32em] text-fg">
          {label}
          <span aria-hidden className="ml-0.5 inline-flex">
            <span className={styles.dot}>.</span>
            <span className={styles.dot}>.</span>
            <span className={styles.dot}>.</span>
          </span>
        </p>
        {detail && <p className="max-w-xs text-xs text-fg-muted">{detail}</p>}
        <span aria-hidden className="relative block h-px w-36 overflow-hidden bg-line-strong">
          <span className={cn('absolute inset-y-0 left-0 w-1/3 bg-linear-to-r from-transparent via-accent to-transparent', styles.sweep)} />
        </span>
      </div>
    </div>
  );
}

/** Animated mark: orbit rings + rotating heat arc around a pulsing core. Decorative. */
export function LoaderGlyph({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const heat = `cq-lh-${uid}`;
  const core = `cq-lc-${uid}`;
  return (
    <svg viewBox="0 0 80 80" aria-hidden className={cn('text-accent', className)}>
      <defs>
        <linearGradient id={heat} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7F011F" />
          <stop offset="0.6" stopColor="#D1501A" />
          <stop offset="1" stopColor="#E1C98D" />
        </linearGradient>
        <radialGradient id={core}>
          <stop offset="0" stopColor="#D1501A" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7F011F" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="22" fill={`url(#${core})`} className={styles.pulse} style={{ transformOrigin: '50% 50%' }} />
      <g className={styles.spinSlow}>
        <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="2 5" />
      </g>
      <circle cx="40" cy="40" r="26" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" />
      <ellipse cx="40" cy="40" rx="11" ry="26" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" />
      <path d="M14 40h52" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" />
      <g className={styles.spin}>
        <path d="M40 14a26 26 0 0 1 24.6 17.6" fill="none" stroke={`url(#${heat})`} strokeWidth="3.2" strokeLinecap="round" />
      </g>
      <circle cx="47" cy="34" r="3.2" fill="#7F011F" />
    </svg>
  );
}
