import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  BellRing,
  ClipboardCheck,
  Cpu,
  ExternalLink,
  Eye,
  Gauge,
  Megaphone,
  Mountain,
  ShieldAlert,
  Siren,
  Sun,
  Waves,
} from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/shell/logo';
import { OriginTag, SeverityBadge } from '@/components/ui/badges';
import { buttonClass } from '@/components/ui/primitives';
import { INCIDENT_STATUS_META, type Severity } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { PatternBackdrop } from './pattern-backdrop';
import { Reveal } from './reveal';

export const IMD_URL = 'https://mausam.imd.gov.in';

export function SectionHeading({
  eyebrow,
  title,
  children,
  id,
  align = 'left',
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  id: string;
  align?: 'left' | 'center';
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      <p data-reveal className="text-[11px] font-semibold uppercase tracking-[0.26em] text-accent">
        {eyebrow}
      </p>
      <h2 data-reveal="split" id={id} className="mt-3 font-heading text-[clamp(1.9rem,3.6vw,3rem)] font-semibold leading-[1.08] tracking-tight">
        {title}
      </h2>
      {children && (
        <div data-reveal className="mt-4 text-[15px] leading-relaxed text-fg-muted sm:text-base">
          {children}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── (a) What CLIMATIQ is ─────────────────────────
const PILLARS = [
  {
    icon: Eye,
    title: 'Understand the heat',
    text: 'Real reanalysis and forecast data for every state and pilot district, each value labelled with what kind of data it is and where it came from.',
  },
  {
    icon: Gauge,
    title: 'Anticipate the risk',
    text: 'A transparent seven-day baseline model turns that data into Low / Moderate / High / Extreme heat-risk levels with visible uncertainty.',
  },
  {
    icon: Siren,
    title: 'Coordinate the response',
    text: 'Alerts, AI-drafted advisories with human approval, and an incident workflow that connects officials and field teams.',
  },
];

export function AboutSection() {
  return (
    <Reveal as="section" id="about" className="relative scroll-mt-24 overflow-hidden px-4 py-24 sm:px-6 sm:py-32">
      <PatternBackdrop variant="grid" intensity={0.8} fade="radial" />
      <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div>
          <SectionHeading eyebrow="What CLIMATIQ is" title="A decision-support layer for India's heat season." id="about-title">
            <p>
              CLIMATIQ brings heat data, forecasts and response coordination into one place for state and district officials,
              disaster-management teams and the public. It helps people <em>prepare</em> — it does not replace the
              India Meteorological Department.
            </p>
          </SectionHeading>
          <div data-reveal className="mt-8 rounded-2xl border border-accent/30 bg-accent-soft p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold text-fg">Not an official warning service</p>
                <p className="mt-1 text-fg-muted">
                  CLIMATIQ is a hackathon prototype. Its forecasts and advisories are model-generated and always marked
                  <span className="mx-1 inline-block align-middle">
                    <OriginTag origin="climatiq" />
                  </span>
                  Official heatwave warnings for India are issued by IMD.
                </p>
                <a
                  href={IMD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 font-semibold text-accent underline-offset-4 hover:underline"
                >
                  Official warnings at mausam.imd.gov.in <ExternalLink className="size-3.5" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </div>
            </div>
          </div>
        </div>
        <ol className="grid gap-4 self-center">
          {PILLARS.map((p, i) => (
            <li key={p.title} data-reveal className="glass group relative flex gap-4 rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5">
              <span className="font-display text-sm font-bold text-accent/60 tabular">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <p className="flex items-center gap-2 font-heading text-lg font-semibold">
                  <p.icon className="size-5 text-accent" aria-hidden /> {p.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{p.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Reveal>
  );
}

// ───────────────────────── (d) Heatwave intelligence ─────────────────────────
const ZONES = [
  { icon: Sun, zone: 'Plains', threshold: 40 },
  { icon: Waves, zone: 'Coastal', threshold: 37 },
  { icon: Mountain, zone: 'Hills', threshold: 30 },
];

const MAPPING: { level: Severity; rule: ReactNode; imd: string }[] = [
  { level: 'extreme', rule: <>Base threshold met and ≥ 6.5 °C above normal, or (plains) Tmax ≥ 47 °C</>, imd: 'IMD severe-heatwave criteria' },
  { level: 'high', rule: <>Base threshold met and 4.5–6.4 °C above normal, or (plains) Tmax ≥ 45 °C</>, imd: 'IMD heatwave criteria' },
  { level: 'moderate', rule: <>Base threshold met and ≥ 2.5 °C above normal</>, imd: 'CLIMATIQ “approaching heatwave” band — not an IMD category' },
  { level: 'low', rule: <>None of the above</>, imd: '—' },
];

export function HeatIntelligenceSection() {
  return (
    <Reveal as="section" id="heat-intelligence" className="relative scroll-mt-24 overflow-hidden px-4 py-24 sm:px-6 sm:py-32">
      <PatternBackdrop variant="contour" intensity={0.7} fade="radial" />
      <div className="relative mx-auto max-w-6xl">
        <SectionHeading eyebrow="Heatwave intelligence" title="How a hot day becomes a heatwave." id="heat-title">
          <p>
            IMD decides whether it is a heatwave from two things: how hot the day is, and how far that is above normal for
            the place and season. CLIMATIQ evaluates the same criteria on its forecasts and maps them to four risk levels.
          </p>
        </SectionHeading>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          <div data-reveal className="glass rounded-3xl p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-subtle">Step 1 · hot enough to count?</p>
            <ul className="mt-4 space-y-3">
              {ZONES.map((z) => (
                <li key={z.zone} className="flex items-center gap-3">
                  <z.icon className="size-5 text-accent" aria-hidden />
                  <span className="flex-1 font-medium">{z.zone}</span>
                  <span className="font-display text-xl font-bold tabular">
                    ≥ <span data-count>{z.threshold}</span> °C
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-fg-muted">Daily maximum temperature (Tmax) must reach the base threshold for the region type.</p>
          </div>
          <div data-reveal className="glass rounded-3xl p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-subtle">Step 2 · how far above normal?</p>
            <dl className="mt-4 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-medium">Heatwave</dt>
                <dd className="font-display text-xl font-bold tabular">
                  +<span data-count>4.5</span> to +<span data-count>6.4</span> °C
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-medium">Severe heatwave</dt>
                <dd className="font-display text-xl font-bold tabular">
                  &gt; +<span data-count>6.4</span> °C
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-fg-muted">The departure of Tmax from the normal for that day of the year.</p>
          </div>
          <div data-reveal className="glass rounded-3xl p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-subtle">Or · extreme heat outright (plains)</p>
            <dl className="mt-4 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-medium">Heatwave</dt>
                <dd className="font-display text-xl font-bold tabular">
                  ≥ <span data-count>45</span> °C
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-medium">Severe heatwave</dt>
                <dd className="font-display text-xl font-bold tabular">
                  ≥ <span data-count>47</span> °C
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-fg-muted">Absolute Tmax, regardless of the normal.</p>
          </div>
        </div>

        <div data-reveal className="mt-8 overflow-hidden rounded-3xl border border-line bg-bg-elevated/70">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
            <h3 className="font-heading text-lg font-semibold">How CLIMATIQ maps the criteria to risk levels</h3>
            <OriginTag origin="climatiq" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">CLIMATIQ heat-risk levels and the IMD criteria they are derived from</caption>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                  <th scope="col" className="px-5 py-3 font-medium">CLIMATIQ level</th>
                  <th scope="col" className="px-5 py-3 font-medium">Rule (on forecast Tmax)</th>
                  <th scope="col" className="px-5 py-3 font-medium">Relation to IMD</th>
                </tr>
              </thead>
              <tbody>
                {MAPPING.map((m) => (
                  <tr key={m.level} className="border-t border-line align-top">
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <SeverityBadge severity={m.level} />
                    </th>
                    <td className="px-5 py-3">{m.rule}</td>
                    <td className="px-5 py-3 text-fg-muted">{m.imd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-4 text-xs leading-relaxed text-fg-muted">
            CLIMATIQ levels are <strong className="text-fg">derived from</strong> IMD criteria; they are not official IMD categories.
            IMD declares heatwaves from station observations (typically when the criteria hold at two or more stations on two
            consecutive days); CLIMATIQ applies the thresholds to modelled district values, and measures departures against a
            five-year ERA5 reference climatology rather than IMD&apos;s official normals — so results are an approximation.{' '}
            <Link href="/methodology" className="font-semibold text-accent underline-offset-4 hover:underline">
              Read the methodology
            </Link>
            {' · '}
            <a href={IMD_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline-offset-4 hover:underline">
              IMD official warnings<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      </div>
    </Reveal>
  );
}

// ───────────────────────── (e) Response coordination ─────────────────────────
const FLOW = [
  { icon: Cpu, title: 'Forecast run', text: 'baseline-v1 issues seven-day district forecasts with severity, interval and confidence.' },
  { icon: BellRing, title: 'Alert rules', text: 'Severity and confidence thresholds raise alerts — de-duplicated per region, day and level, with cooldowns.' },
  { icon: Megaphone, title: 'Advisory', text: 'AI drafts audience-specific advice; an authorised official reviews and approves before anything is published.' },
  { icon: Siren, title: 'Incident', text: 'The response CRM assigns an owner, team, priority and tasks, and tracks progress to closure.' },
  { icon: ClipboardCheck, title: 'Verify & audit', text: 'Forecasts are scored against what happened; every change lands in the audit log.' },
];

export function ResponseSection() {
  const statuses = Object.values(INCIDENT_STATUS_META).sort((a, b) => a.order - b.order);
  return (
    <Reveal as="section" id="response" className="relative scroll-mt-24 overflow-hidden px-4 py-24 sm:px-6 sm:py-32">
      <div className="relative mx-auto max-w-6xl">
        <SectionHeading eyebrow="Response coordination" title="A forecast is only useful if someone acts on it." id="response-title">
          <p>
            CLIMATIQ connects the heat signal to the people who respond — with humans approving every public message and
            every step on the record.
          </p>
        </SectionHeading>

        <ol className="relative mt-14 grid gap-4 md:grid-cols-5 md:gap-3">
          <span data-reveal="line" aria-hidden className="absolute left-0 right-0 top-[26px] hidden h-px bg-linear-to-r from-accent/10 via-accent/60 to-accent/10 md:block" />
          <span aria-hidden className="absolute bottom-6 left-[26px] top-6 w-px bg-linear-to-b from-accent/10 via-accent/60 to-accent/10 md:hidden" />
          {FLOW.map((s, i) => (
            <li key={s.title} data-reveal className="relative flex gap-4 md:flex-col md:gap-3">
              <span className="relative z-10 grid size-[52px] shrink-0 place-items-center rounded-2xl border border-line-strong bg-bg-elevated text-accent shadow-glass">
                <s.icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Step {i + 1}</p>
                <p className="font-heading text-base font-semibold">{s.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <div data-reveal className="glass mt-12 rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-heading font-semibold">Incident lifecycle</p>
            <Link href="/response" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
              Open the response CRM <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <ol className="mt-4 flex flex-wrap items-center gap-2" aria-label="Incident statuses in order">
            {statuses.map((s, i) => (
              <li key={s.label} className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-semibold',
                    i === 2 ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong text-fg-muted',
                  )}
                >
                  {s.label}
                </span>
                {i < statuses.length - 1 && <ArrowRight className="size-3.5 text-fg-subtle" aria-hidden />}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-fg-subtle">Demo incidents, teams and people are fictional. Access is scoped by role and region.</p>
        </div>
      </div>
    </Reveal>
  );
}

// ───────────────────────── (f) Final CTA ─────────────────────────
export function FinalCta() {
  return (
    <Reveal as="section" id="get-started" className="relative px-4 pb-24 pt-8 sm:px-6">
      <div
        data-reveal
        className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-line-strong bg-[linear-gradient(180deg,#fdf9ef_0%,#f5ebd0_60%,#eddcb0_100%)] px-6 py-16 text-center text-fg shadow-[0_40px_100px_-50px_rgba(74,0,18,0.4)] sm:px-12 sm:py-20 dark:bg-none dark:bg-bg-elevated"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <PatternBackdrop variant="contour" intensity={1.1} fade="radial" />
          <div className="absolute -bottom-1/2 left-1/2 h-full w-[80%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(217,103,43,0.22),transparent)] blur-2xl" />
        </div>
        <div className="relative">
          <LogoMark className="mx-auto size-12 text-accent" />
          <h2 data-reveal="split" className="mt-5 font-display text-[clamp(1.6rem,4vw,3rem)] font-bold tracking-[0.06em] text-accent">
            Understand the Heat. Anticipate the Risk.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-fg-muted">
            Explore the May 2024 replay in the command center, or see what the public sees on the portal.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/command" className={buttonClass('primary', 'lg', 'group px-7')}>
              Explore Dashboard <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link href="/portal" className={buttonClass('secondary', 'lg')}>
              Public portal
            </Link>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

// ───────────────────────── (g) Footer ─────────────────────────
export function SiteFooter() {
  return (
    <footer className="relative border-t border-line px-4 pb-10 pt-14 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 text-accent" aria-label="CLIMATIQ home">
            <LogoMark className="size-8" />
            <Wordmark className="text-fg" />
          </Link>
          <p className="mt-3 max-w-sm text-sm text-fg-muted">
            CLIMATIQ is a prototype heatwave decision-support tool. It is <strong className="text-fg">not an official warning
            service</strong>; its forecasts and advisories are model-generated. For official heatwave warnings, consult the India
            Meteorological Department.
          </p>
          <a
            href={IMD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent underline-offset-4 hover:underline"
          >
            mausam.imd.gov.in <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
        <nav aria-label="Footer">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">Explore</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-1">
            {[
              ['/command', 'Command center'],
              ['/features', 'Features'],
              ['/portal', 'Public portal'],
              ['/methodology', 'Methodology'],
              ['/login', 'Sign in'],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="text-fg-muted hover:text-fg">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">Data & attribution</p>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-fg-muted">
            <li>
              Weather data by{' '}
              <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
                Open-Meteo.com
              </a>{' '}
              (CC BY 4.0) · ERA5 (Copernicus)
            </li>
            <li>Boundaries: geoBoundaries (CC BY 2.5 IN / ODbL) — not authenticated by Survey of India</li>
            <li>Places © GeoNames (CC BY 4.0)</li>
            <li>Globe land: Natural Earth (public domain)</li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-fg-subtle">
        <p>© {new Date().getFullYear()} CLIMATIQ · hackathon prototype · demo incidents, teams and people are fictional.</p>
        <p>Severity levels are derived from IMD criteria and are not official IMD categories.</p>
      </div>
    </footer>
  );
}
