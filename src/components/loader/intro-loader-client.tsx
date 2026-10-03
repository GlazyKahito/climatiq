'use client';

import { useRef, useState, type CSSProperties } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { LogoMark } from '@/components/shell/logo';
import { HEAT_MAX_C, HEAT_MIN_C, clamp01, heatColor, heatGradientCss, rgbToHex } from '@/components/globe/globe-math';
import { formatGridDay } from '@/components/globe/heat-grid';
import { onGlobeReady, pageHasGlobe } from '@/components/globe/readiness';
import { loadHeatGrid } from '@/components/globe/use-heat-grid';
import { HERO_WORDMARK_CLASS, cardFor, globeShiftPercent } from '@/components/landing/hero-geometry';
import { cn } from '@/lib/utils';
import { INTRO_DONE_EVENT, INTRO_ID, INTRO_SESSION_KEY } from './constants';
import styles from './loader.module.css';

gsap.registerPlugin(useGSAP);

/** Longest we wait for the heat grid after the boot beat before skipping the readout (ms). */
const HEAT_WAIT_MS = 2200;
/** Longest we hold the reveal for the globe's first real frame, from the start of the intro (ms). */
const GLOBE_WAIT_MS = 5200;
const HALVES = ['CLIM', 'ATIQ'] as const;

type Check = 'wait' | 'ok' | 'off';
type Checks = { type: Check; grid: Check; globe: Check };
type Reading = { maxC: number; day: string; lat: number; lon: number };

/** Initial (pre-hydration) states, inline so the server HTML already matches the first animation frame. */
const HIDDEN: CSSProperties = { opacity: 0, visibility: 'hidden' };
const HIDDEN_LOW: CSSProperties = { ...HIDDEN, transform: 'translateY(10px)' };

const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;
const delay = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * "Thermal ignition" intro that hands over to the hero without a cut:
 *   1. boot   — crosshair hairlines and HUD draw in; the checklist reports real readiness (type, ERA5 grid, globe)
 *   2. heat   — a readout climbs to the hottest cell of the real ERA5 replay grid while a heat bloom builds
 *   3. ignite — the wordmark resolves out of heat haze (SVG turbulence) at the hero's exact type size, cooling to sand
 *   4. reveal — the wordmark flies onto the hero's wordmark (FLIP) while a hole burns open from the globe's centre;
 *               the globe starts its spin-in at that moment, then the overlay crossfades onto the identical hero text
 * Nothing is invented: if the grid is missing the readout is skipped, and the reveal waits for the globe's first
 * frame (or a cap). Escape / "Skip intro" fast-forwards through the same hand-off.
 */
export function IntroLoaderClient({ failsafeClass }: { failsafeClass: string }) {
  const root = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const skipFn = useRef<() => void>(() => {});
  const [done, setDone] = useState(false);
  const [checks, setChecks] = useState<Checks>({ type: 'wait', grid: 'wait', globe: 'wait' });
  const [reading, setReading] = useState<Reading | null>(null);

  useGSAP(
    (_, contextSafe) => {
      const safe = contextSafe ?? (<T,>(f: T) => f);
      const host = document.getElementById(INTRO_ID);
      const el = root.current;
      if (!host || !el || !host.hasAttribute('data-active')) {
        setDone(true);
        return;
      }
      host.classList.remove(failsafeClass); // JS is in control now
      try {
        window.sessionStorage.setItem(INTRO_SESSION_KEY, '1');
      } catch {}

      const page = document.getElementById('cq-page');
      const html = document.documentElement;
      const prevOverflow = html.style.overflow;
      const prevGutter = html.style.scrollbarGutter;
      page?.setAttribute('inert', '');
      // lock scrolling but keep the scrollbar's space, so the page doesn't shift sideways when the lock lifts
      html.style.scrollbarGutter = 'stable';
      html.style.overflow = 'hidden';

      const q = gsap.utils.selector(el);
      const one = (sel: string) => q(sel)[0] as HTMLElement;
      const word = one('[data-intro-word]');
      const wordText = one('[data-intro-wordtext]');
      const wordmark = one('[data-intro-wordmark]');
      const num = one('[data-intro-num]');
      const bar = one('[data-intro-bar]');
      const bloom = one('[data-intro-bloom]');
      const rim = one('[data-intro-rim]');
      const fg = getComputedStyle(html).getPropertyValue('--fg').trim() || '#eee0c7';

      let alive = true;
      let finished = false;
      let fast = false;
      let current: gsap.core.Timeline | null = null;
      let release = () => {};
      const skipped = new Promise<void>((r) => (release = r));
      const cleanups: (() => void)[] = [];

      const restore = () => {
        page?.removeAttribute('inert');
        html.style.overflow = prevOverflow;
        html.style.scrollbarGutter = prevGutter;
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        restore();
        host.removeAttribute('data-active');
        host.removeAttribute('data-reveal');
        window.dispatchEvent(new Event(INTRO_DONE_EVENT));
        setDone(true);
      };
      /** Plays a beat; resolves when it completes (immediately when skipping). */
      const play = (tl: gsap.core.Timeline) =>
        new Promise<void>((resolve) => {
          current = tl;
          tl.eventCallback('onComplete', () => resolve());
          if (fast) tl.progress(1);
        });
      const check = (k: keyof Checks, v: Check) => alive && setChecks((c) => ({ ...c, [k]: v }));

      // ── real readiness ─────────────────────────────────────────────────────────────────────────────
      document.fonts?.ready.then(() => check('type', 'ok'));
      const heat = loadHeatGrid().then((s): Reading | null => {
        if (s.status !== 'ready') {
          check('grid', 'off');
          return null;
        }
        check('grid', 'ok');
        const r = { maxC: s.stats.maxC, day: formatGridDay(s.grid.meta.day), lat: s.stats.hottest.lat, lon: s.stats.hottest.lon };
        if (alive) setReading(r);
        return r;
      });
      const globe = new Promise<void>((resolve) => {
        if (!pageHasGlobe()) {
          check('globe', 'off');
          return resolve();
        }
        const unsub = onGlobeReady((kind) => {
          check('globe', kind === 'webgl' ? 'ok' : 'off');
          resolve();
        });
        const timer = window.setTimeout(resolve, GLOBE_WAIT_MS); // reveal anyway; the poster globe is already drawn
        cleanups.push(unsub, () => window.clearTimeout(timer));
      });

      // ── beats ──────────────────────────────────────────────────────────────────────────────────────
      const boot = safe(() =>
        gsap
          .timeline()
          .fromTo(q('[data-intro-line="x"]'), { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'expo.inOut' }, 0)
          .fromTo(q('[data-intro-line="y"]'), { scaleY: 0 }, { scaleY: 1, duration: 1.1, ease: 'expo.inOut' }, 0.08)
          .to(q('[data-intro-hud]'), { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.07 }, 0.3)
          .fromTo(bloom, { autoAlpha: 0, scale: 0.2 }, { autoAlpha: 0.45, scale: 0.5, duration: 1.1, ease: 'power2.out' }, 0)
          // the dialog's one control — focusable once the HUD (and with it the button) is visible
          .call(() => skipRef.current?.focus({ preventScroll: true }), [], 0.35),
      );

      const climb = safe((r: Reading) => {
        const v = { c: HEAT_MIN_C };
        return gsap
          .timeline()
          .to(q('[data-intro-readout]'), { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0)
          .to(
            v,
            {
              c: r.maxC,
              duration: 1.7,
              ease: 'power2.inOut',
              onUpdate: () => {
                num.textContent = v.c.toFixed(1);
                // brightest at "hot orange" — the deepest ramp stops would sink into the wine background
                num.style.color = rgbToHex(heatColor(Math.min(v.c, 41)));
                const k = clamp01((v.c - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C));
                bar.style.clipPath = `inset(0 ${((1 - k) * 100).toFixed(2)}% 0 0)`;
              },
            },
            0.15,
          )
          .to(bloom, { autoAlpha: 1, scale: 1.15, duration: 1.8, ease: 'power2.in' }, 0.15)
          .to({}, { duration: 0.35 });
      });

      const ignite = safe(() =>
        gsap
          .timeline()
          .to(q('[data-intro-readout]'), { autoAlpha: 0, y: -22, filter: 'blur(10px)', duration: 0.45, ease: 'power2.in' }, 0)
          .to(bloom, { autoAlpha: 0.7, scale: 1.6, duration: 1.3, ease: 'power2.out' }, 0)
          .set(word, { autoAlpha: 1 }, 0.2)
          .fromTo(q('[data-intro-disp]'), { attr: { scale: 90 } }, { attr: { scale: 0 }, duration: 1.15, ease: 'power3.out' }, 0.2)
          .fromTo(
            q('[data-intro-turb]'),
            { attr: { baseFrequency: '0.004 0.11' } },
            { attr: { baseFrequency: '0.012 0.03' }, duration: 1.15, ease: 'power2.out' },
            0.2,
          )
          .fromTo(
            q('[data-intro-letter]'),
            { opacity: 0, color: '#ffc183', textShadow: '0 0 34px rgba(240,121,58,0.95)' },
            {
              opacity: 1,
              color: fg,
              textShadow: '0 0 0px rgba(240,121,58,0)',
              duration: 1,
              ease: 'power2.out',
              stagger: { each: 0.05, from: 'center' },
            },
            0.2,
          )
          .fromTo(word, { scale: 1.1 }, { scale: 1, duration: 1.3, ease: 'expo.out' }, 0.2)
          .set(wordText, { filter: 'none' }), // drop the filter so the glyphs are crisp for the hand-off
      );

      const reveal = safe(() => {
        host.setAttribute('data-reveal', ''); // releases the globe's spin-in
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // iris centre = the globe's centre inside the hero card
        const fr = document.querySelector('[data-hero-frame]')?.getBoundingClientRect();
        const ix = fr ? fr.left + fr.width / 2 : vw / 2;
        const iy = fr ? fr.top + fr.height * (0.5 + globeShiftPercent(cardFor(vw)) / 100) : vh * 0.7;
        const reach = Math.hypot(Math.max(ix, vw - ix), Math.max(iy, vh - iy)) + 60;
        el.style.setProperty('--ix', `${ix}px`);
        el.style.setProperty('--iy', `${iy}px`);

        // FLIP: our wordmark and the hero's share type and letter boxes, so a translation lands it exactly
        gsap.set(word, { x: 0, y: 0, scale: 1 });
        const from = wordmark.getBoundingClientRect();
        const to = document.querySelector('[data-hero-word]')?.getBoundingClientRect();
        const dx = to ? to.left - from.left : 0;
        const dy = to ? to.top - from.top : 0;

        const tl = gsap
          .timeline({ onComplete: finish })
          .to(q('[data-intro-hud], [data-intro-line]'), { autoAlpha: 0, duration: 0.4, ease: 'power1.out' }, 0)
          .to(word, { x: dx, y: dy, duration: 1, ease: 'expo.inOut' }, 0)
          .to(bloom, { autoAlpha: 0, duration: 0.7 }, 0.3)
          .fromTo(rim, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0.4)
          .fromTo(el, { '--ir': '-2px' }, { '--ir': `${reach}px`, duration: 1.4, ease: 'power3.in' }, 0.4)
          .to(rim, { autoAlpha: 0, duration: 0.35, ease: 'power1.in' }, 1.45)
          .to(word, { autoAlpha: 0, duration: 0.3 }, 1.6); // the identical hero wordmark is underneath by now
        if (fast) tl.timeScale(2.4);
        return tl;
      });

      skipFn.current = () => {
        if (fast || finished) return;
        fast = true;
        current?.progress(1);
        release();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') skipFn.current();
      };
      window.addEventListener('keydown', onKey);

      // ── sequence ───────────────────────────────────────────────────────────────────────────────────
      void (async () => {
        await play(boot());
        const r = await Promise.race([heat, delay(HEAT_WAIT_MS).then(() => null), skipped.then(() => null)]);
        if (!alive) return;
        if (r && !fast) await play(climb(r));
        if (!alive) return;
        await play(ignite());
        await Promise.race([globe, skipped]);
        if (!alive) return;
        current = reveal();
      })();

      return () => {
        alive = false;
        cleanups.forEach((f) => f());
        window.removeEventListener('keydown', onKey);
        if (!finished) restore();
      };
    },
    { scope: root },
  );

  if (done) return null;

  const ready = [checks.type, checks.grid, checks.globe].filter((c) => c !== 'wait').length;

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="CLIMATIQ intro"
      className="absolute inset-0 overflow-hidden"
      style={{ '--ir': '-2px' } as CSSProperties}
    >
      {/* everything except the wordmark — the iris burns through this layer */}
      <div className={cn('atmosphere grain absolute inset-0', styles.iris)}>
        <div data-intro-bloom aria-hidden className={styles.bloom} style={{ ...HIDDEN, transform: 'scale(0.2)' }} />
        <div aria-hidden className={cn('absolute inset-0', styles.scan)} />

        {/* crosshair */}
        <span
          data-intro-line="x"
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-px bg-linear-to-r from-transparent via-fg/25 to-transparent"
          style={{ transform: 'scaleX(0)' }}
        />
        <span
          data-intro-line="y"
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px bg-linear-to-b from-transparent via-fg/20 to-transparent"
          style={{ transform: 'scaleY(0)' }}
        />

        {/* HUD */}
        <div data-intro-hud className="absolute left-5 top-5 flex items-center gap-2.5 sm:left-8 sm:top-7" style={HIDDEN_LOW}>
          <LogoMark className="size-7 text-accent" />
          <div className="font-mono text-[10px] uppercase leading-tight tracking-[0.2em]">
            <p className="text-fg">CLIMATIQ</p>
            <p className="text-fg-subtle">Heat intelligence · India</p>
          </div>
        </div>
        <div
          data-intro-hud
          aria-hidden
          className="absolute right-5 top-5 hidden text-right font-mono text-[10px] uppercase leading-tight tracking-[0.2em] text-fg-subtle sm:right-8 sm:top-7 sm:block"
          style={HIDDEN_LOW}
        >
          <p className="text-fg">ERA5 replay {reading ? `· ${reading.day}` : ''}</p>
          <p className="tabular">{reading ? `Hottest cell ${fmtLat(reading.lat)} ${fmtLon(reading.lon)}` : 'via Open-Meteo · CC BY 4.0'}</p>
        </div>
        <ul
          data-intro-hud
          aria-hidden
          className="absolute bottom-6 left-5 flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] sm:bottom-8 sm:left-8"
          style={HIDDEN_LOW}
        >
          {(
            [
              ['type', 'Typefaces'],
              ['grid', 'ERA5 heat grid'],
              ['globe', 'Globe'],
            ] as const
          ).map(([k, label]) => (
            <li key={k} className="flex items-center gap-2">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  checks[k] === 'ok' ? 'bg-accent' : checks[k] === 'off' ? 'bg-fg-subtle' : cn('ring-1 ring-fg-subtle', styles.blink),
                )}
              />
              <span className={checks[k] === 'wait' ? 'text-fg-subtle' : 'text-fg-muted'}>
                {label}
                {checks[k] === 'off' && k !== 'type' ? ' · unavailable' : ''}
              </span>
            </li>
          ))}
        </ul>

        {/* temperature readout (real ERA5 maximum; skipped when the grid is unavailable) */}
        <div data-intro-readout aria-hidden className="absolute inset-0 grid place-items-center px-6" style={HIDDEN_LOW}>
          <div className="flex flex-col items-center text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-fg-subtle sm:text-[11px]">Hottest ERA5 grid cell · daily max</p>
            <p className="mt-3 flex items-start font-display font-extrabold leading-none tabular">
              <span data-intro-num className="text-[clamp(3.4rem,15vw,8.5rem)] text-fg">
                {HEAT_MIN_C.toFixed(1)}
              </span>
              <span className="ml-1 mt-[0.35em] text-[clamp(1.2rem,4vw,2.6rem)] text-fg-muted">°C</span>
            </p>
            <div className="relative mt-5 h-1 w-[min(22rem,72vw)] overflow-hidden rounded-full bg-fg/10">
              <div data-intro-bar className="absolute inset-0" style={{ background: heatGradientCss(), clipPath: 'inset(0 100% 0 0)' }} />
            </div>
            <div className="mt-1.5 flex w-[min(22rem,72vw)] justify-between font-mono text-[10px] text-fg-subtle tabular">
              <span>{HEAT_MIN_C} °C</span>
              <span>40</span>
              <span>≥ {HEAT_MAX_C}</span>
            </div>
            <p className="mt-4 h-4 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">{reading?.day ?? ''}</p>
          </div>
        </div>

        <button
          ref={skipRef}
          data-intro-hud
          type="button"
          onClick={() => skipFn.current()}
          className="absolute bottom-6 right-5 z-20 rounded-full border border-line-strong bg-glass px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted backdrop-blur hover:text-fg sm:bottom-8 sm:right-8"
          style={HIDDEN_LOW}
        >
          Skip intro <span className="sr-only">(Escape)</span>
        </button>
      </div>

      {/* heat front on the edge of the iris */}
      <div data-intro-rim aria-hidden className={styles.rim} style={HIDDEN} />

      {/* wordmark — same type and letter boxes as the hero's, so it can land on it exactly */}
      <div data-intro-word aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center" style={HIDDEN}>
        <p data-intro-wordtext className={cn(HERO_WORDMARK_CLASS, 'text-fg')} style={{ filter: 'url(#cq-intro-haze)' }}>
          <span data-intro-wordmark className="inline-flex">
            {HALVES.map((half) => (
              <span key={half} className="inline-block">
                {half.split('').map((ch, i) => (
                  <span key={i} data-intro-letter style={{ opacity: 0 }}>
                    {ch}
                  </span>
                ))}
              </span>
            ))}
          </span>
        </p>
      </div>

      <svg aria-hidden className="pointer-events-none absolute size-0">
        <filter id="cq-intro-haze" x="-20%" y="-60%" width="140%" height="220%">
          <feTurbulence data-intro-turb type="fractalNoise" baseFrequency="0.004 0.11" numOctaves={2} seed={7} result="noise" />
          <feDisplacementMap data-intro-disp in="SourceGraphic" in2="noise" scale={90} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <p role="status" aria-live="polite" className="sr-only">
        {ready === 3 ? 'CLIMATIQ is ready' : 'Loading CLIMATIQ'}
      </p>
    </div>
  );
}
