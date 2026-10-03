import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { EmptyState, MetricCard, PageHeader, Panel } from '@/components/ui/primitives';
import { ProvenanceBadge } from '@/components/ui/badges';
import { TrendSmallMultiples, type TrendSeries } from '@/components/charts/trend-chart';
import { MonthlyCompareChart } from '@/components/charts/monthly-compare-chart';
import { HeatTable, type HeatRow } from '@/components/charts/heat-table';
import { HorizonErrorCharts } from '@/components/charts/accuracy-charts';
import { ConfusionMatrix } from '@/components/charts/confusion-matrix';
import { SeverityStack } from '@/components/charts/severity-stack';
import { MONTHS, shortDay, signed, t1 } from '@/components/charts/format';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { currentScenario } from '@/server/scenario';
import { NORMAL_BASIS } from '@/server/forecasting/run';
import { climateCoverage, climateSpanByLevel, tmaxSeries } from '@/server/analytics/history';
import { heatwaveFrequency, type RegionHeatFrequency } from '@/server/analytics/heatwave';
import { accuracyReport, listRuns, modelVersionTable, riskDistributionByRun } from '@/server/analytics/accuracy';
import { analyticsRegionOptions, regionsByCodes, stateIds } from '@/server/analytics/regions';
import { describe, groupBy, monthlyMeans, rollingMean } from '@/server/analytics/metrics';
import { isoDate, scenarioParam, runParam } from '@/server/analytics/params';
import { can } from '@/lib/rbac';
import { addDays, fmtDate, fmtDateTime } from '@/lib/domain';
import { AnalyticsFilters } from './filters';

export const metadata: Metadata = { title: 'Climate analytics' };

const DEFAULT_REGIONS = ['IN-RJ', 'IN-UP', 'IN-DL', 'IN-OR'];
const SECTIONS = [
  ['trends', 'Trends'],
  ['comparison', 'Regional comparison'],
  ['frequency', 'Heatwave frequency'],
  ['seasonal', 'Seasonal'],
  ['accuracy', 'Forecast accuracy'],
  ['models', 'Model versions'],
  ['risk', 'Risk across runs'],
] as const;

function shiftYears(day: string, years: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return addDays(d.toISOString().slice(0, 10), 1);
}

const pctText = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)} %`);

export default async function AnalyticsPage({ searchParams }: PageProps<'/analytics'>) {
  const user = await requirePagePermission('analytics:view');
  const sp = await searchParams;
  const db = getDb();
  const canExport = can(user.assignments, 'analytics:export');

  // ── Filters (validated; invalid values fall back to defaults) ──
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const scenario = scenarioParam.safeParse(one(sp.scenario)).data ?? (await currentScenario());
  const basis = NORMAL_BASIS[scenario];
  const spans = await climateSpanByLevel(db);
  const dataFirst = spans.map((s) => s.firstDay).filter(Boolean).sort()[0] ?? '2019-01-01';
  const dataLast = spans.map((s) => s.lastDay).filter(Boolean).sort().at(-1) ?? addDays(new Date().toISOString().slice(0, 10), -6);
  let to = isoDate.safeParse(one(sp.to)).data ?? dataLast;
  let from = isoDate.safeParse(one(sp.from)).data ?? shiftYears(to, -5);
  if (from > to) [from, to] = [to, from];
  if (from < shiftYears(to, -10)) from = shiftYears(to, -10);

  const rawSlots = (one(sp.regions)?.split(',') ?? DEFAULT_REGIONS).slice(0, 4).map((c) => c.trim().toUpperCase());
  const known = await regionsByCodes(db, [...new Set(rawSlots.filter((c) => /^[A-Z0-9-]+$/.test(c)))]);
  const slots = rawSlots.map((c) => (known.some((k) => k.code === c && (k.level === 'state' || k.level === 'district')) ? c : null));
  const selected = slots
    .map((c, slot) => (c ? { ...known.find((k) => k.code === c)!, slot } : null))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  const selIds = selected.map((s) => s.id);

  const [options, runs, allStates] = await Promise.all([analyticsRegionOptions(db), listRuns(db), stateIds(db)]);
  const verifiedRuns = runs.filter((r) => r.verifiedCount > 0);
  const requestedRun = runParam.safeParse(one(sp.run)).data;
  const accRun =
    verifiedRuns.find((r) => r.id === requestedRun) ?? verifiedRuns.find((r) => r.scenario === scenario) ?? verifiedRuns[0] ?? null;
  const accLevel = one(sp.acclevel) === 'state' || one(sp.acclevel) === 'district' ? (one(sp.acclevel) as 'state' | 'district') : undefined;

  const freqIds = [...new Set([...selIds, ...allStates])];
  const [series, coverage, freq, accuracy, allAccuracy, models, risk] = await Promise.all([
    tmaxSeries(db, selIds, from, to),
    climateCoverage(db, selIds),
    heatwaveFrequency(db, freqIds, { from, to, basisKey: basis.key }),
    accRun ? accuracyReport(db, { runIds: [accRun.id], level: accLevel }) : Promise.resolve(null),
    verifiedRuns.length ? accuracyReport(db, {}) : Promise.resolve(null),
    modelVersionTable(db),
    riskDistributionByRun(db, 10),
  ]);

  // ── Trends & comparison ──
  const bySel = groupBy(series, (s) => s.regionId);
  const nDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const dayIndex = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  const trend: TrendSeries[] = selected.map((r) => {
    const pts = bySel.get(r.id) ?? [];
    const m = rollingMean(pts.map((p) => ({ day: p.day, value: p.tmaxC })), 30, 20);
    const v: (number | null)[] = new Array(nDays).fill(null);
    const mm: (number | null)[] = new Array(nDays).fill(null);
    pts.forEach((p, i) => {
      const k = dayIndex(p.day);
      if (k < 0 || k >= nDays) return;
      v[k] = p.tmaxC;
      mm[k] = m[i] == null ? null : Math.round(m[i]! * 10) / 10;
    });
    const annual = [...groupBy(pts, (p) => Number(p.day.slice(0, 4)))].map(([year, list]) => {
      const d = describe(list.map((x) => x.tmaxC));
      return { year, days: d.n, mean: d.mean, max: d.max };
    });
    return {
      code: r.code,
      name: r.name,
      slot: r.slot,
      note: r.level === 'district' ? 'district · seasonal windows only' : undefined,
      start: from,
      v,
      m: mm,
      annual,
    };
  });
  const monthly = selected.map((r) => {
    const cells = monthlyMeans((bySel.get(r.id) ?? []).map((p) => ({ day: p.day, tmaxC: p.tmaxC })));
    return { r, cells };
  });
  const monthKeys = [...new Set(monthly.flatMap((m) => m.cells.map((c) => `${c.year}-${String(c.month).padStart(2, '0')}`)))].sort();
  const histKinds = [...new Set(series.map((s) => s.dataKind))];
  const histBadge = (
    <>
      {(histKinds.length ? histKinds : ['reanalysis' as const]).map((k) => (
        <ProvenanceBadge key={k} kind={k} source={k === 'simulated' ? 'CLIMATIQ simulator' : 'ERA5 via Open-Meteo archive'} />
      ))}
    </>
  );
  const freqById = new Map(freq.map((f) => [f.regionId, f]));

  // ── Heatwave frequency table ──
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
  const freqRow = (f: RegionHeatFrequency, highlight: boolean): HeatRow => ({
    key: f.code,
    text: f.name,
    label: (
      <Link href={`/forecasts/${f.code}`} className="hover:underline">
        {f.name}
      </Link>
    ),
    sublabel: f.level === 'district' ? 'district · seasonal windows' : highlight ? 'selected' : undefined,
    highlight,
    cells: Object.fromEntries(
      years.map((y) => {
        const c = f.years.find((x) => x.year === y);
        if (!c || c.daysEvaluated === 0) return [String(y), { value: null, display: '·', detail: `${y}: no data in range` }];
        return [
          String(y),
          {
            value: c.heatwaveDays,
            display: String(c.heatwaveDays),
            detail: `${y}: ${c.heatwaveDays} heatwave-criteria days (${c.high} High, ${c.extreme} Extreme) out of ${c.daysEvaluated} days evaluated; max Tmax ${t1(c.maxTmaxC)}`,
          },
        ];
      }),
    ),
  });
  const stateFreq = freq.filter((f) => f.level === 'state' && f.daysEvaluated > 0).sort((a, b) => b.totalHeatwaveDays - a.totalHeatwaveDays || a.name.localeCompare(b.name));
  const districtFreq = selected.filter((s) => s.level === 'district').map((s) => freqById.get(s.id)).filter((f): f is RegionHeatFrequency => Boolean(f));
  const freqRows = [...districtFreq.map((f) => freqRow(f, true)), ...stateFreq.map((f) => freqRow(f, selIds.includes(f.regionId)))];
  const freqMax = Math.max(5, ...freq.flatMap((f) => f.years.map((y) => y.heatwaveDays)));
  const stateDaysByYear = new Map(years.map((y) => [y, Math.max(0, ...stateFreq.map((f) => f.years.find((x) => x.year === y)?.daysEvaluated ?? 0))]));

  // ── Seasonal heat tables ──
  const seasonalAll = monthly.flatMap((m) => m.cells.map((c) => c.mean));
  const sMin = seasonalAll.length ? Math.floor(Math.min(...seasonalAll)) : 15;
  const sMax = seasonalAll.length ? Math.ceil(Math.max(...seasonalAll)) : 45;

  // ── Accuracy ──
  const best = accuracy ? accuracy.byRegion.slice(0, 6) : [];
  const worst = accuracy ? [...accuracy.byRegion].reverse().slice(0, 6) : [];
  const runLabel = (r: (typeof runs)[number]) =>
    `${r.scenario === 'replay' ? 'Replay' : 'Live'} · issued ${fmtDate(r.issuedFor)}${r.isHindcast ? ' (hindcast)' : ''} · ${r.verifiedCount} verified`;

  const exportBtn = (href: string, label: string) =>
    canExport ? (
      <a href={href} download className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-fg-muted hover:bg-accent-soft hover:text-fg">
        <Download className="size-3.5" aria-hidden /> {label}
      </a>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Climate analytics"
        title="History, comparison & forecast accuracy"
        description="Explore stored ERA5 reanalysis history, heatwave-criteria frequency and how well CLIMATIQ forecasts verified. All indicators are CLIMATIQ-derived — not official IMD statistics."
      />

      <AnalyticsFilters
        options={options.map((o) => ({ code: o.code, name: o.name, level: o.level, stateName: o.stateName }))}
        state={{ slots, from, to, scenario, run: accRun?.id ?? null }}
        dataFirst={dataFirst}
        dataLast={dataLast}
        runs={verifiedRuns.map((r) => ({ id: r.id, label: runLabel(r) }))}
      />

      <nav aria-label="Sections" className="relative -mx-1 flex gap-1 overflow-x-auto px-1">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-accent-soft hover:text-fg">
            {label}
          </a>
        ))}
      </nav>

      {selected.length === 0 && (
        <Panel>
          <EmptyState title="Select at least one region">Use “Add a region…” above to choose up to four states or pilot districts.</EmptyState>
        </Panel>
      )}

      {selected.length > 0 && (
        <>
          <Panel
            id="trends"
            title="Historical temperature trends"
            description={`Daily maximum temperature, ${fmtDate(from)} – ${fmtDate(to)} · one panel per region, shared axes`}
            actions={selected[0] ? exportBtn(`/api/v1/export/history.csv?region=${selected[0].code}&from=${from}&to=${to}`, `${selected[0].name} CSV`) : null}
          >
            <TrendSmallMultiples
              series={trend}
              from={from}
              to={to}
              provenance={histBadge}
              footnote="ERA5 reanalysis at each region’s centroid (a model-based reconstruction, not station observations). Districts are stored for seasonal windows only, so their panels show gaps; lines never bridge gaps. Export a region’s daily values from the forecast detail page or with the CSV button."
            />
          </Panel>

          <Panel id="comparison" title="Regional comparison" description="Same period and source for every selected region.">
            <div className="flex flex-col gap-5">
              {monthKeys.length > 0 ? (
                <MonthlyCompareChart
                  months={monthKeys}
                  regions={monthly.map(({ r, cells }) => ({
                    code: r.code,
                    name: r.name,
                    slot: r.slot,
                    months: Object.fromEntries(cells.map((c) => [`${c.year}-${String(c.month).padStart(2, '0')}`, c.mean])),
                  }))}
                  provenance={histBadge}
                  footnote="Months with fewer than 10 days of data are omitted (district seasonal windows cover parts of Apr–Jun and Sep–Nov)."
                />
              ) : (
                <EmptyState title="No monthly data in this range" />
              )}
              <div className="cq-viz relative overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label="Regional comparison table">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="sr-only">Summary statistics per selected region for the selected period</caption>
                  <thead className="bg-accent-soft text-xs text-fg-muted">
                    <tr>
                      {['Region', 'Days with data', 'Mean Tmax', '95th pct Tmax', 'Max Tmax', 'Heatwave-criteria days', 'of which Extreme'].map((h, i) => (
                        <th key={h} scope="col" className={`px-3 py-2 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((r) => {
                      const pts = bySel.get(r.id) ?? [];
                      const d = describe(pts.map((p) => p.tmaxC));
                      const maxDay = pts.find((p) => p.tmaxC === d.max)?.day;
                      const f = freqById.get(r.id);
                      const cov = coverage.find((c) => c.regionId === r.id);
                      return (
                        <tr key={r.code} className="border-t border-line">
                          <th scope="row" className="px-3 py-2 text-left font-medium">
                            <span className="flex items-center gap-2">
                              <svg width="14" height="8" aria-hidden>
                                <line x1="0" y1="4" x2="14" y2="4" stroke={`var(--viz-${r.slot + 1})`} strokeWidth="3" strokeLinecap="round" />
                              </svg>
                              <Link href={`/forecasts/${r.code}`} className="hover:underline">
                                {r.name}
                              </Link>
                            </span>
                            <span className="block pl-[22px] text-[11px] font-normal text-fg-subtle">
                              {r.level === 'district' ? 'District' : 'State / UT'} · stored {cov?.firstDay ? `${cov.firstDay} → ${cov.lastDay}` : 'none'}
                            </span>
                          </th>
                          <td className="px-3 py-2 text-right tabular">{d.n.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2 text-right tabular">{t1(d.mean)}</td>
                          <td className="px-3 py-2 text-right tabular">{t1(d.p95)}</td>
                          <td className="px-3 py-2 text-right tabular">
                            {t1(d.max)}
                            {maxDay && <span className="block text-[11px] text-fg-subtle">{fmtDate(maxDay)}</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular font-semibold">{f ? f.totalHeatwaveDays : '—'}</td>
                          <td className="px-3 py-2 text-right tabular">{f ? f.totalExtremeDays : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        </>
      )}

      <Panel
        id="frequency"
        title="Heatwave frequency"
        description={`Days per year meeting CLIMATIQ High or Extreme (IMD heatwave criteria) · ${fmtDate(from)} – ${fmtDate(to)} · reference normal: ${basis.label}`}
      >
        {freqRows.length ? (
          <HeatTable
            caption="Heatwave-criteria days per year by region"
            rowHeader="Region"
            columns={years.map((y) => {
              const days = stateDaysByYear.get(y) ?? 0;
              return { key: String(y), label: String(y), note: days > 0 && days < 330 ? `Partial year for states: up to ${days} days with data in the selected range` : undefined };
            })}
            rows={freqRows}
            min={0}
            max={freqMax}
            scaleLabel="Days ≥ High"
            zeroNeutral
            provenance={
              <>
                <ProvenanceBadge kind="reanalysis" source="ERA5 via Open-Meteo archive" />
                <ProvenanceBadge kind="model_forecast" source={`CLIMATIQ classification · normal ${basis.key}`} />
              </>
            }
            footnote={
              <>
                <strong>Method.</strong> Each day’s ERA5 Tmax at the region centroid is classified with the CLIMATIQ rule (<code>classify</code>): Tmax ≥ zone base (40 °C plains, 37 °C coastal, 30 °C
                hills) with a departure ≥ 4.5 °C (High) or ≥ 6.5 °C (Extreme) from the reference normal ({basis.label}), or Tmax ≥ 45 / 47 °C on the plains. Cells count High + Extreme days.
                <br />
                <strong>Indicator, not an IMD declaration:</strong> IMD declares heatwaves from station observations against 1991–2020 normals when ≥ 2 stations of a sub-division meet the criteria on 2
                consecutive days. Years marked * are partial; state data for 2019–2020 covers 20 Apr–30 Jun only; years inside the reference period are compared with a normal they contributed to,
                which slightly understates their departures.
              </>
            }
          />
        ) : (
          <EmptyState title="No history in this range">Choose a range that overlaps the stored history ({dataFirst} → {dataLast}).</EmptyState>
        )}
      </Panel>

      {selected.length > 0 && (
        <Panel id="seasonal" title="Seasonal analysis" description="Monthly mean daily maximum temperature by year (°C).">
          <div className="flex flex-col gap-3">
            {monthly.map(({ r, cells }, i) => {
              const yrs = [...new Set(cells.map((c) => c.year))].sort();
              return (
                <details key={r.code} open={i === 0} className="group rounded-xl border border-line px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold marker:text-accent">
                    {r.name}
                    <span className="ml-2 text-xs font-normal text-fg-subtle">
                      {yrs.length ? `${yrs[0]}–${yrs.at(-1)}` : 'no complete months'}
                      {r.level === 'district' ? ' · seasonal windows only' : ''}
                    </span>
                  </summary>
                  <div className="mt-3">
                    {cells.length ? (
                      <HeatTable
                        caption={`Monthly mean Tmax by year for ${r.name}`}
                        rowHeader="Year"
                        columns={MONTHS.map((m, k) => ({ key: String(k + 1), label: m }))}
                        rows={yrs.map((y) => ({
                          key: String(y),
                          text: String(y),
                          label: String(y),
                          cells: Object.fromEntries(
                            cells
                              .filter((c) => c.year === y)
                              .map((c) => [String(c.month), { value: c.mean, display: c.mean.toFixed(1), detail: `${MONTHS[c.month - 1]} ${y}: mean Tmax ${c.mean.toFixed(1)} °C over ${c.n} days (max ${c.max.toFixed(1)} °C)` }]),
                          ),
                        }))}
                        min={sMin}
                        max={sMax}
                        scaleLabel="Mean Tmax"
                        formatTick={(v) => `${v} °C`}
                        footnote="Months with fewer than 10 days of data are left blank."
                      />
                    ) : (
                      <p className="text-sm text-fg-muted">No month in this range has at least 10 days of data.</p>
                    )}
                  </div>
                </details>
              );
            })}
            <div className="flex flex-wrap gap-1.5">{histBadge}</div>
          </div>
        </Panel>
      )}

      <section id="accuracy" data-tour="accuracy" aria-label="Forecast accuracy" className="flex scroll-mt-24 flex-col gap-5">
        <Panel
          title="Forecast accuracy"
          description={
            accRun
              ? `${runLabel(accRun)} · truth: ${accuracy?.observedKinds.join(', ') || '—'} · ${accLevel ? `${accLevel}s only` : 'states + districts'}`
              : 'Verification compares forecasts with what happened later.'
          }
          actions={accRun ? exportBtn(`/api/v1/export/verification.csv?run=${accRun.id}`, 'Verification CSV') : null}
        >
          {!accRun || !accuracy?.overall ? (
            <EmptyState title="No verified forecasts yet">
              Verification needs the truth for each target day. ERA5 reanalysis arrives about 5 days late, so live runs can only be verified after their target days have passed. The historical
              replay hindcast is verified when the demo seed runs.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Accuracy level">
                {([undefined, 'state', 'district'] as const).map((lv) => {
                  const params = new URLSearchParams(Object.entries({ regions: slots.map((c) => c ?? '').join(','), from, to, scenario, run: accRun.id }));
                  if (lv) params.set('acclevel', lv);
                  const active = accLevel === lv;
                  return (
                    <Link
                      key={lv ?? 'all'}
                      href={`/analytics?${params.toString()}#accuracy`}
                      scroll={false}
                      aria-current={active ? 'true' : undefined}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${active ? 'border-accent bg-accent text-accent-fg' : 'border-line text-fg-muted hover:bg-accent-soft'}`}
                    >
                      {lv === 'state' ? 'States only' : lv === 'district' ? 'Districts only' : 'States + districts'}
                    </Link>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <MetricCard label="Samples" value={accuracy.overall.n.toLocaleString('en-IN')} hint={`${accuracy.regions} regions × ${accuracy.byHorizon.length} lead days`} />
                <MetricCard label="MAE" value={accuracy.overall.mae.toFixed(2)} unit="°C" hint="Mean absolute error" />
                <MetricCard label="RMSE" value={accuracy.overall.rmse.toFixed(2)} unit="°C" hint="Penalises large misses" />
                <MetricCard label="Bias" value={signed(accuracy.overall.bias, 2, '')} unit="°C" hint={accuracy.overall.bias >= 0 ? 'Forecasts ran warm on average' : 'Forecasts ran cold on average'} />
                <MetricCard label="Band coverage" value={pctText(accuracy.bandCoverage.rate)} hint={`Truth inside the nominal 80 % band (${accuracy.bandCoverage.inside}/${accuracy.bandCoverage.n})`} />
                <MetricCard label="Severity exact" value={pctText(accuracy.confusion.exactRate)} hint={`Within one class: ${pctText(accuracy.confusion.withinOneRate)}`} />
              </div>

              <HorizonErrorCharts
                stats={accuracy.byHorizon}
                provenance={
                  <>
                    <ProvenanceBadge kind="model_forecast" source={accRun.modelKey} />
                    <span className="text-[11px] text-fg-subtle">vs</span>
                    <ProvenanceBadge kind="reanalysis" source="ERA5 truth (Open-Meteo archive)" />
                  </>
                }
                footnote="Error = predicted − truth. Truth is ERA5 reanalysis at the same centroid, not station observations, so these numbers describe agreement with reanalysis."
              />

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {[
                  { title: 'Lowest error regions', list: best },
                  { title: 'Highest error regions', list: worst },
                ].map(({ title, list }) => (
                  <div key={title} className="min-w-0">
                    <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                    <div className="relative overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label={title}>
                      <table className="w-full min-w-[440px] whitespace-nowrap text-sm">
                        <caption className="sr-only">{title} by mean absolute error</caption>
                        <thead className="bg-accent-soft text-xs text-fg-muted">
                          <tr>
                            <th scope="col" className="px-3 py-2 text-left font-semibold">Region</th>
                            <th scope="col" className="px-3 py-2 text-right font-semibold">n</th>
                            <th scope="col" className="px-3 py-2 text-right font-semibold">MAE</th>
                            <th scope="col" className="px-3 py-2 text-right font-semibold">Bias</th>
                            <th scope="col" className="px-3 py-2 text-right font-semibold">Max |err|</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r) => (
                            <tr key={r.regionCode} className="border-t border-line">
                              <th scope="row" className="px-3 py-1.5 text-left font-medium">
                                <Link href={`/forecasts/${r.regionCode}`} className="hover:underline">
                                  {r.regionName}
                                </Link>
                                <span className="ml-1 text-[11px] font-normal capitalize text-fg-subtle">{r.level}</span>
                              </th>
                              <td className="px-3 py-1.5 text-right tabular text-fg-muted">{r.n}</td>
                              <td className="px-3 py-1.5 text-right tabular font-semibold">{r.mae.toFixed(2)} °C</td>
                              <td className="px-3 py-1.5 text-right tabular">{signed(r.bias, 2)}</td>
                              <td className="px-3 py-1.5 text-right tabular text-fg-muted">{r.maxAbs.toFixed(1)} °C</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
              <p className="-mt-2 text-[11px] text-fg-subtle">Each region contributes about one sample per lead day ({accuracy.byHorizon.length} in total), so per-region errors are very noisy.</p>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
                <div className="flex min-w-0 flex-col gap-2 xl:col-span-3">
                  <h3 className="text-sm font-semibold">Severity hit / miss</h3>
                  <ConfusionMatrix matrix={accuracy.confusion.matrix} n={accuracy.confusion.n} />
                  <p className="text-[11px] text-fg-subtle">Truth severity applies the same classification rule to ERA5 Tmax with the run’s reference normal. The outlined diagonal holds exact matches.</p>
                </div>
                <div className="flex flex-col gap-3 xl:col-span-2">
                  <h3 className="text-sm font-semibold">Heat events (≥ High)</h3>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    {[
                      ['Hits', accuracy.confusion.event.hits],
                      ['Misses', accuracy.confusion.event.misses],
                      ['False alarms', accuracy.confusion.event.falseAlarms],
                      ['Correct negatives', accuracy.confusion.event.correctNegatives],
                      ['POD (hit rate)', pctText(accuracy.confusion.event.pod)],
                      ['FAR (false-alarm ratio)', pctText(accuracy.confusion.event.far)],
                      ['CSI (threat score)', pctText(accuracy.confusion.event.csi)],
                    ].map(([k, v]) => (
                      <div key={k as string} className="rounded-xl border border-line px-3 py-2">
                        <dt className="text-[11px] text-fg-muted">{k}</dt>
                        <dd className="font-semibold tabular">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div role="note" className="rounded-xl border border-accent/30 bg-accent-soft px-3 py-2.5 text-xs text-fg-muted">
                    <p className="font-semibold text-fg">Read with care</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      <li>Truth is ERA5 reanalysis, not station observations; IMD’s station-based picture can differ.</li>
                      <li>{accRun.isHindcast ? 'This is one historical event (late-May 2024). One case does not establish validated skill.' : 'A single run is a small, correlated sample.'}</li>
                      <li>Samples are spatially correlated (neighbouring districts share weather), so the effective sample size is much smaller than n.</li>
                      <li>The 80 % band is heuristic; coverage above shows how it behaved here, not a calibration guarantee.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </section>

      <Panel id="models" title="Model version comparison" description="Every run records the model version that produced it, so versions can be compared on the same verification data.">
        <div className="relative overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label="Model versions">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Registered forecast model versions with run counts and verification metrics</caption>
            <thead className="bg-accent-soft text-xs text-fg-muted">
              <tr>
                {['Model', 'Method', 'Runs', 'Last run', 'Verified samples', 'MAE', 'RMSE', 'Bias', 'Band coverage'].map((h, i) => (
                  <th key={h} scope="col" className={`px-3 py-2 font-semibold ${i < 2 || i === 3 ? 'text-left' : 'text-right'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const s = allAccuracy?.byModel.find((b) => b.modelKey === m.key);
                return (
                  <tr key={m.key} className="border-t border-line align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <span className="font-mono text-[13px]">{m.key}</span>
                      <span className="block text-[11px] font-normal text-fg-subtle">
                        {m.name} · {m.isActive ? 'active' : 'inactive'}
                      </span>
                    </th>
                    <td className="max-w-xs px-3 py-2 text-xs text-fg-muted">{m.method}</td>
                    <td className="px-3 py-2 text-right tabular">{m.runs}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{m.lastRunAt ? fmtDateTime(m.lastRunAt) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular">{m.verified.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 text-right tabular">{s ? `${s.mae.toFixed(2)} °C` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular">{s ? `${s.rmse.toFixed(2)} °C` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular">{s ? signed(s.bias, 2) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular">{pctText(s?.bandCoverageRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          {models.length <= 1
            ? 'Only one model is registered so far. '
            : ''}
          New models implement the same forecast interface, are registered in <code>model_versions</code> and run side by side on the same inputs; they appear here automatically, and accuracy
          comparisons are only meaningful on the same verified runs (metrics above pool all verified samples per model).
        </p>
      </Panel>

      <Panel id="risk" title="Risk distribution across runs" description="Peak CLIMATIQ severity per region over each run’s horizon (newest first).">
        {risk.length ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {(['states', 'districts'] as const).map((lv) => (
              <SeverityStack
                key={lv}
                title={lv === 'states' ? 'States & union territories' : 'Pilot districts'}
                unit={lv}
                countNoun="region peaks across these runs"
                rows={risk.map((r) => ({
                  key: r.runId,
                  text: `${r.scenario === 'replay' ? 'Replay' : 'Live'} issued ${r.issuedFor}`,
                  label: `${r.scenario === 'replay' ? 'Replay' : 'Live'} · ${shortDay(r.issuedFor)} ${r.issuedFor.slice(2, 4)}`,
                  sublabel: `${r.isHindcast ? 'hindcast · ' : ''}${fmtDateTime(r.createdAt)}`,
                  counts: r[lv],
                }))}
                provenance={lv === 'states' ? <ProvenanceBadge kind="model_forecast" source="CLIMATIQ forecast runs" /> : undefined}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No forecast runs yet" />
        )}
      </Panel>
    </div>
  );
}
