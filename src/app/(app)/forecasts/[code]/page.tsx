import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, Download, FileText, Info, Map as MapIcon } from 'lucide-react';
import { EmptyState, LinkButton, MetricCard, PageHeader, Panel } from '@/components/ui/primitives';
import { ConfidenceBadge, DemoTag, OriginTag, ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { ForecastChart, type ForecastChartPoint } from '@/components/charts/forecast-chart';
import { YearCompareChart } from '@/components/charts/year-compare-chart';
import { shortDay, t1, weekdayDay } from '@/components/charts/format';
import { FactorsByDay } from '@/components/forecast/factors-by-day';
import { ChildrenList, Limitations, OfficialWarnings, SeverityStrip } from '@/components/forecast/parts';
import { IMD_CATEGORY_TEXT, resolutionLabel, SCENARIO_LABEL, ZONE_THRESHOLD } from '@/components/forecast/labels';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { currentScenario } from '@/server/scenario';
import { ancestorsOf, getRegionByCode, type RegionSummary } from '@/server/geo/regions';
import { forecastSeries } from '@/server/forecasting/queries';
import {
  childrenSeverity,
  historicalComparison,
  imdSource,
  latestRunDetail,
  officialWarningsFor,
  recentHistory,
  windowTruth,
} from '@/server/analytics/forecast-views';
import { climateCoverage, loadNormals } from '@/server/analytics/history';
import { dayOfYear } from '@/server/forecasting/baseline';
import { can } from '@/lib/rbac';
import { addDays, fmtDate, fmtDateTime, SEVERITY_META, type DataKind } from '@/lib/domain';
import { NationalSummary } from './national';

const LEVEL_LABEL = { country: 'Country', state: 'State / UT', district: 'District', city: 'City / locality' } as const;

async function resolveRegion(code: string) {
  const clean = decodeURIComponent(code).trim().toUpperCase().slice(0, 80);
  if (!/^[A-Z0-9-]+$/.test(clean)) return null;
  return getRegionByCode(getDb(), clean);
}

export async function generateMetadata({ params }: PageProps<'/forecasts/[code]'>): Promise<Metadata> {
  const { code } = await params;
  const region = await resolveRegion(code);
  return {
    title: region ? `${region.name} · heat-risk forecast` : 'Region not found',
    description: region ? `CLIMATIQ heat-risk forecast, uncertainty and history for ${region.name}. Decision support — not an official IMD forecast.` : undefined,
  };
}

export default async function RegionForecastPage({ params }: PageProps<'/forecasts/[code]'>) {
  const user = await requirePagePermission('dashboard:view');
  const { code } = await params;
  const region = await resolveRegion(code);
  if (!region) notFound();

  const db = getDb();
  const [scenario, ancestors] = await Promise.all([currentScenario(), ancestorsOf(db, region.path)]);
  const run = await latestRunDetail(db, scenario);
  const canExport = can(user.assignments, 'analytics:export');
  const canDraft = can(user.assignments, 'advisory:generate');

  const crumbs = (
    <nav aria-label="Region hierarchy" className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
      <Link href="/forecasts" className="hover:text-fg hover:underline">
        Forecasts
      </Link>
      {ancestors.map((a, i) => (
        <span key={a.code} className="flex items-center gap-1">
          <ChevronRight className="size-3 text-fg-subtle" aria-hidden />
          {i === ancestors.length - 1 ? (
            <span aria-current="page" className="font-semibold text-fg">
              {a.name}
            </span>
          ) : (
            <Link href={`/forecasts/${a.code}`} className="hover:text-fg hover:underline">
              {a.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );

  const ctas = (
    <>
      <LinkButton href={`/command?region=${region.code}`} variant="secondary" size="sm">
        <MapIcon className="size-3.5" aria-hidden /> Open in command center
      </LinkButton>
      {canDraft && (
        <LinkButton href={`/advisories/new?region=${region.code}`} size="sm">
          <FileText className="size-3.5" aria-hidden /> Draft advisory
        </LinkButton>
      )}
    </>
  );

  if (region.level === 'country') {
    return (
      <div className="flex flex-col gap-5">
        {crumbs}
        <PageHeader eyebrow={`Heatwave prediction · ${LEVEL_LABEL.country}`} title={`${region.name} — national summary`} description={`Scenario: ${SCENARIO_LABEL[scenario]}`} actions={ctas} />
        <NationalSummary run={run} countryId={region.id} scenario={scenario} />
      </div>
    );
  }

  // Cities have no forecast of their own: show the parent district's forecast with an explicit resolution note.
  const isCity = region.level === 'city';
  const target: RegionSummary = isCity ? (ancestors.find((a) => a.level === 'district') ?? region) : region;
  const series = run ? await forecastSeries(db, run.id, target.id) : [];

  const header = (
    <>
      {crumbs}
      <PageHeader
        eyebrow={`Heatwave prediction · ${LEVEL_LABEL[region.level]}`}
        title={region.name}
        description={
          <>
            Scenario: {SCENARIO_LABEL[scenario]}
            {run && <> · issued for {fmtDate(run.issuedFor)}</>}
          </>
        }
        actions={ctas}
      />
      {isCity && (
        <div role="note" className="flex items-start gap-2.5 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <p>
            <strong>Resolution note:</strong> CLIMATIQ does not forecast at city level. You are seeing the forecast for{' '}
            <Link href={`/forecasts/${target.code}`} className="font-semibold text-accent hover:underline">
              {target.name} district
            </Link>{' '}
            (computed at the district centroid). Conditions in {region.name} can differ — urban heat-island effects often make cities hotter, especially at night.
          </p>
        </div>
      )}
    </>
  );

  if (!run || !series.length) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Panel>
          <EmptyState title={!run ? 'No forecast run is available for this scenario' : `No forecast for ${target.name} in the current run`}>
            {!run
              ? scenario === 'live'
                ? 'Live forecasts need Open-Meteo NWP and recent ERA5 history; none has been generated yet (the server may be offline). Switch to the historical replay in the top bar, or start a live run from the Forecasts page.'
                : 'The replay hindcast has not been generated. Ask an administrator to re-run the demo seed.'
              : 'Forecasts cover every state/UT and the districts of the pilot states. This region is outside the current coverage.'}
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const issuedFor = run.issuedFor;
  const lastDay = series.at(-1)!.targetDate;
  const fromDay = addDays(issuedFor, -13);
  const basisKey = typeof run.params.normalsBasis === 'string' ? run.params.normalsBasis : null;
  const normalsLabel = typeof run.inputs.normals === 'string' ? run.inputs.normals : 'CLIMATIQ ERA5 reference climatology';

  const [history, truth, normals, comparison, coverage, imd, children] = await Promise.all([
    recentHistory(db, target.id, issuedFor, 14),
    windowTruth(db, target.id, addDays(issuedFor, 1), lastDay),
    basisKey ? loadNormals(db, target.id, basisKey) : Promise.resolve(new Map<number, number>()),
    historicalComparison(db, target.id, fromDay, lastDay),
    climateCoverage(db, [target.id]),
    imdSource(db),
    region.level === 'city' ? Promise.resolve([]) : childrenSeverity(db, run.id, region.id),
  ]);
  const warnings = await officialWarningsFor(db, [...new Set([region.id, target.id, ...ancestors.map((a) => a.id)])], { from: addDays(issuedFor, 1), to: lastDay });

  // ── Headline numbers ──
  const rank = (s: keyof typeof SEVERITY_META) => SEVERITY_META[s].rank;
  const peak = series.reduce((m, p) => (rank(p.severity) > rank(m.severity) || (rank(p.severity) === rank(m.severity) && p.predictedTmaxC > m.predictedTmaxC) ? p : m), series[0]);
  const d1 = series[0];
  const spell = series.reduce((m, p) => (p.durationDays > m.durationDays ? p : m), series[0]);
  const imdDays = series.filter((p) => p.imdCategory !== 'none').length;
  const severeDays = series.filter((p) => p.imdCategory === 'severe_heatwave').length;
  const zone = target.climateZone;
  const threshold = ZONE_THRESHOLD[zone];

  // ── Chart data: 14 days of reanalysis + forecast horizon on one daily axis ──
  const byDay = new Map<string, ForecastChartPoint>();
  for (let d = fromDay; d <= lastDay; d = addDays(d, 1)) {
    byDay.set(d, { day: d, reanalysis: null, predicted: null, lower: null, upper: null, nwp: null, normal: normals.get(dayOfYear(d)) ?? null, severity: null });
  }
  const realKinds = new Set<DataKind>();
  for (const h of [...history, ...truth]) {
    const p = byDay.get(h.day);
    if (p && h.tmaxC != null) {
      p.reanalysis = h.tmaxC;
      realKinds.add(h.dataKind);
    }
  }
  for (const f of series) {
    const p = byDay.get(f.targetDate);
    if (!p) continue;
    Object.assign(p, { predicted: f.predictedTmaxC, lower: f.lowerC, upper: f.upperC, nwp: f.nwpTmaxC, normal: f.normalTmaxC ?? p.normal, severity: f.severity });
  }
  const points = [...byDay.values()];
  const histKind: DataKind = realKinds.has('simulated') ? 'simulated' : realKinds.has('observed') ? 'observed' : 'reanalysis';
  const hasTruth = truth.some((t) => t.tmaxC != null);
  const lastHistory = history.filter((h) => h.tmaxC != null).at(-1)?.day ?? null;

  // ── Same-window comparison ──
  const refYear = Number(issuedFor.slice(0, 4));
  const keys: string[] = [];
  for (let d = fromDay; d <= lastDay; d = addDays(d, 1)) keys.push(d.slice(5));
  const years = comparison
    .filter((y) => y.year <= refYear)
    .map((y) => ({ ...y, atOrAbove: Object.values(y.values).filter((v) => v != null && v >= threshold).length }));
  const laterYears = comparison.filter((y) => y.year > refYear).map((y) => y.year);
  const predictedByMd = Object.fromEntries(series.map((s) => [s.targetDate.slice(5), s.predictedTmaxC]));

  const sourceBadges = (
    <>
      <ProvenanceBadge kind="model_forecast" source={run.modelKey} updated={fmtDateTime(run.createdAt)} />
      {series.some((s) => s.nwpTmaxC != null) && <ProvenanceBadge kind="nwp_forecast" source={scenario === 'replay' ? 'Open-Meteo Previous Runs (as issued)' : 'Open-Meteo Forecast API'} />}
      <ProvenanceBadge kind={histKind} source={histKind === 'simulated' ? 'CLIMATIQ simulator' : 'ERA5 via Open-Meteo archive'} />
      {histKind === 'simulated' && <DemoTag />}
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      {header}

      {/* Headline */}
      <section aria-label="Headline" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Peak severity (7 days)"
          value={<SeverityBadge severity={peak.severity} size="lg" />}
          hint={`${weekdayDay(peak.targetDate)} · D+${peak.horizonDay}. ${SEVERITY_META[peak.severity].description}`}
        />
        <MetricCard
          label="Peak predicted Tmax"
          value={peak.predictedTmaxC.toFixed(1)}
          unit="°C"
          hint={
            <>
              Band {peak.lowerC.toFixed(1)}–{peak.upperC.toFixed(1)} °C (nominal 80 %, uncalibrated). Tomorrow: {t1(d1.predictedTmaxC)} ± {((d1.upperC - d1.lowerC) / 2).toFixed(1)}
            </>
          }
        />
        <MetricCard
          label="Confidence (peak day)"
          value={<ConfidenceBadge confidence={peak.confidence} score={peak.confidenceScore} />}
          hint="Heuristic score from the spread of the band and input completeness — not a probability."
        />
        <MetricCard
          label="Expected duration"
          value={spell.durationDays}
          unit={spell.durationDays === 1 ? 'day ≥ High' : 'days ≥ High'}
          hint={spell.durationDays > 0 ? `Consecutive days from ${weekdayDay(spell.targetDate)} meeting High or Extreme.` : 'No forecast day reaches High or Extreme.'}
        />
      </section>

      <div className="flex flex-col items-start gap-2 rounded-2xl border border-line px-4 py-3 text-sm sm:flex-row">
        <OriginTag origin="climatiq" />
        <p className="min-w-0 flex-1 text-fg-muted">
          <strong className="text-fg">IMD-criteria-based indicator, not an IMD declaration:</strong>{' '}
          {imdDays > 0
            ? `${imdDays} of ${series.length} forecast days meet IMD heatwave criteria${severeDays ? ` (${severeDays} at severe-heatwave level)` : ''} when applied to the predicted Tmax at the ${target.level} centroid. Peak day: ${IMD_CATEGORY_TEXT[peak.imdCategory] ?? peak.imdCategory}.`
            : `No forecast day meets IMD heatwave criteria (${zone} base threshold ${threshold} °C with a departure of ≥ 4.5 °C${zone === 'plains' ? ', or ≥ 45 °C' : ''}).`}
        </p>
      </div>

      {/* Forecast chart + strip */}
      <div data-tour="forecast-chart">
      <Panel
        title="Forecast"
        description={`${target.name} · ${resolutionLabel(d1.resolution)}`}
        actions={
          canExport ? (
            <a href={`/api/v1/export/history.csv?region=${target.code}&from=${fromDay}&to=${lastDay}`} download className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-fg-muted hover:bg-accent-soft hover:text-fg">
              <Download className="size-3.5" aria-hidden /> History CSV
            </a>
          ) : null
        }
      >
        <div className="flex flex-col gap-4">
          <ForecastChart
            points={points}
            issuedFor={issuedFor}
            threshold={threshold}
            zoneLabel={zone}
            normalBasis={normalsLabel}
            hindcast={run.isHindcast}
            provenance={sourceBadges}
            footnote={
              <>
                Reference normal: {normalsLabel} — a CLIMATIQ reference climatology, not IMD’s official 1991–2020 normal. Threshold line: IMD {zone} heatwave base ({threshold} °C).{' '}
                {hasTruth
                  ? 'Reanalysis after the issue date is shown only for verification — it was not available to the hindcast.'
                  : lastHistory
                    ? `ERA5 reanalysis lags real time by about 5 days; the latest available day is ${shortDay(lastHistory)}.`
                    : 'No recent reanalysis is available for this region.'}
              </>
            }
          />
          <SeverityStrip
            days={series.map((s) => ({
              day: s.targetDate,
              horizonDay: s.horizonDay,
              severity: s.severity,
              predictedTmaxC: s.predictedTmaxC,
              lowerC: s.lowerC,
              upperC: s.upperC,
              confidence: s.confidence,
              confidenceScore: s.confidenceScore,
            }))}
          />
        </div>
      </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div data-tour="forecast-factors" className="min-w-0">
          <Panel title="Contributing factors" description="Recorded with each forecast day by the model (forecasts.factors)." className="h-full">
            <FactorsByDay
              initialDay={peak.targetDate}
              days={series.map((s) => ({ day: s.targetDate, horizonDay: s.horizonDay, severity: s.severity, factors: s.factors }))}
            />
          </Panel>
        </div>
        <div className="flex flex-col gap-5">
          <Panel title="Coverage & resolution">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-fg-muted">Forecast unit</dt>
              <dd>
                {target.name} ({LEVEL_LABEL[target.level]}){isCity && <span className="text-fg-muted"> — shown for {region.name}</span>}
              </dd>
              <dt className="text-fg-muted">Spatial resolution</dt>
              <dd>{resolutionLabel(d1.resolution)}</dd>
              <dt className="text-fg-muted">Centroid</dt>
              <dd className="tabular">
                {target.lat.toFixed(2)}° N, {target.lon.toFixed(2)}° E
              </dd>
              <dt className="text-fg-muted">Climate zone</dt>
              <dd className="capitalize">
                {zone} · heatwave base {threshold} °C
              </dd>
              <dt className="text-fg-muted">History on record</dt>
              <dd>
                {coverage[0]?.days
                  ? `${coverage[0].days.toLocaleString('en-IN')} days, ${fmtDate(coverage[0].firstDay!)} – ${fmtDate(coverage[0].lastDay!)}${target.level === 'district' ? ' (seasonal windows only)' : ''}`
                  : 'No daily history stored'}
              </dd>
            </dl>
          </Panel>
          <Panel title="Model, inputs & generation">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-fg-muted">Model version</dt>
              <dd>
                <span className="font-mono text-[13px]">{run.modelKey}</span> · {run.modelName}
              </dd>
              <dt className="text-fg-muted">Method</dt>
              <dd className="text-fg-muted">{run.modelMethod}</dd>
              <dt className="text-fg-muted">Generated</dt>
              <dd>
                {fmtDateTime(run.createdAt)} · run <span className="font-mono text-[12px]">{run.id.slice(0, 8)}</span>
                {run.isHindcast ? ' · hindcast' : ''}
              </dd>
              {(['nwp', 'history', 'normals'] as const).map((k) =>
                typeof run.inputs[k] === 'string' ? (
                  <div key={k} className="contents">
                    <dt className="text-fg-muted">{k === 'nwp' ? 'NWP guidance' : k === 'history' ? 'History' : 'Reference normal'}</dt>
                    <dd className="text-fg-muted">{run.inputs[k] as string}</dd>
                  </div>
                ) : null,
              )}
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">{sourceBadges}</div>
          </Panel>
        </div>
      </div>

      <Panel title="Historical comparison" description={`${shortDay(fromDay)} – ${shortDay(lastDay)} in every year with data for ${target.name}.`}>
        {years.length > 1 ? (
          <YearCompareChart
            keys={keys}
            years={years}
            refYear={refYear}
            predicted={predictedByMd}
            forecastFrom={addDays(issuedFor, 1).slice(5)}
            forecastTo={lastDay.slice(5)}
            threshold={threshold}
            provenance={<ProvenanceBadge kind={histKind} source="ERA5 via Open-Meteo archive" />}
            footnote={`Values are ERA5 reanalysis at the ${target.level} centroid.${laterYears.length ? ` Years after ${refYear} (${laterYears.join(', ')}) are omitted because they were in the future at the issue date.` : ''}${target.level === 'district' ? ' District history is stored for seasonal windows only, so some years may be incomplete.' : ''}`}
          />
        ) : (
          <EmptyState title="Not enough history for a comparison">
            Same-window history for earlier years is not stored for this region (districts keep seasonal windows only: spring 2019–2025 and autumn 2022–2025).
          </EmptyState>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Official warnings" description="India Meteorological Department (IMD) — kept separate from CLIMATIQ output.">
          <OfficialWarnings warnings={warnings} imdConfigured={Boolean(imd?.isConfigured)} />
        </Panel>
        <Panel title="Limitations & uncertainty">
          <Limitations hindcast={run.isHindcast} resolution={resolutionLabel(d1.resolution)} isCity={isCity} />
        </Panel>
      </div>

      {region.level !== 'city' && (
        <Panel
          title={region.level === 'state' ? 'Districts' : 'Cities & localities'}
          description={region.level === 'state' ? 'Peak severity over the forecast horizon.' : 'Cities use this district’s forecast (district-centroid resolution).'}
        >
          <ChildrenList items={children} childLabel={region.level === 'state' ? 'districts' : 'cities'} />
        </Panel>
      )}
    </div>
  );
}
