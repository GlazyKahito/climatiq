'use client';

import dynamic from 'next/dynamic';
import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { detectCapabilities, pickTier, tierFromFps, type Tier } from './perf-tier';
import { markGlobeReady } from './readiness';
import type { GlobeControl } from './globe-canvas';
import { useGlobalHeat, type HeatGridState } from './use-heat-grid';
import { useDocTheme } from './use-doc-theme';

const GlobeCanvas = dynamic(() => import('./globe-canvas'), { ssr: false });

// Capability probe: runs once in the browser (never during SSR) and is memoised; the R3F chunk downloads only if
// WebGL is usable.
let probedTier: Tier | null = null;
const probeTier = () => (probedTier ??= pickTier(detectCapabilities()));
const noopSubscribe = () => () => {};

export type GlobeProps = {
  /** Server-rendered SVG globe: shown before WebGL is ready and kept as the fallback when WebGL is unavailable. */
  poster?: ReactNode;
  heat: HeatGridState;
  progressRef?: RefObject<number>;
  fitRadius?: (w: number, h: number, p: number) => number;
  className?: string;
  /** Accessible description of what the globe shows */
  label?: string;
  /** Called with the tier actually in use (for captions / debugging) */
  onTier?: (tier: Tier) => void;
};

/**
 * Progressive 3D globe:
 *   SSR poster (SVG) → capability probe → lazy R3F canvas (only once on-screen) → crossfade when the first frame lands.
 * Off-screen → frameloop "never"; reduced motion → no auto-rotation and on-demand frames; no WebGL, context loss,
 * a render error or a very low measured fps → stays on (or returns to) the static poster.
 */
export function Globe({ poster, heat, progressRef, fitRadius, className, label, onTier }: GlobeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const controlRef = useRef<GlobeControl | null>(null);
  const detectedTier = useSyncExternalStore(noopSubscribe, probeTier, () => null);
  /** set when the measured fps, a context loss or a render error forces a lower tier */
  const [override, setOverride] = useState<Tier | null>(null);
  const tier: Tier | null = override ?? detectedTier;
  const [visible, setVisible] = useState(false);
  const [everVisible, setEverVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const theme = useDocTheme();
  const globalHeat = useGlobalHeat();

  useEffect(() => {
    if (tier) onTier?.(tier);
    if (tier === 'fallback') markGlobeReady('fallback');
  }, [tier, onTier]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      setEverVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
        if (entry.isIntersecting) setEverVisible(true);
      },
      { rootMargin: '120px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const handleReady = useCallback(() => {
    setReady(true);
    markGlobeReady('webgl');
  }, []);
  const handleFps = useCallback(
    (fps: number) => {
      if (tier && tier !== 'fallback') setOverride(tierFromFps(tier, fps));
    },
    [tier],
  );
  const toFallback = useCallback(() => setOverride('fallback'), []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 15 : 6;
    const map: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step / 2], ArrowDown: [0, -step / 2] };
    const d = map[e.key];
    if (!d || !controlRef.current) return;
    e.preventDefault();
    controlRef.current.nudge(d[0], d[1]);
  };

  const live = tier !== null && tier !== 'fallback';
  const showCanvas = live && everVisible;
  const interactive = live && ready;

  return (
    <div
      ref={ref}
      data-cq-globe=""
      data-tier={tier ?? 'pending'}
      role="img"
      aria-label={label ?? 'Globe with land shown as dots and India highlighted'}
      aria-roledescription={interactive ? 'interactive globe' : undefined}
      tabIndex={interactive ? 0 : -1}
      onKeyDown={interactive ? onKeyDown : undefined}
      className={cn('relative h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset', className)}
    >
      <div className={cn('pointer-events-none absolute inset-0 transition-opacity duration-1000', ready && live ? 'opacity-0' : 'opacity-100')}>
        {poster}
      </div>
      {showCanvas && (
        <CanvasBoundary onError={toFallback}>
          <div className={cn('absolute inset-0 transition-opacity duration-1000', ready ? 'opacity-100' : 'opacity-0')}>
            <GlobeCanvas
              tier={tier}
              theme={theme}
              heat={heat.status === 'ready' ? heat.grid.points : null}
              globalHeat={globalHeat}
              reducedMotion={reducedMotion}
              active={visible}
              progressRef={progressRef}
              fitRadius={fitRadius}
              controlRef={controlRef}
              onReady={handleReady}
              onFps={handleFps}
              onContextLost={toFallback}
            />
          </div>
        </CanvasBoundary>
      )}
    </div>
  );
}

class CanvasBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[globe] WebGL renderer failed, using the static globe instead.', error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
