import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import { PublicFooter, PublicHeader } from '@/components/public/public-chrome';
import { ConfidenceBadge, OriginTag, ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { getDb } from '@/server/db/client';
import { ancestorsOf, childrenOf, getRegionByCode } from '@/server/geo/regions';
import { forecastSeries, forecastsForDay, latestRun } from '@/server/forecasting/queries';
import { publicAdvisories } from '@/server/portal/queries';
import { fmtDate, fmtDateTime, fmtTemp, SEVERITY_META, type Severity } from '@/lib/domain';
import { SafetyActions } from '../shared';

export async function generateMetadata({ params }: PageProps<'/portal/[code]'>): Promise<Metadata> {
  const { code } = await params;
  const r = await getRegionByCode(getDb(), decodeURIComponent(code));
  return { title: r ? `${r.name} heat outlook` : 'Heat outlook' };
}

const PLAIN: Record<Severity, string> = {
  low: 'No unusual heat risk is expected.',
  moderate: 'Hot and above normal for the season. Take normal heat precautions.',
  high: 'Heatwave conditions are expected (by IMD criteria, as estimated by CLIMATIQ). Limit time in the sun and keep hydrated.',
  extreme: 'Severe heatwave conditions are expected (by IMD criteria, as estimated by CLIMATIQ). Avoid outdoor exertion and check on vulnerable people.',
};

export default async function PortalRegionPage({ params, searchParams }: PageProps<'/portal/[code]'>) {
  const { code } = await params;
  const scenario = (await searchParams).scenario === 'replay' ? 'replay' : 'live';
  const db = getDb();
  const region = await getRegionByCode(db, decodeURIComponent(code));
  if (!region) notFound();

  // Cities use their district's forecast (no city-level precision is implied).
  const ancestors = await ancestorsOf(db, region.path);
  const forecastRegion = region.level === 'city' ? (ancestors.at(-2) ?? region) : region;
  const run = await latestRun(db, scenario);
  const series = run ? await forecastSeries(db, run.id, forecastRegion.id) : [];
  const children = region.level === 'state' || region.level === 'district' ? await childrenOf(db, region.id) : [];
  const childForecasts =
    run && series[0] && region.level === 'state' ? await forecastsForDay(db, run.id, series[0].targetDate, { level: 'district', parentId: region.id }) : [];
  const advisories = await publicAdvisories(db, ancestors.map((a) => a.id));
  const peak = series.reduce<(typeof series)[number] | null>((m, f) => (!m || SEVERITY_META[f.severity].rank > SEVERITY_META[m.severity].rank || (f.severity === m.severity && f.predictedTmaxC > m.predictedTmaxC) ? f : m), null);
  const suffix = scenario === 'replay' ? '?scenario=replay' : '';

  return (
    <div className="atmosphere min-h-dvh">
      <PublicHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 pt-8">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-fg-muted">
          <Link href={`/portal${suffix}`} className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-4" aria-hidden /> India
          </Link>
          {ancestors.slice(1).map((a) => (
            <span key={a.code} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              {a.code === region.code ? (
                <span aria-current="page" className="font-semibold text-fg">
                  {a.name}
                </span>
              ) : (
                <Link href={`/portal/${a.code}${suffix}`} className="hover:text-fg">
                  {a.name}
                </Link>
              )}
            </span>
          ))}
        </nav>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <OriginTag origin="climatiq" />
          {scenario === 'replay' && <span className="rounded-md border border-dashed border-accent px-2 py-0.5 text-[11px] font-semibold uppercase text-accent">Historical replay · May 2024</span>}
        </div>
        <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight">{region.name}</h1>
        <p className="text-sm capitalize text-fg-muted">
          {region.level}
          {region.level === 'city' && forecastRegion.id !== region.id && (
            <>
              {' '}
              · <span className="normal-case">shows the forecast for {forecastRegion.name} district — conditions within the city can differ.</span>
            </>
          )}
        </p>

        {!run || !series.length ? (
          <div className="mt-6">
            <EmptyState title="No CLIMATIQ forecast for this area">
              Forecasts are produced for every state and for districts of pilot states. Check{' '}
              <a href="https://mausam.imd.gov.in" className="font-semibold text-accent" target="_blank" rel="noreferrer">
                IMD
              </a>{' '}
              for official information.
            </EmptyState>
          </div>
        ) : (
          <>
            {peak && (
              <Panel className="mt-5" title="Outlook">
                <div className="flex flex-wrap items-center gap-3">
                  <SeverityBadge severity={peak.severity} size="lg" />
                  <p className="text-lg">{PLAIN[peak.severity]}</p>
                </div>
                <p className="mt-2 text-sm text-fg-muted">
                  Highest risk on <strong className="text-fg">{fmtDate(peak.targetDate, { weekday: 'long', day: 'numeric', month: 'long' })}</strong> with a forecast maximum around{' '}
                  <strong className="text-fg">{fmtTemp(peak.predictedTmaxC, 0)}</strong> (likely range {fmtTemp(peak.lowerC, 0)}–{fmtTemp(peak.upperC, 0)}).
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <ProvenanceBadge kind="model_forecast" source={run.modelName} updated={fmtDateTime(run.createdAt)} />
                  <span>Resolution: {peak.resolution}</span>
                </div>
              </Panel>
            )}

            <Panel className="mt-4" title="Day by day" description="Forecast maximum temperature, likely range and heat-risk level">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <caption className="sr-only">Daily heat outlook for {forecastRegion.name}</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-subtle">
                      <th scope="col" className="py-2 pr-3">Day</th>
                      <th scope="col" className="py-2 pr-3">Max temp</th>
                      <th scope="col" className="py-2 pr-3">Likely range</th>
                      <th scope="col" className="py-2 pr-3">Heat risk</th>
                      <th scope="col" className="py-2">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((f) => (
                      <tr key={f.targetDate} className="border-b border-line/60">
                        <th scope="row" className="py-2 pr-3 text-left font-medium">
                          {fmtDate(f.targetDate, { weekday: 'short', day: 'numeric', month: 'short' })}
                        </th>
                        <td className="tabular py-2 pr-3 font-semibold">{fmtTemp(f.predictedTmaxC)}</td>
                        <td className="tabular py-2 pr-3 text-fg-muted">
                          {f.lowerC.toFixed(0)}–{f.upperC.toFixed(0)} °C
                        </td>
                        <td className="py-2 pr-3">
                          <SeverityBadge severity={f.severity} size="sm" />
                        </td>
                        <td className="py-2">
                          <ConfidenceBadge confidence={f.confidence} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 flex gap-2 text-xs text-fg-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                The likely range is a rough uncertainty band. Confidence is a guide based on how much the inputs agree — not a probability.
              </p>
            </Panel>
          </>
        )}

        {children.length > 0 && (
          <Panel className="mt-4" title={region.level === 'state' ? 'Districts' : 'Cities and towns'} description={region.level === 'state' && !region.isPilot ? 'District forecasts are available for pilot states only.' : undefined}>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {children.map((c) => {
                const f = childForecasts.find((x) => x.regionId === c.id);
                return (
                  <li key={c.code}>
                    <Link href={`/portal/${c.code}${suffix}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-glass-strong px-3 py-2 text-sm hover:border-accent">
                      <span className="truncate">{c.name}</span>
                      {f && <SeverityBadge severity={f.severity} size="sm" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        {advisories.length > 0 && (
          <Panel className="mt-4" title="Public advisories for this area" description="Reviewed and published by authorised officials · CLIMATIQ-generated text">
            <ul className="flex flex-col gap-3">
              {advisories.map((a) => (
                <li key={a.id} className="rounded-xl border border-line p-3">
                  <SeverityBadge severity={a.severity} size="sm" />
                  <p className="mt-1 font-semibold">{a.title}</p>
                  <p className="text-sm text-fg-muted">{a.summary}</p>
                  {a.actions.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {a.actions.map((x, i) => (
                        <li key={i}>{x.action}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <SafetyActions />
      </main>
      <PublicFooter />
    </div>
  );
}
