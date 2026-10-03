'use client';

import Link from 'next/link';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, BookOpenText, ChartSpline, Check, Globe2, Megaphone, Radar, RadioTower, Siren, ThermometerSun, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Feature, FeatureId } from './features-data';
import { PatternBackdrop } from './pattern-backdrop';
import styles from './landing.module.css';

const ICONS: Record<Feature['icon'], LucideIcon> = { Radar, ThermometerSun, RadioTower, Megaphone, Siren, ChartSpline, Globe2, BookOpenText };

/**
 * Cinematic platform showcase (original; inspired by the 21st.dev "prisma-hero" pattern): a dark full-width stage,
 * a headline whose words pull up into place, a floating pill rail and a feature stage that cross-fades.
 * Motion for React drives all of it (no GSAP here). Light Sand first (cream stage, Wine Red accents, ink text); the
 * night-stage look applies only under [data-theme=dark].
 */
export function FeatureShowcase({
  features,
  previews,
  headline = 'From a heat signal to a coordinated response.',
}: {
  features: Feature[];
  previews: Record<FeatureId, ReactNode>;
  headline?: string;
}) {
  const [active, setActive] = useState<FeatureId>(features[0].id);
  const reduce = useReducedMotion();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const feature = features.find((f) => f.id === active) ?? features[0];
  const words = headline.split(' ');

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = features.findIndex((f) => f.id === active);
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % features.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + features.length) % features.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = features.length - 1;
    else return;
    e.preventDefault();
    setActive(features[next].id);
    tabs.current[next]?.focus();
    tabs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
  };

  const Icon = ICONS[feature.icon];

  return (
    <section id="platform" aria-labelledby="platform-title" className="relative scroll-mt-24 px-3 py-6 sm:px-5">
      <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[2rem] border border-line-strong bg-[radial-gradient(ellipse_at_50%_0%,#fdf9ef_0%,#f5ebd0_55%,#eddcb0_100%)] text-fg shadow-[0_40px_120px_-50px_rgba(74,0,18,0.35)] dark:bg-none dark:bg-[#0e0408] dark:shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)]">
        {/* cinematic light: wine bloom, horizon glow, isotherm texture, film grain */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-1/3 left-1/2 h-[70%] w-[90%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(127,1,31,0.10),transparent)] blur-2xl dark:bg-[radial-gradient(closest-side,rgba(226,74,103,0.28),transparent)]" />
          <div className="absolute -bottom-1/4 left-0 h-[60%] w-[70%] rounded-full bg-[radial-gradient(closest-side,rgba(217,103,43,0.14),transparent)] blur-2xl" />
          <PatternBackdrop variant="contour" intensity={0.55} fade="radial" className="dark:hidden" />
          <div className={cn('absolute inset-0 hidden opacity-50 dark:block', styles.starsFar)} />
          <div className="grain absolute inset-0" />
        </div>

        <div className="relative px-5 pb-8 pt-14 sm:px-10 sm:pt-20 lg:px-14">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-accent">The platform</p>
          {/* the observer sits on the heading: the word spans are clipped by their masks, so they never "intersect" */}
          <motion.h2
            id="platform-title"
            className="mx-auto mt-4 max-w-4xl text-center font-heading text-[clamp(2rem,4.6vw,3.9rem)] font-semibold leading-[1.05] tracking-tight"
            initial={reduce ? false : 'hidden'}
            whileInView="shown"
            viewport={{ once: true, amount: 0.4 }}
            transition={{ staggerChildren: 0.06 }}
          >
            {words.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                <motion.span
                  className="inline-block"
                  variants={{ hidden: { y: '105%', opacity: 0 }, shown: { y: '0%', opacity: 1 } }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                >
                  {w}
                  {i < words.length - 1 ? ' ' : ''}
                </motion.span>
              </span>
            ))}
          </motion.h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-fg-muted">
            Eight connected modules — from the national heat picture to the incident on the ground. Pick one to look inside.
          </p>

          {/* floating pill rail */}
          <div className="mt-8 flex justify-center">
            <div
              role="tablist"
              aria-label="CLIMATIQ modules"
              onKeyDown={onKey}
              className={cn('glass flex max-w-full gap-1 overflow-x-auto rounded-full p-1.5', styles.rail)}
            >
              {features.map((f, i) => {
                const TabIcon = ICONS[f.icon];
                const selected = f.id === active;
                return (
                  <button
                    key={f.id}
                    ref={(el) => {
                      tabs.current[i] = el;
                    }}
                    role="tab"
                    type="button"
                    id={`tab-${f.id}`}
                    aria-selected={selected}
                    aria-controls={`panel-${f.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(f.id)}
                    className={cn(
                      'relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                      selected ? 'text-accent-fg' : 'text-fg-muted hover:text-fg',
                    )}
                  >
                    {selected && (
                      <motion.span
                        layoutId="cq-pill"
                        className="absolute inset-0 rounded-full bg-accent"
                        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
                        aria-hidden
                      />
                    )}
                    <TabIcon className="relative size-4" aria-hidden />
                    <span className="relative whitespace-nowrap">{f.short}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* stage */}
          <div
            role="tabpanel"
            id={`panel-${feature.id}`}
            aria-labelledby={`tab-${feature.id}`}
            className="mt-8 grid items-stretch gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`copy-${feature.id}`}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                className="flex flex-col justify-center py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-accent/15 text-accent">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">{feature.kicker}</p>
                    <h3 className="font-heading text-2xl font-semibold">{feature.title}</h3>
                  </div>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">{feature.summary}</p>
                <ul className="mt-4 space-y-2">
                  {feature.bullets.slice(0, 3).map((b) => (
                    <li key={b} className="flex gap-2 text-sm text-fg">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    href={feature.href}
                    className="group inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:brightness-110"
                  >
                    Open {feature.short.toLowerCase()}
                    <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                  <Link href={`/features#${feature.id}`} className="text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                    Details
                  </Link>
                  <span className="text-[11px] uppercase tracking-wide text-fg-subtle">{feature.access}</span>
                </div>
              </motion.div>
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`preview-${feature.id}`}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, filter: 'blur(6px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.99, filter: 'blur(4px)' }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
                className="flex min-h-[300px] lg:min-h-[340px] [&>*]:flex-1"
              >
                {previews[feature.id]}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
