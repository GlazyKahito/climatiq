import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, BookOpenText, ChartSpline, Check, Database, Globe2, KeyRound, Megaphone, Radar, RadioTower, Siren, ThermometerSun, type LucideIcon } from 'lucide-react';
import { formatGridDay } from '@/components/globe/heat-grid';
import { FeaturePreview } from '@/components/landing/feature-previews';
import { FEATURES, type Feature } from '@/components/landing/features-data';
import { PatternBackdrop } from '@/components/landing/pattern-backdrop';
import { Reveal } from '@/components/landing/reveal';
import { FinalCta, SiteFooter } from '@/components/landing/sections';
import { SiteNav } from '@/components/landing/site-nav';
import { SmoothScroll } from '@/components/landing/smooth-scroll';
import { buttonClass } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { getLandingArt } from '@/server/landing/geo-art';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'The CLIMATIQ modules in detail: command center, heatwave prediction, weather stations, AI advisories and alerts, response CRM, climate analytics, public portal and methodology.',
};

const ICONS: Record<Feature['icon'], LucideIcon> = { Radar, ThermometerSun, RadioTower, Megaphone, Siren, ChartSpline, Globe2, BookOpenText };

export default async function FeaturesPage() {
  const art = await getLandingArt();
  const heatLabel = art.heat ? `ERA5 Tmax · ${formatGridDay(art.heat.day)}` : null;

  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-[110] rounded-lg bg-wine px-4 py-2 text-sand focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SmoothScroll />
      <div className="relative overflow-x-clip">
        <SiteNav />
        <main id="main-content" tabIndex={-1} className="outline-none">
          <Reveal as="section" className="atmosphere grain relative overflow-hidden px-4 pb-16 pt-36 sm:px-6 sm:pt-44">
            <PatternBackdrop variant="contour" intensity={0.9} fade="radial" />
            <div className="relative mx-auto max-w-6xl">
              <p data-reveal className="text-[11px] font-semibold uppercase tracking-[0.26em] text-accent">
                Features
              </p>
              <h1 data-reveal="split" className="mt-3 max-w-4xl font-heading text-[clamp(2.2rem,5vw,4rem)] font-semibold leading-[1.04] tracking-tight">
                Everything CLIMATIQ does — and what powers each part.
              </h1>
              <p data-reveal className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted sm:text-lg">
                Eight modules that take a heat signal from real reanalysis and forecast data to an approved advisory and a
                coordinated response. Every module states what kind of data it shows, and nothing CLIMATIQ generates is
                presented as an official warning.
              </p>
              <nav data-reveal aria-label="Features on this page" className="mt-8">
                <ul className="flex flex-wrap gap-2">
                  {FEATURES.map((f) => {
                    const Icon = ICONS[f.icon];
                    return (
                      <li key={f.id}>
                        <a
                          href={`#${f.id}`}
                          className="glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
                        >
                          <Icon className="size-4 text-accent" aria-hidden /> {f.short}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </Reveal>

          {FEATURES.map((f, i) => {
            const Icon = ICONS[f.icon];
            const flip = i % 2 === 1;
            return (
              <Reveal
                key={f.id}
                as="section"
                id={f.id}
                className={cn('relative scroll-mt-24 overflow-hidden px-4 py-16 sm:px-6 sm:py-24', i % 2 === 1 && 'bg-bg-elevated/50')}
              >
                <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14" aria-labelledby={`${f.id}-title`}>
                  <div className={cn(flip && 'lg:order-2')}>
                    <div data-reveal className="flex items-center gap-3">
                      <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-subtle">
                          {String(i + 1).padStart(2, '0')} · {f.kicker}
                        </p>
                        <h2 id={`${f.id}-title`} data-reveal="split" className="font-heading text-2xl font-semibold sm:text-3xl">
                          {f.title}
                        </h2>
                      </div>
                    </div>
                    <p data-reveal className="mt-5 text-[15px] leading-relaxed text-fg-muted sm:text-base">
                      {f.summary}
                    </p>
                    <ul data-reveal className="mt-5 space-y-2.5">
                      {f.bullets.map((b) => (
                        <li key={b} className="flex gap-2.5 text-sm text-fg">
                          <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                    <dl data-reveal className="mt-6 grid gap-3 rounded-2xl border border-line p-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
                          <KeyRound className="size-3.5" aria-hidden /> Access
                        </dt>
                        <dd className="mt-1 font-medium">{f.access}</dd>
                      </div>
                      <div>
                        <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
                          <Database className="size-3.5" aria-hidden /> Data
                        </dt>
                        <dd className="mt-1 text-fg-muted">{f.dataNote}</dd>
                      </div>
                    </dl>
                    <div data-reveal className="mt-6">
                      <Link href={f.href} className={buttonClass('primary', 'md', 'group')}>
                        Open {f.short.toLowerCase()}
                        <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    </div>
                  </div>
                  <div data-reveal="clip" className={cn('flex min-h-[300px] rounded-3xl lg:min-h-[360px] [&>*]:flex-1', flip && 'lg:order-1')}>
                    <FeaturePreview id={f.id} india={art.india} heatLabel={heatLabel} />
                  </div>
                </div>
              </Reveal>
            );
          })}

          <FinalCta />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
