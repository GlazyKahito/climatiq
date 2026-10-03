import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ExternalLink, Info, ShieldCheck } from 'lucide-react';
import { PublicFooter, PublicHeader } from '@/components/public/public-chrome';
import { IndiaSvgMap } from '@/components/public/india-svg-map';
import { OriginTag, ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { getDb } from '@/server/db/client';
import { forecastsForDay, latestRun } from '@/server/forecasting/queries';
import { publicAdvisories, verifiedOfficialWarnings } from '@/server/portal/queries';
import { addDays, fmtDate, fmtDateTime, SEVERITY_META, type Severity } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { SafetyActions, UnderstandingOutlook } from './shared';

export const metadata: Metadata = {
  title: 'Public heat outlook',
  description: 'Plain-language heat-risk outlook for India from CLIMATIQ (prototype decision support, not an official warning).',
};

export default async function PortalPage({ searchParams }: PageProps<'/portal'>) {
  const sp = await searchParams;
  const scenario = sp.scenario === 'replay' ? 'replay' : 'live';
  const db = getDb();
  const run = await latestRun(db, scenario);
  const days = run ? Array.from({ length: Math.min(run.horizonDays, 5) }, (_, i) => addDays(run.issuedFor, i + 1)) : [];
  const day = typeof sp.day === 'string' && days.includes(sp.day) ? sp.day : days[0];
  const [states, districts, advisories, warnings] = await Promise.all([
    run && day ? forecastsForDay(db, run.id, day, { level: 'state' }) : Promise.resolve([]),
    run && day ? forecastsForDay(db, run.id, day, { level: 'district' }) : Promise.resolve([]),
    publicAdvisories(db),
    verifiedOfficialWarnings(db),
  ]);
  const values = Object.fromEntries(states.map((s) => [s.code, { severity: s.severity, tmax: s.predictedTmaxC }]));
  const rank = (s: Severity) => SEVERITY_META[s].rank;
  const hotspots = [...districts, ...states.filter((s) => !s.isPilot)]
    .sort((a, b) => rank(b.severity) - rank(a.severity) || b.predictedTmaxC - a.predictedTmaxC)
    .slice(0, 10);
  const elevated = states.filter((s) => rank(s.severity) >= 2).length + districts.filter((d) => rank(d.severity) >= 2).length;
  const q = (extra: Record<string, string>) => `/portal?${new URLSearchParams({ ...(scenario === 'replay' ? { scenario } : {}), ...extra })}`;

  return (
    <div className="atmosphere min-h-dvh">
      <PublicHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 pt-8">
        <section aria-labelledby="portal-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <OriginTag origin="climatiq" />
            {scenario === 'replay' && (
              <span className="rounded-md border border-dashed border-accent px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">Historical replay · May 2024</span>
            )}
          </div>
          <h1 id="portal-title" className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            {scenario === 'replay' ? 'How the May 2024 heatwave looked in CLIMATIQ' : 'Heat outlook for India'}
          </h1>
          <p className="max-w-3xl text-fg-muted">
            {scenario === 'replay'
              ? 'A look back at a real event: CLIMATIQ’s forecast as it would have been made on 26 May 2024, using only information available then. This is history, not a current warning.'
              : 'Where the next few days are expected to be unusually hot, in plain language. CLIMATIQ is a prototype — always follow official IMD and disaster-management advice.'}
          </p>
          {run && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <ProvenanceBadge kind="model_forecast" source={`${run.modelName}`} updated={fmtDateTime(run.createdAt)} />
              <span>Forecast issued for {fmtDate(run.issuedFor)} · updated {fmtDateTime(run.createdAt)}</span>
            </div>
          )}
          <p className="text-sm">
            {scenario === 'live' ? (
              <Link href="/portal?scenario=replay" className="font-semibold text-accent hover:underline">
                See the May 2024 heatwave replay →
              </Link>
            ) : (
              <Link href="/portal" className="font-semibold text-accent hover:underline">
                ← Back to today&apos;s outlook
              </Link>
            )}
          </p>
        </section>

        {!run || !day ? (
          <div className="mt-8">
            <EmptyState title="No forecast is available right now">
              The latest data could not be loaded. Please check the official IMD website for current conditions.
            </EmptyState>
          </div>
        ) : (
          <>
            <nav aria-label="Forecast day" className="mt-6 flex flex-wrap gap-2">
              {days.map((d, i) => (
                <Link
                  key={d}
                  href={q({ day: d })}
                  aria-current={d === day ? 'date' : undefined}
                  className={cn('rounded-xl border px-3 py-1.5 text-sm font-medium', d === day ? 'border-accent bg-wine text-sand dark:bg-accent dark:text-accent-fg' : 'border-line bg-glass-strong text-fg-muted hover:text-fg')}
                >
                  {i === 0 ? 'Tomorrow' : fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}
                </Link>
              ))}
            </nav>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <Panel title={`Heat risk by state · ${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}`} description="Tap a state for its outlook. Colours follow the legend; every state also has a text label.">
                <IndiaSvgMap values={values} hrefFor={(code) => `/portal/${code}${scenario === 'replay' ? '?scenario=replay' : ''}`} caption={`Map of India coloured by CLIMATIQ heat-risk level for ${fmtDate(day)}. State values are estimated at one point per state; districts are available for pilot states.`} />
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Legend">
                  {(['low', 'moderate', 'high', 'extreme'] as Severity[]).map((s) => (
                    <li key={s} className="flex items-center gap-1.5 text-xs">
                      <span aria-hidden className="size-3 rounded-sm" style={{ background: `var(--sev-${s})`, opacity: s === 'low' ? 0.45 : 0.9 }} />
                      <SeverityBadge severity={s} size="sm" />
                    </li>
                  ))}
                </ul>
              </Panel>

              <div className="flex flex-col gap-4">
                <Panel title="At a glance">
                  <p className="text-lg">
                    {elevated === 0 ? (
                      <>No state or pilot district reaches the CLIMATIQ <strong>High</strong> heat-risk level on this day.</>
                    ) : (
                      <>
                        <strong className="font-display text-2xl text-accent">{elevated}</strong> areas are at <strong>High</strong> or <strong>Extreme</strong> heat risk on this day.
                      </>
                    )}
                  </p>
                </Panel>
                <Panel title="Hottest areas" description="Districts are shown for pilot states; other states at state level.">
                  <ol className="flex flex-col divide-y divide-line">
                    {hotspots.map((h) => (
                      <li key={h.code}>
                        <Link href={`/portal/${h.code}${scenario === 'replay' ? '?scenario=replay' : ''}`} className="flex items-center gap-3 py-2 hover:text-accent">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{h.name}</span>
                            <span className="block text-xs capitalize text-fg-muted">{h.level}</span>
                          </span>
                          <span className="tabular text-sm">{h.predictedTmaxC.toFixed(0)} °C</span>
                          <SeverityBadge severity={h.severity} size="sm" />
                          <ArrowRight className="size-4 text-fg-subtle" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ol>
                </Panel>
              </div>
            </div>
          </>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title="Official warnings" description="From the India Meteorological Department (IMD)">
            {warnings.length ? (
              <ul className="flex flex-col gap-2">
                {warnings.map((w) => (
                  <li key={w.id} className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-[#1d4f7a]" aria-hidden />
                    <a className="font-medium hover:underline" href={w.url} target="_blank" rel="noreferrer">
                      {w.title} — {w.region}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex gap-2 text-sm text-fg-muted">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  CLIMATIQ does not currently receive IMD warnings automatically (IMD&apos;s data service requires an approved account). Please check{' '}
                  <a href="https://mausam.imd.gov.in" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-accent hover:underline">
                    mausam.imd.gov.in <ExternalLink className="size-3" aria-hidden />
                  </a>{' '}
                  for official heatwave warnings.
                </span>
              </p>
            )}
          </Panel>
          <Panel title="Public advisories" description="Published by authorised officials after review · CLIMATIQ-generated text">
            {advisories.length ? (
              <ul className="flex flex-col gap-3">
                {advisories.map((a) => (
                  <li key={a.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={a.severity} size="sm" />
                      <span className="text-xs text-fg-muted">
                        Valid {fmtDate(a.validFrom)} – {fmtDate(a.validTo)}
                      </span>
                    </div>
                    <p className="mt-1 font-semibold">{a.title}</p>
                    <p className="mt-1 text-sm text-fg-muted">{a.summary}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">No public advisories are currently published.</p>
            )}
          </Panel>
        </div>

        <SafetyActions />
        <UnderstandingOutlook />
      </main>
      <PublicFooter />
    </div>
  );
}
