'use client';

import { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { LogoMark } from '@/components/shell/logo';
import { onGlobeReady, pageHasGlobe, type GlobeReadyKind } from '@/components/globe/readiness';
import { INTRO_SESSION_KEY } from './constants';
import styles from './loader.module.css';

gsap.registerPlugin(useGSAP);

/** Longest we hold the intro for the globe before continuing anyway (ms, from hydration). */
const MAX_WAIT_MS = 3600;
const WORD = 'CLIMATIQ'.split('');

type Status = 'loading' | GlobeReadyKind | 'timeout';
const STATUS_TEXT: Record<Status, string> = {
  loading: 'Preparing the globe · Natural Earth land · ERA5 heat grid',
  webgl: 'Globe ready',
  fallback: 'Static globe ready · 3D is unavailable on this device',
  timeout: 'Globe still loading · continuing',
};

/**
 * Brand reveal: orbit rings draw in, the wordmark rises letter by letter, then three stacked layers
 * (sand → wine → deep wine) lift away to reveal the page. Exit waits for the reveal AND for the globe's first real
 * frame (or a 3.6 s cap) — the status line reports that real state; there is no fake percentage.
 */
export function IntroLoaderClient({ failsafeClass }: { failsafeClass: string }) {
  const root = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<() => void>(() => {});
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<Status>('loading');

  useGSAP(
    () => {
      const host = document.getElementById('cq-intro');
      if (!host || !host.hasAttribute('data-active')) {
        setDone(true);
        return;
      }
      host.classList.remove(failsafeClass); // JS is in control now
      try {
        window.sessionStorage.setItem(INTRO_SESSION_KEY, '1');
      } catch {}

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const page = document.getElementById('cq-page');
      const html = document.documentElement;
      const prevOverflow = html.style.overflow;
      page?.setAttribute('inert', '');
      html.style.overflow = 'hidden';
      skipRef.current?.focus({ preventScroll: true });

      let revealed = false;
      let ready = !pageHasGlobe();
      let exiting = false;
      let finished = false;

      const restore = () => {
        page?.removeAttribute('inert');
        html.style.overflow = prevOverflow;
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        restore();
        host.removeAttribute('data-active');
        setDone(true);
      };
      const exit = () => {
        if (exiting) return;
        exiting = true;
        const tl = gsap.timeline({ onComplete: finish });
        if (reduce) {
          tl.to(root.current, { autoAlpha: 0, duration: 0.25 });
        } else {
          tl.to('[data-intro-content]', { y: -28, autoAlpha: 0, duration: 0.4, ease: 'power2.in' }).to(
            '[data-intro-layer]',
            { yPercent: -100, duration: 0.95, ease: 'expo.inOut', stagger: { each: 0.1, from: 'end' } },
            '-=0.12',
          );
        }
      };
      exitRef.current = exit;
      const maybeExit = () => {
        if (revealed && ready) exit();
      };

      const unsub = onGlobeReady((kind) => {
        setStatus(kind);
        ready = true;
        maybeExit();
      });
      const timer = window.setTimeout(() => {
        if (!ready) setStatus('timeout');
        ready = true;
        maybeExit();
      }, MAX_WAIT_MS);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') exit();
      };
      window.addEventListener('keydown', onKey);

      const intro = gsap.timeline({
        onComplete: () => {
          revealed = true;
          maybeExit();
        },
      });
      if (reduce) {
        gsap.set('[data-intro-ring]', { strokeDashoffset: 0 });
        gsap.set('[data-intro-letter]', { y: 0, yPercent: 0 });
        gsap.set('[data-intro-fade]', { y: 0, autoAlpha: 1 });
        intro.to({}, { duration: 0.5 });
      } else {
        intro
          .to('[data-intro-ring]', { strokeDashoffset: 0, duration: 1.3, ease: 'power3.inOut', stagger: 0.14 })
          .fromTo('[data-intro-letter]', { y: 0, yPercent: 110 }, { y: 0, yPercent: 0, duration: 0.9, ease: 'expo.out', stagger: 0.055 }, 0.25)
          .to('[data-intro-fade]', { autoAlpha: 1, y: 0, duration: 0.7, ease: 'power2.out', stagger: 0.12 }, 0.85)
          .to({}, { duration: 0.25 });
      }

      return () => {
        window.clearTimeout(timer);
        window.removeEventListener('keydown', onKey);
        unsub();
        if (!finished) restore();
      };
    },
    { scope: root },
  );

  if (done) return null;

  return (
    <div ref={root} className="absolute inset-0 overflow-hidden" aria-label="CLIMATIQ intro" role="dialog" aria-modal="true">
      {/* stacked layers that lift away on exit (back → front) */}
      <div data-intro-layer className="absolute inset-0 bg-sand-200 dark:bg-[#2a000a]" aria-hidden />
      <div data-intro-layer className="absolute inset-0 bg-wine" aria-hidden />
      <div data-intro-layer className="atmosphere grain absolute inset-0">
        <div data-intro-content className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <div className="relative grid size-40 place-items-center sm:size-48">
            <svg viewBox="0 0 200 200" className="absolute inset-0 size-full text-accent" aria-hidden>
              {[92, 74, 56].map((r, i) => (
                <circle
                  key={r}
                  data-intro-ring
                  cx="100"
                  cy="100"
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.18 + i * 0.12}
                  strokeWidth={i === 2 ? 1.6 : 1}
                  pathLength={1}
                  strokeDasharray="1"
                  style={{ strokeDashoffset: 1 }}
                  transform={`rotate(${-90 + i * 40} 100 100)`}
                />
              ))}
              <ellipse
                data-intro-ring
                cx="100"
                cy="100"
                rx="30"
                ry="74"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.22"
                pathLength={1}
                strokeDasharray="1"
                style={{ strokeDashoffset: 1 }}
              />
            </svg>
            <LogoMark className="relative size-16 text-accent sm:size-20" />
          </div>

          <p className="mt-8 flex font-display text-4xl font-extrabold tracking-[0.18em] text-fg sm:text-6xl">
            <span className="sr-only">CLIMATIQ</span>
            {WORD.map((ch, i) => (
              <span key={i} className="inline-block overflow-hidden pb-1" aria-hidden>
                <span data-intro-letter className="inline-block" style={{ transform: 'translateY(110%)' }}>
                  {ch}
                </span>
              </span>
            ))}
          </p>
          <p data-intro-fade className="mt-3 font-heading text-base text-fg-muted sm:text-lg" style={{ opacity: 0, transform: 'translateY(8px)' }}>
            Understand the Heat. Anticipate the Risk.
          </p>

          <div data-intro-fade className="mt-10 flex flex-col items-center gap-2" style={{ opacity: 0, transform: 'translateY(8px)' }}>
            {/* indeterminate while waiting (never a percentage); a solid line once the globe has really loaded */}
            <span aria-hidden className="relative block h-px w-44 overflow-hidden bg-line-strong">
              {status === 'loading' ? (
                <span className={`absolute inset-y-0 left-0 w-1/3 bg-linear-to-r from-transparent via-accent to-transparent ${styles.sweep}`} />
              ) : (
                <span className="absolute inset-0 bg-accent" />
              )}
            </span>
            <p role="status" aria-live="polite" className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-subtle">
              {STATUS_TEXT[status]}
            </p>
          </div>
        </div>

        <button
          ref={skipRef}
          type="button"
          onClick={() => exitRef.current()}
          className="absolute bottom-6 right-6 z-20 rounded-full border border-line-strong bg-glass px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted backdrop-blur hover:text-fg"
        >
          Skip intro <span className="sr-only">(Escape)</span>
        </button>
      </div>
    </div>
  );
}
