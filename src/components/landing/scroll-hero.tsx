'use client';

import { useRef, type ReactNode } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ArrowRight, Hand, Info } from 'lucide-react';
import { Globe } from '@/components/globe/globe';
import { useHeatGrid } from '@/components/globe/use-heat-grid';
import { heatGradientCss, HEAT_MAX_C, HEAT_MIN_C } from '@/components/globe/globe-math';
import { formatGridDay, heatGridCaption } from '@/components/globe/heat-grid';
import { buttonClass } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { HERO_CARD, HERO_WORDMARK_CLASS, clipInset, clipInsetAt, globeShiftPercent, heroGlobeRadius, posterDiameterCss, type CardGeometry } from './hero-geometry';
import { PatternBackdrop } from './pattern-backdrop';
import styles from './landing.module.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const cardVars = (c: CardGeometry) =>
  `--hero-clip:${clipInset(c)};--globe-shift:${globeShiftPercent(c).toFixed(2)}%;--poster-d:${posterDiameterCss(c)};` +
  `--card-top:${(c.top * 100).toFixed(2)}%;--card-side:${(c.side * 100).toFixed(2)}%;--card-bottom:${(c.bottom * 100).toFixed(2)}%;--card-radius:${c.radius}px`;

/** Responsive initial (card) state as CSS variables, so the pre-hydration render already matches the animation. */
const HERO_VARS = `[data-hero-root]{${cardVars(HERO_CARD.mobile)}}@media (min-width:768px){[data-hero-root]{${cardVars(HERO_CARD.desktop)}}}`;

/**
 * Cinematic scroll-expansion hero (original implementation, inspired by 21st.dev "scroll-expansion-hero").
 * A framed night-sky card holding the globe expands to full-bleed as you scroll; the wordmark splits apart, the copy
 * lifts away and a data caption arrives; the stage then dissolves into the page. GSAP ScrollTrigger (scrubbed) drives
 * CSS clip-path/transforms only — the WebGL canvas never resizes during the scroll. The text is server-rendered and
 * visible without JavaScript (LCP); reduced motion → a static framed composition with no scroll-jacking.
 */
export function ScrollHero({ poster }: { poster: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const progressRef = useRef(0);
  const heat = useHeatGrid();

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        {
          desktop: '(min-width: 768px)',
          mobile: '(max-width: 767.98px)',
          wide: '(min-width: 1100px)',
          reduce: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          const { desktop, wide, reduce } = ctx.conditions as { desktop: boolean; mobile: boolean; wide: boolean; reduce: boolean };
          progressRef.current = 0;
          if (reduce) return;
          const card = desktop ? HERO_CARD.desktop : HERO_CARD.mobile;
          const frame = root.current?.querySelector<HTMLElement>('[data-hero-frame]');
          const proxy = { p: 0 };
          const spread = () => window.innerWidth * (desktop ? 0.2 : 0.06);
          const tl = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom bottom', scrub: 0.7, invalidateOnRefresh: true },
          });
          // one eased progress drives both the frame's clip-path and the globe camera, so they stay in lockstep
          tl.fromTo(
            proxy,
            { p: 0 },
            {
              p: 1,
              ease: 'power2.inOut',
              duration: 0.55,
              onUpdate: () => {
                progressRef.current = proxy.p;
                if (frame) frame.style.clipPath = clipInsetAt(card, proxy.p);
              },
            },
            0,
          )
            .fromTo(
              '[data-hero-globe]',
              { x: 0, y: 0, xPercent: 0, yPercent: globeShiftPercent(card) },
              // wide: globe moves right of the data panel · phones: globe moves up, panel sits below it
              { x: 0, y: 0, xPercent: wide ? 12 : 0, yPercent: desktop ? 0 : -15, ease: 'power2.inOut', duration: 0.55 },
              0,
            )
            .to('[data-hero-edge]', { autoAlpha: 0, duration: 0.2 }, 0.05)
            .to('[data-hero-fade]', { autoAlpha: 0, y: -36, duration: 0.2, stagger: 0.025 }, 0)
            .to('[data-hero-split="left"]', { x: () => -spread(), ease: 'power2.inOut', duration: 0.5 }, 0.02)
            .to('[data-hero-split="right"]', { x: () => spread(), ease: 'power2.inOut', duration: 0.5 }, 0.02)
            .to('[data-hero-title]', { y: () => -window.innerHeight * 0.06, ease: 'power1.inOut', duration: 0.4 }, 0.06)
            .to('[data-hero-title]', { autoAlpha: 0, duration: 0.14 }, 0.5)
            .to('[data-hero-caption]', { autoAlpha: 0, duration: 0.1 }, 0.45)
            .fromTo('[data-hero-overlay]', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, ease: 'power2.out', duration: 0.18 }, 0.56)
            .to('[data-hero-bg]', { yPercent: -10, scale: 1.06, duration: 1 }, 0)
            .fromTo('[data-hero-outro]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16 }, 0.84)
            .to('[data-hero-overlay]', { autoAlpha: 0, y: -20, duration: 0.1 }, 0.9);
          // hand the frame back to the responsive CSS variable when this breakpoint's timeline is reverted
          return () => {
            if (frame) frame.style.clipPath = 'var(--hero-clip)';
          };
        },
      );
      return () => mm.revert();
    },
    { scope: root },
  );

  const ready = heat.status === 'ready' ? heat : null;

  return (
    <section
      ref={root}
      data-hero-root
      aria-labelledby="hero-title"
      className="relative h-[240svh] md:h-[300svh] motion-reduce:h-svh motion-reduce:md:h-svh"
    >
      <style>{HERO_VARS}</style>
      <div className="sticky top-0 h-svh overflow-hidden [container-type:size]">
        {/* layered atmosphere (parallax) */}
        <div data-hero-bg className="atmosphere grain absolute -inset-[6%] will-change-transform" aria-hidden>
          <PatternBackdrop variant="contour" intensity={0.9} />
          <div className="absolute left-[8%] top-[18%] size-[38vmax] rounded-full bg-[radial-gradient(circle,rgba(209,80,26,0.16),transparent_65%)] blur-2xl" />
          <div className="absolute right-[4%] top-[4%] size-[30vmax] rounded-full bg-[radial-gradient(circle,rgba(127,1,31,0.14),transparent_65%)] blur-2xl" />
        </div>

        {/* card edge + soft shadow (fades out as the frame goes full-bleed) */}
        <div
          data-hero-edge
          aria-hidden
          className="absolute z-[9] border border-line-strong shadow-[0_40px_90px_-40px_rgba(74,0,18,0.45)] dark:shadow-[0_40px_90px_-40px_rgba(0,0,0,0.9)]"
          style={{
            top: 'calc(var(--card-top) - 1px)',
            left: 'calc(var(--card-side) - 1px)',
            right: 'calc(var(--card-side) - 1px)',
            bottom: 'calc(var(--card-bottom) - 1px)',
            borderRadius: 'calc(var(--card-radius) + 1px)',
          }}
        />

        {/* the media frame: a sand "observatory" card (night sky in dark theme) that expands to full-bleed */}
        <div
          data-hero-frame
          className="absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_50%_42%,#fdf9ef_0%,#f5ebd0_55%,#eddcb0_100%)] will-change-[clip-path] dark:bg-[radial-gradient(ellipse_at_50%_45%,#2a0d16_0%,#12060a_52%,#06020a_100%)]"
          style={{ clipPath: 'var(--hero-clip)' }}
        >
          <PatternBackdrop variant="grid" intensity={0.7} animated={false} fade="radial" className="dark:hidden" />
          <div className={cn('absolute inset-0 hidden opacity-70 dark:block', styles.starsFar)} aria-hidden />
          <div className={cn('absolute inset-0 hidden opacity-80 dark:block', styles.stars)} aria-hidden />
          <div data-hero-globe className="absolute inset-0 will-change-transform" style={{ transform: 'translateY(var(--globe-shift))' }}>
            <Globe
              heat={heat}
              progressRef={progressRef}
              fitRadius={heroGlobeRadius}
              poster={poster}
              label={
                ready
                  ? `Globe with land shown as dots and India highlighted, overlaid with ${ready.stats.count} ERA5 reanalysis daily-maximum temperature points for ${formatGridDay(ready.grid.meta.day)}; hottest ${ready.stats.maxC.toFixed(1)} °C. Drag or use the arrow keys to rotate.`
                  : 'Globe with land shown as dots and India highlighted in wine red. Drag or use the arrow keys to rotate.'
              }
            />
          </div>
          {/* small caption at the bottom of the card */}
          <p
            data-hero-caption
            className="pointer-events-none absolute inset-x-0 bottom-[calc(3%+10px)] z-10 px-[6%] text-center font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted md:bottom-[calc(4.5%+14px)] md:text-[11px]"
          >
            {ready ? heatGridCaption(ready.grid.meta) : 'Globe land: Natural Earth · India: geoBoundaries'}
          </p>
          {/* soft vignette */}
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_58%,rgba(207,174,102,0.32)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(6,2,10,0.55)_100%)]"
            aria-hidden
          />
        </div>

        {/* expanded-state data panel */}
        <div data-hero-overlay className="invisible absolute inset-x-4 bottom-6 z-30 opacity-0 sm:inset-x-auto sm:bottom-10 sm:left-10 sm:max-w-md">
          <div className="glass-strong rounded-2xl p-5 text-fg">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Historical replay · reanalysis</p>
            {ready ? (
              <>
                <h2 className="mt-1.5 font-heading text-xl font-semibold leading-snug">Daily maximum temperature, {formatGridDay(ready.grid.meta.day)}</h2>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">Hottest cell</dt>
                    <dd className="font-display text-lg font-bold tabular">{ready.stats.maxC.toFixed(1)} °C</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">Cells ≥ 45 °C</dt>
                    <dd className="font-display text-lg font-bold tabular">
                      {ready.stats.atOrAbove45}
                      <span className="text-xs font-normal text-fg-subtle"> / {ready.stats.count}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">Cells ≥ 40 °C</dt>
                    <dd className="font-display text-lg font-bold tabular">{ready.stats.atOrAbove40}</dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <div className="h-1.5 rounded-full ring-1 ring-line" style={{ background: heatGradientCss() }} aria-hidden />
                  <div className="mt-1 flex justify-between font-mono text-[10px] text-fg-subtle">
                    <span>≤ {HEAT_MIN_C} °C</span>
                    <span>40</span>
                    <span>≥ {HEAT_MAX_C} °C</span>
                  </div>
                </div>
                <p className="mt-3 hidden text-xs leading-relaxed text-fg-muted sm:block">
                  Each pillar is one ~1° ERA5 grid cell; height and colour scale with Tmax. Reanalysis is a model reconstruction, not
                  station measurements.
                </p>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-subtle">{heatGridCaption(ready.grid.meta)}</p>
              </>
            ) : (
              <>
                <h2 className="mt-1.5 font-heading text-xl font-semibold">India on the globe</h2>
                <p className="mt-2 text-sm text-fg-muted">
                  {heat.status === 'loading'
                    ? 'Loading the replay heat grid…'
                    : 'The replay heat grid is not available, so the globe shows land only — no temperatures are estimated in its place.'}
                </p>
              </>
            )}
            <p className="mt-3 hidden items-center gap-1.5 text-[11px] text-fg-subtle sm:flex">
              <Hand className="size-3.5" aria-hidden /> Drag to rotate · arrow keys when the globe is focused
            </p>
          </div>
        </div>

        {/* copy: server-rendered, visible without JS */}
        <div className="pointer-events-none absolute inset-x-0 top-[11%] z-20 flex flex-col items-center px-4 text-center md:top-[12.5%]">
          <p data-hero-fade className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-glass px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent backdrop-blur">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden /> Heatwave decision support · India
          </p>
          <h1 id="hero-title" data-hero-title className={cn('mt-4 text-fg', HERO_WORDMARK_CLASS)}>
            <span className="sr-only">CLIMATIQ</span>
            <span aria-hidden data-hero-word className="inline-flex">
              <span data-hero-split="left" className="inline-block">
                CLIM
              </span>
              <span data-hero-split="right" className="inline-block">
                ATIQ
              </span>
            </span>
          </h1>
          <p data-hero-fade className="mt-3 font-heading text-[clamp(1.05rem,2.1vw,1.6rem)] font-medium text-fg-muted">
            Understand the Heat. <span className="text-fg">Anticipate the Risk.</span>
          </p>
          <div data-hero-fade className="pointer-events-auto mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link href="/command" className={buttonClass('primary', 'lg', 'group px-7')}>
              Explore Dashboard
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link href="/portal" className={buttonClass('secondary', 'lg', 'hidden sm:inline-flex')}>
              Public portal
            </Link>
          </div>
          <p data-hero-fade className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <Info className="size-3.5" aria-hidden /> Prototype decision-support tool — not an official IMD warning service
          </p>
        </div>

        {/* final beat: dissolve into the page */}
        <div data-hero-outro className="pointer-events-none invisible absolute inset-x-0 bottom-0 z-40 h-1/2 bg-linear-to-b from-transparent to-bg opacity-0" aria-hidden />
      </div>
    </section>
  );
}
