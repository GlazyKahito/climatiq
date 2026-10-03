'use client';

/** Region detail panel, accessible table view, comparison and horizon summary for the command center. */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Building2, Info, MapPin, X } from 'lucide-react';
import { ConfidenceBadge, OriginTag, ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { fmtDate, fmtDelta, fmtTemp, SEVERITY_META, type Severity } from '@/lib/domain';
import { peakOf, severityCounts } from '@/components/map/scales';
import type { CityItem, MapForecast, RegionDetailPayload, RunSummary, StateMeta } from '@/components/map/types';

export function dayLabel(day: string, opts: { weekday?: boolean } = {}) {
  return fmtDate(day, { ...(opts.weekday === false ? {} : { weekday: 'short' }), day: 'numeric', month: 'short' });
}

const rankDesc = (a: MapForecast, b: MapForecast) => SEVERITY_META[b.sev].rank - SEVERITY_META[a.sev].rank || b.tmax - a.tmax;

function ForecastFacts({ f }: { f: MapForecast }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
      <div>
        <dt className="text-fg-subtle">Predicted Tmax</dt>
        <dd className="font-display text-lg font-bold tabular text-fg">{fmtTemp(f.tmax)}</dd>
        <dd className="text-[11px] text-fg-muted tabular">
          80 % band {f.lo.toFixed(1)}–{f.hi.toFixed(1)} °C <span className="text-fg-subtle">(heuristic)</span>
        </dd>
      </div>
      <div>
        <dt className="text-fg-subtle">Departure from normal</dt>
        <dd className="font-display text-lg font-bold tabular text-fg">{fmtDelta(f.dep)}</dd>
        <dd className="text-[11px] text-fg-muted">reference normal {fmtTemp(f.normal)}</dd>
      </div>
      <div>
        <dt className="text-fg-subtle">Severity</dt>
        <dd className="mt-0.5">
          <SeverityBadge severity={f.sev} size="sm" />
        </dd>
        {f.imd !== 'none' && <dd className="mt-0.5 text-[11px] text-fg-muted">IMD-criteria-based: {f.imd === 'severe_heatwave' ? 'severe heatwave' : 'heatwave'}</dd>}
      </div>
      <div>
        <dt className="text-fg-subtle">Confidence</dt>
        <dd className="mt-0.5">
          <ConfidenceBadge confidence={f.conf} score={f.cs} />
        </dd>
        {f.dur > 0 && <dd className="mt-0.5 text-[11px] text-fg-muted">{f.dur} consecutive day(s) ≥ High</dd>}
      </div>
      <div className="col-span-2 flex items-start gap-1.5 text-[11px] text-fg-muted">
        <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden /> Resolution: {f.res}
      </div>
    </dl>
  );
}

function SeriesStrip({ rows, day, onDay }: { rows: MapForecast[]; day: string | null; onDay: (d: string) => void }) {
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label="Forecast by day">
      {rows.map((r) => (
        <li key={r.day}>
          <button
            type="button"
            onClick={() => onDay(r.day)}
            aria-pressed={r.day === day}
            aria-label={`${dayLabel(r.day)}: ${SEVERITY_META[r.sev].label}, ${r.tmax.toFixed(1)} °C`}
            className={cn('flex w-full flex-col items-center gap-0.5 rounded-lg border px-0.5 py-1 text-[10px]', r.day === day ? 'border-accent bg-accent-soft' : 'border-line hover:bg-accent-soft')}
          >
            <span className="text-fg-subtle">{fmtDate(r.day, { day: 'numeric' })}</span>
            <span aria-hidden className="h-1.5 w-full rounded-full" style={{ background: `var(--sev-${r.sev})` }} />
            <span className="font-semibold tabular text-fg">{Math.round(r.tmax)}°</span>
            <span className="text-fg-subtle">{SEVERITY_META[r.sev].short}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function RegionPanel({
  run,
  day,
  states,
  stateForecasts,
  focus,
  districtRows,
  districtStatus,
  onFocusState,
  onFocusDistrict,
  onDay,
  pilotNames,
}: {
  run: RunSummary | null;
  day: string | null;
  states: StateMeta[];
  stateForecasts: MapForecast[];
  focus: { state: string | null; district: string | null; city: string | null };
  districtRows: MapForecast[] | null;
  districtStatus: 'idle' | 'loading' | 'error' | 'ready' | 'none';
  onFocusState: (code: string | null) => void;
  onFocusDistrict: (code: string | null) => void;
  onDay: (d: string) => void;
  pilotNames: string;
}) {
  const [detail, setDetail] = useState<{ code: string; data: RegionDetailPayload | null; error?: boolean } | null>(null);
  const detailCode = focus.district;
  useEffect(() => {
    if (!detailCode) return;
    let alive = true;
    fetch(`/api/v1/map/regions/${encodeURIComponent(detailCode)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { data: RegionDetailPayload }) => alive && setDetail({ code: detailCode, data: j.data }))
      .catch(() => alive && setDetail({ code: detailCode, data: null, error: true }));
    return () => {
      alive = false;
    };
  }, [detailCode]);

  if (!run) {
    return <EmptyState title="No forecast run for this scenario">Switch to the historical replay or wait for the next live run.</EmptyState>;
  }

  // ── District ──
  if (focus.state && focus.district) {
    const series = (districtRows ?? []).filter((r) => r.code === focus.district).sort((a, b) => a.day.localeCompare(b.day));
    const f = series.find((r) => r.day === day);
    const name = series[0]?.name ?? (detail?.code === focus.district ? detail.data?.region.name : undefined) ?? focus.district;
    const stateName = states.find((s) => s.code === focus.state)?.name;
    const cities: CityItem[] | null = detail?.code === focus.district ? (detail.data?.cities ?? []) : null;
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-subtle">District · {stateName}</p>
          <h3 className="text-lg font-semibold text-fg">{name}</h3>
        </div>
        {f ? <ForecastFacts f={f} /> : <p className="text-sm text-fg-muted">No forecast for this district on the selected day.</p>}
        {series.length > 0 && <SeriesStrip rows={series} day={day} onDay={onDay} />}
        <div>
          <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
            <Building2 className="size-3.5" aria-hidden /> Cities & towns
          </h4>
          {cities == null ? (
            detail?.error ? <p className="text-xs text-fg-muted">Could not load cities.</p> : <Skeleton className="h-10" />
          ) : cities.length === 0 ? (
            <p className="text-xs text-fg-muted">No cities with population ≥ 15,000 are listed for this district (GeoNames).</p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-1">
                {cities.map((c) => (
                  <li
                    key={c.code}
                    className={cn('rounded-md border border-line px-1.5 py-0.5 text-[11px]', focus.city === c.code && 'border-accent bg-accent-soft font-semibold')}
                  >
                    {c.name}
                    {c.population ? <span className="text-fg-subtle"> · {(c.population / 1000).toFixed(0)}k</span> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 flex gap-1 text-[11px] text-fg-muted">
                <Info className="mt-0.5 size-3 shrink-0" aria-hidden /> Cities use the district forecast (district-centroid point) — there is no city-level precision.
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/forecasts/${focus.district}`} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            Full forecast & factors <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <button type="button" className="text-xs text-fg-muted hover:text-fg hover:underline" onClick={() => onFocusDistrict(null)}>
            Back to {stateName}
          </button>
        </div>
      </div>
    );
  }

  // ── State ──
  if (focus.state) {
    const meta = states.find((s) => s.code === focus.state);
    const series = stateForecasts.filter((r) => r.code === focus.state).sort((a, b) => a.day.localeCompare(b.day));
    const f = series.find((r) => r.day === day);
    const districtsToday = (districtRows ?? []).filter((r) => r.day === day).sort(rankDesc);
    const dist = day && districtRows ? severityCounts(districtRows, day) : null;
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-subtle">{meta?.isPilot ? 'Pilot state' : 'State / UT'}</p>
          <h3 className="text-lg font-semibold text-fg">{meta?.name ?? focus.state}</h3>
        </div>
        {!meta?.isPilot && (
          <p className="flex gap-1.5 rounded-xl border border-dashed border-line-strong p-2 text-[11px] text-fg-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            State-level value only — computed at a single centroid point, so it is coarse and may miss local extremes. District forecasts are
            available for the pilot states ({pilotNames}).
          </p>
        )}
        {f ? <ForecastFacts f={f} /> : <p className="text-sm text-fg-muted">No state-level forecast for the selected day.</p>}
        {series.length > 0 && <SeriesStrip rows={series} day={day} onDay={onDay} />}
        {meta?.isPilot && (
          <div>
            <h4 className="mb-1 text-xs font-semibold text-fg-muted">Districts on {day ? dayLabel(day) : '—'}</h4>
            {districtStatus === 'loading' && <Skeleton className="h-24" />}
            {districtStatus === 'error' && <p className="text-xs text-fg-muted">District forecasts could not be loaded.</p>}
            {districtStatus === 'ready' && districtsToday.length === 0 && <p className="text-xs text-fg-muted">No district forecasts for this day.</p>}
            {dist && districtsToday.length > 0 && (
              <>
                <p className="mb-1.5 text-[11px] text-fg-muted">
                  {dist.extreme} Extreme · {dist.high} High · {dist.moderate} Moderate · {dist.low} Low (of {districtsToday.length})
                </p>
                <ul className="flex flex-col gap-1">
                  {districtsToday.slice(0, 6).map((d) => (
                    <li key={d.code}>
                      <button
                        type="button"
                        onClick={() => onFocusDistrict(d.code)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-accent-soft"
                      >
                        <span className="truncate text-fg">{d.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5 tabular text-fg-muted">
                          {d.tmax.toFixed(1)} °C <SeverityBadge severity={d.sev} size="sm" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/forecasts/${focus.state}`} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            Full forecast & factors <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <button type="button" className="text-xs text-fg-muted hover:text-fg hover:underline" onClick={() => onFocusState(null)}>
            Back to India
          </button>
        </div>
      </div>
    );
  }

  // ── India ──
  const top = stateForecasts.filter((r) => r.day === day).sort(rankDesc).slice(0, 7);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-fg-muted">Hottest states/UTs on {day ? dayLabel(day) : '—'} (state-level centroid estimates). Select one to drill down.</p>
      {top.length === 0 ? (
        <p className="text-sm text-fg-muted">No forecasts for this day.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {top.map((s) => (
            <li key={s.code}>
              <button
                type="button"
                onClick={() => onFocusState(s.code)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent-soft"
              >
                <span className="truncate font-medium text-fg">{s.name}</span>
                <span className="flex shrink-0 items-center gap-1.5 tabular text-fg-muted">
                  {s.tmax.toFixed(1)} °C · {fmtDelta(s.dep)} <SeverityBadge severity={s.sev} size="sm" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "View as table": accessible alternative to the map for the current level. */
export function RegionTable({
  rows,
  level,
  day,
  scopeLabel,
  onPick,
  run,
}: {
  rows: MapForecast[];
  level: 'state' | 'district';
  day: string | null;
  scopeLabel: string;
  onPick: (code: string) => void;
  run: RunSummary | null;
}) {
  const sorted = useMemo(() => [...rows].sort(rankDesc), [rows]);
  if (!sorted.length) return <EmptyState title="No forecasts to show">There is no forecast for this selection and day.</EmptyState>;
  return (
    <div className="h-full overflow-auto pt-11">
      <table className="w-full min-w-[640px] border-collapse text-left text-xs">
        <caption className="px-3 py-2 text-left text-xs text-fg-muted">
          CLIMATIQ {run?.modelKey ?? ''} forecast for {scopeLabel} on {day ? dayLabel(day) : '—'} ({level === 'state' ? 'state-centroid points' : 'district-centroid points'}).
          Sorted by severity, then predicted Tmax. Model output — not an official IMD forecast.
        </caption>
        <thead className="sticky top-0 bg-bg-elevated text-[11px] uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2">{level === 'state' ? 'State / UT' : 'District'}</th>
            <th scope="col" className="px-3 py-2">Severity</th>
            <th scope="col" className="px-3 py-2 text-right">Pred. Tmax</th>
            <th scope="col" className="px-3 py-2 text-right">80 % band</th>
            <th scope="col" className="px-3 py-2 text-right">Departure</th>
            <th scope="col" className="px-3 py-2 text-right">Normal</th>
            <th scope="col" className="px-3 py-2">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.code} className="border-t border-line">
              <th scope="row" className="px-3 py-1.5 font-medium">
                <button type="button" className="text-left text-fg underline-offset-2 hover:underline" onClick={() => onPick(r.code)}>
                  {r.name}
                </button>
              </th>
              <td className="px-3 py-1.5">
                <SeverityBadge severity={r.sev} size="sm" />
              </td>
              <td className="px-3 py-1.5 text-right tabular">{r.tmax.toFixed(1)} °C</td>
              <td className="px-3 py-1.5 text-right tabular text-fg-muted">
                {r.lo.toFixed(1)}–{r.hi.toFixed(1)}
              </td>
              <td className="px-3 py-1.5 text-right tabular">{fmtDelta(r.dep)}</td>
              <td className="px-3 py-1.5 text-right tabular text-fg-muted">{fmtTemp(r.normal)}</td>
              <td className="px-3 py-1.5">
                <ConfidenceBadge confidence={r.conf} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type CompareEntry = { code: string; name: string; level: 'state' | 'district'; rows: MapForecast[] | null };

export function ComparePanel({ entries, day, onRemove, onClear }: { entries: CompareEntry[]; day: string | null; onRemove: (code: string) => void; onClear: () => void }) {
  return (
    <section className="glass rounded-[var(--radius-glass)] p-4" aria-labelledby="cq-compare-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="cq-compare-h" className="text-sm font-semibold text-fg">
            Region comparison
          </h2>
          <p className="text-xs text-fg-muted">Selected day {day ? dayLabel(day) : '—'} and peak over the forecast horizon. Up to 3 regions.</p>
        </div>
        <div className="flex items-center gap-2">
          <OriginTag origin="climatiq" />
          <button type="button" onClick={onClear} className="text-xs text-fg-muted hover:text-fg hover:underline">
            Clear
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">Click regions on the map (or use “Add region”) to compare them side by side.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((e) => {
            const f = e.rows?.find((r) => r.day === day);
            const peak = e.rows ? peakOf(e.rows) : null;
            const maxT = e.rows?.reduce((m, r) => Math.max(m, r.tmax), -Infinity);
            return (
              <article key={e.code} className="rounded-2xl border border-line bg-glass-strong p-3">
                <header className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{e.name}</h3>
                    <p className="text-[11px] text-fg-subtle">{e.level === 'state' ? 'State / UT · centroid point' : 'District · centroid point'}</p>
                  </div>
                  <button type="button" onClick={() => onRemove(e.code)} className="rounded-lg p-1 text-fg-muted hover:bg-accent-soft hover:text-fg" aria-label={`Remove ${e.name} from comparison`}>
                    <X className="size-4" aria-hidden />
                  </button>
                </header>
                {e.rows == null ? (
                  <Skeleton className="h-28" />
                ) : (
                  <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs">
                    <dt className="text-fg-subtle">Severity</dt>
                    <dd>{f ? <SeverityBadge severity={f.sev} size="sm" /> : '—'}</dd>
                    <dt className="text-fg-subtle">Pred. Tmax</dt>
                    <dd className="tabular">{f ? `${f.tmax.toFixed(1)} °C (${f.lo.toFixed(1)}–${f.hi.toFixed(1)})` : '—'}</dd>
                    <dt className="text-fg-subtle">Departure</dt>
                    <dd className="tabular">{fmtDelta(f?.dep)}</dd>
                    <dt className="text-fg-subtle">Normal</dt>
                    <dd className="tabular">{fmtTemp(f?.normal)}</dd>
                    <dt className="text-fg-subtle">Confidence</dt>
                    <dd>{f ? <ConfidenceBadge confidence={f.conf} /> : '—'}</dd>
                    <dt className="text-fg-subtle">Peak (horizon)</dt>
                    <dd className="flex flex-wrap items-center gap-1">
                      {peak ? (
                        <>
                          <SeverityBadge severity={peak.sev as Severity} size="sm" />
                          <span className="text-fg-muted">{dayLabel(peak.day, { weekday: false })}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                    <dt className="text-fg-subtle">Max Tmax</dt>
                    <dd className="tabular">{maxT != null && Number.isFinite(maxT) ? `${maxT.toFixed(1)} °C` : '—'}</dd>
                    <dt className="text-fg-subtle">Days ≥ High</dt>
                    <dd className="tabular">{e.rows.filter((r) => SEVERITY_META[r.sev].rank >= 2).length}</dd>
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-3">
        <ProvenanceBadge kind="model_forecast" source="CLIMATIQ baseline-v1" />
      </p>
    </section>
  );
}

export function ForecastSummary({
  days,
  stateForecasts,
  districtSeverityByDay,
  day,
  onDay,
}: {
  days: string[];
  stateForecasts: MapForecast[];
  districtSeverityByDay: Record<string, Record<Severity, number>>;
  day: string | null;
  onDay: (d: string) => void;
}) {
  if (!days.length) return <p className="text-sm text-fg-muted">No forecast run available.</p>;
  return (
    <table className="w-full text-left text-xs">
      <caption className="sr-only">Forecast summary by target day</caption>
      <thead className="text-[10px] uppercase tracking-wide text-fg-subtle">
        <tr>
          <th scope="col" className="py-1 pr-2">Day</th>
          <th scope="col" className="py-1 pr-2 text-right">Max Tmax</th>
          <th scope="col" className="py-1 pr-2 text-right">States ≥ High</th>
          <th scope="col" className="py-1 text-right">Districts ≥ High</th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => {
          const rows = stateForecasts.filter((r) => r.day === d);
          const max = rows.reduce<MapForecast | null>((m, r) => (!m || r.tmax > m.tmax ? r : m), null);
          const sc = severityCounts(stateForecasts, d);
          const dc = districtSeverityByDay[d];
          return (
            <tr key={d} className={cn('border-t border-line', d === day && 'bg-accent-soft')}>
              <th scope="row" className="py-1 pr-2 font-medium">
                <button type="button" onClick={() => onDay(d)} aria-pressed={d === day} className="text-left text-fg underline-offset-2 hover:underline">
                  {dayLabel(d)} <span className="text-fg-subtle">D+{rows[0]?.h ?? '?'}</span>
                </button>
              </th>
              <td className="py-1 pr-2 text-right tabular" title={max ? max.name : undefined}>
                {max ? `${max.tmax.toFixed(1)} °C` : '—'}
              </td>
              <td className="py-1 pr-2 text-right tabular">{sc.high + sc.extreme}</td>
              <td className="py-1 text-right tabular">{dc ? dc.high + dc.extreme : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
