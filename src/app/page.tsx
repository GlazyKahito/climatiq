import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { GlobePoster } from '@/components/globe/globe-poster';
import { formatGridDay } from '@/components/globe/heat-grid';
import { ClimateOverviewSkeleton, ClimateOverviewView, OverviewCta } from '@/components/landing/climate-overview';
import { FeaturePreview } from '@/components/landing/feature-previews';
import { FeatureShowcase } from '@/components/landing/feature-showcase';
import { FEATURES, type FeatureId } from '@/components/landing/features-data';
import { PatternBackdrop } from '@/components/landing/pattern-backdrop';
import { Reveal } from '@/components/landing/reveal';
import { ScrollHero } from '@/components/landing/scroll-hero';
import { AboutSection, FinalCta, HeatIntelligenceSection, ResponseSection, SectionHeading, SiteFooter } from '@/components/landing/sections';
import { SiteNav } from '@/components/landing/site-nav';
import { SmoothScroll } from '@/components/landing/smooth-scroll';
import { IntroLoader } from '@/components/loader/intro-loader';
import { getDb } from '@/server/db/client';
import { getLandingArt } from '@/server/landing/geo-art';
import { getLandingSummary, type LandingSummary } from '@/server/landing/summary';

export const metadata: Metadata = {
  title: { absolute: 'CLIMATIQ — Understand the Heat. Anticipate the Risk.' },
  description:
    'CLIMATIQ is an AI-assisted heatwave decision-support prototype for India: real ERA5 and Open-Meteo data, a transparent forecast model, human-approved advisories and response coordination. Not an official warning service.',
};

export default async function Home() {
  const art = await getLandingArt();
  const heatLabel = art.heat ? `ERA5 Tmax · ${formatGridDay(art.heat.day)}` : null;
  const previews = Object.fromEntries(
    FEATURES.map((f) => [f.id, <FeaturePreview key={f.id} id={f.id} india={art.india} heatLabel={heatLabel} />]),
  ) as Record<FeatureId, ReactNode>;

  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-[110] rounded-lg bg-wine px-4 py-2 text-sand focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <IntroLoader />
      <SmoothScroll />
      <div id="cq-page" className="relative overflow-x-clip">
        <SiteNav />
        <main id="main-content" tabIndex={-1} className="outline-none">
          <ScrollHero poster={<GlobePoster art={art.globe} diameter="var(--poster-d)" />} />
          <AboutSection />
          <OverviewSection />
          <FeatureShowcase features={FEATURES} previews={previews} />
          <HeatIntelligenceSection />
          <ResponseSection />
          <FinalCta />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}

function OverviewSection() {
  return (
    <Reveal as="section" id="overview" className="relative scroll-mt-24 overflow-hidden px-4 py-24 sm:px-6 sm:py-28">
      <PatternBackdrop variant="contour" intensity={0.5} fade="radial" />
      <div className="relative mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading eyebrow="Climate overview" title="The heat picture, straight from the database." id="overview-title">
            <p>
              Two scenarios side by side: a <strong className="text-fg">historical replay</strong> of the late-May 2024 heatwave
              (real ERA5 reanalysis with CLIMATIQ hindcasts) and today&apos;s <strong className="text-fg">live</strong> run. Each
              shows the first forecast day of its latest run.
            </p>
          </SectionHeading>
          <div data-reveal>
            <OverviewCta />
          </div>
        </div>
        <div data-reveal="clip" className="mt-10 rounded-3xl">
          <Suspense fallback={<ClimateOverviewSkeleton />}>
            <OverviewData />
          </Suspense>
        </div>
      </div>
    </Reveal>
  );
}

async function OverviewData() {
  await connection();
  let summary: LandingSummary | null = null;
  try {
    summary = await getLandingSummary(getDb());
  } catch (err) {
    console.error('[landing] climate overview unavailable:', err instanceof Error ? err.message : err);
  }
  return <ClimateOverviewView summary={summary} />;
}
