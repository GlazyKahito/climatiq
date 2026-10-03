'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Columns3, Flame, Layers, Map as MapIcon, RadioTower, Table2, ThermometerSun } from 'lucide-react';
import { ProvenanceBadge, OriginTag } from '@/components/ui/badges';
import { cn } from '@/lib/utils';
import { fmtDate, fmtRelative } from '@/lib/domain';
import { MapLegend } from '@/components/map/legend';
import { useIsDark, usePalette, DISTRICT_BOUNDARY_STATES } from '@/components/map/geo';
import { METRIC_META, valuesForDay } from '@/components/map/scales';
import type { GridPayload, MapForecast, MapMetric } from '@/components/map/types';
import type { CommandOverview } from '@/server/command/overview';
import { CollapsiblePanel } from './collapsible-panel';
import { MetricCards } from './metric-cards';
import { ComparePanel, dayLabel, ForecastSummary, RegionPanel, RegionTable, type CompareEntry } from './region-views';

const CommandMap = dynamic(() => import('@/components/map/command-map'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-fg-muted" aria-busy="true">
      Loading map…
    </div>
  ),
});

export type Focus = { state: string | null; district: string | null; city: string | null };
type Loadable<T> = T | 'loading' | 'error';

export function CommandCenter({ o, initialFocus, initialDay, sidePanels }: { o: CommandOverview; initialFocus: Focus; initialDay: string | null; sidePanels: ReactNode }) {
  const { run, days, states, stateForecasts } = o;
  const [day, setDay] = useState<string | null>(initialDay && days.includes(initialDay) ? initialDay : (days[0] ?? null));
  const [metric, setMetric] = useState<MapMetric>('severity');
  const [layers, setLayers] = useState({ choropleth: true, heat: false, stations: true });
  const [focus, setFocus] = useState<Focus>(initialFocus);
  const [view, setView] = useState<'map' | 'table'>('map');
  const [compareMode, setCompareMode] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [districts, setDistricts] = useState<Record<string, Loadable<MapForecast[]>>>({});
  const [grids, setGrids] = useState<Record<string, Loadable<GridPayload>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const dark = useIsDark();
  const palette = usePalette(dark);

  const stateMeta = useMemo(() => new Map(states.map((s) => [s.code, s])), [states]);
  const pilotNames = useMemo(() => states.filter((s) => s.isPilot).map((s) => s.name).join(', '), [states]);
  const isPilot = (code: string | null) => Boolean(code && stateMeta.get(code)?.isPilot && DISTRICT_BOUNDARY_STATES.has(code));

  const loadDistricts = useCallback(
    (stateCode: string) => {
      if (!run) return;
      setDistricts((d) => (d[stateCode] && d[stateCode] !== 'error' ? d : { ...d, [stateCode]: 'loading' }));
      fetch(`/api/v1/map/forecasts?level=district&parent=${encodeURIComponent(stateCode)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { data: MapForecast[] }) => setDistricts((d) => ({ ...d, [stateCode]: j.data })))
        .catch(() => setDistricts((d) => ({ ...d, [stateCode]: 'error' })));
    },
    [run],
  );

  // District forecasts for the focused pilot state (data fetching: marks the slot as loading, then fills it).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-focus; state transitions are loading → data/error
    if (focus.state && isPilot(focus.state) && districts[focus.state] === undefined) loadDistricts(focus.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.state]);

  // Heat grid for the selected day (lazy, only when the layer is on).
  useEffect(() => {
    if (!layers.heat || !day || grids[day] !== undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy fetch of the grid for the selected day
    setGrids((g) => ({ ...g, [day]: 'loading' }));
    fetch(`/api/v1/map/grid?day=${day}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { data: GridPayload }) => setGrids((g) => ({ ...g, [day]: j.data })))
      .catch(() => setGrids((g) => ({ ...g, [day]: 'error' })));
  }, [layers.heat, day, grids]);

  // Keep ?region= & ?day= in the URL (shareable deep link) without a server round-trip.
  useEffect(() => {
    const url = new URL(window.location.href);
    const region = focus.city ?? focus.district ?? focus.state;
    if (region) url.searchParams.set('region', region);
    else url.searchParams.delete('region');
    if (day) url.searchParams.set('day', day);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  }, [focus, day]);

  const stateValues = useMemo(() => (day ? valuesForDay(stateForecasts, day) : new Map<string, MapForecast>()), [stateForecasts, day]);
  const districtEntry = focus.state ? districts[focus.state] : undefined;
  const districtRows = Array.isArray(districtEntry) ? districtEntry : null;
  const districtValues = useMemo(() => (districtRows && day ? valuesForDay(districtRows, day) : null), [districtRows, day]);
  const districtStatus: 'idle' | 'loading' | 'error' | 'ready' | 'none' = !focus.state
    ? 'idle'
    : !isPilot(focus.state)
      ? 'none'
      : districtEntry === 'loading' || districtEntry === undefined
        ? 'loading'
        : districtEntry === 'error'
          ? 'error'
          : 'ready';

  const gridEntry = day ? grids[day] : undefined;
  const grid = gridEntry && typeof gridEntry === 'object' ? gridEntry : null;

  const selectState = (code: string | null) => {
    setFocus({ state: code, district: null, city: null });
    if (code && isPilot(code) && districts[code] === undefined) loadDistricts(code);
  };
  const selectDistrict = (code: string | null) => setFocus((f) => ({ ...f, district: code, city: null }));
  const toggleCompare = (code: string) => {
    setCompare((c) => {
      if (c.includes(code)) return c.filter((x) => x !== code);
      if (c.length >= 3) {
        setNotice('You can compare up to 3 regions. Remove one first.');
        return c;
      }
      return [...c, code];
    });
    // districts of another state need their forecasts for the comparison
    const st = code.split('-').slice(0, 2).join('-');
    if (code.split('-').length > 2 && districts[st] === undefined) loadDistricts(st);
  };

  const compareEntries: CompareEntry[] = compare.map((code) => {
    const isState = code.split('-').length === 2;
    if (isState) {
      return { code, name: stateMeta.get(code)?.name ?? code, level: 'state', rows: stateForecasts.filter((r) => r.code === code) };
    }
    const st = code.split('-').slice(0, 2).join('-');
    const entry = districts[st];
    const rows = Array.isArray(entry) ? entry.filter((r) => r.code === code) : null;
    return { code, name: rows?.[0]?.name ?? code, level: 'district', rows };
  });

  const crumbs = [
    { label: 'India', onClick: () => selectState(null), current: !focus.state },
    ...(focus.state ? [{ label: stateMeta.get(focus.state)?.name ?? focus.state, onClick: () => selectDistrict(null), current: !focus.district }] : []),
    ...(focus.district ? [{ label: districtValues?.get(focus.district)?.name ?? districtRows?.find((r) => r.code === focus.district)?.name ?? focus.district, onClick: () => {}, current: true }] : []),
  ];
  const back = () => (focus.district ? selectDistrict(null) : selectState(null));

  const tableRows = focus.state && districtRows && day ? districtRows.filter((r) => r.day === day) : stateForecasts.filter((r) => r.day === day);
  const tableLevel: 'state' | 'district' = focus.state && districtRows ? 'district' : 'state';
  const gridNote =
    gridEntry === 'loading'
      ? 'Loading grid…'
      : gridEntry === 'error'
        ? 'Grid could not be loaded.'
        : grid && !grid.points.length
          ? 'No gridded data stored for this day.'
          : grid
            ? `${grid.kind === 'reanalysis' ? 'ERA5 reanalysis (what actually happened)' : grid.kind === 'nwp_forecast' ? 'NWP guidance' : (grid.kind ?? '')} · ${grid.step}° cells`
            : undefined;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="flex flex-col gap-4">
      <MetricCards o={o} day={day} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(290px,350px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="glass overflow-hidden rounded-[var(--radius-glass)]" aria-labelledby="cq-map-h">
            <h2 id="cq-map-h" className="sr-only">
              Heat-risk map
            </h2>
            {/* Target-day selector */}
            {days.length > 0 && (
              <fieldset className="min-w-0 border-b border-line px-3 py-2.5">
                <legend className="sr-only">Target day</legend>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
                  <span className="mr-1 shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">Target day</span>
                  {days.map((d, i) => (
                    <label key={d} className="relative shrink-0 cursor-pointer">
                      <input type="radio" name="cq-day" value={d} checked={d === day} onChange={() => setDay(d)} className="peer sr-only" />
                      <span className="flex flex-col items-center rounded-xl border border-line px-2 py-1 text-xs text-fg-muted transition peer-checked:border-accent peer-checked:bg-wine peer-checked:text-sand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] hover:bg-accent-soft dark:peer-checked:bg-accent dark:peer-checked:text-accent-fg">
                        <span className="font-semibold whitespace-nowrap">{dayLabel(d, { weekday: false })}</span>
                        <span className="whitespace-nowrap text-[10px] opacity-80">
                          {fmtDate(d, { weekday: 'short' })} · D+{stateForecasts.find((r) => r.day === d)?.h ?? i + 1}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <fieldset className="flex min-w-0 items-center gap-1 rounded-xl border border-line p-0.5">
                <legend className="sr-only">Colour regions by</legend>
                {(['severity', 'tmax', 'departure'] as MapMetric[]).map((m) => (
                  <label key={m} className="cursor-pointer" title={METRIC_META[m].description}>
                    <input type="radio" name="cq-metric" value={m} checked={metric === m} onChange={() => setMetric(m)} className="peer sr-only" />
                    <span className="block rounded-lg px-2.5 py-1 text-xs text-fg-muted peer-checked:bg-accent-soft peer-checked:font-semibold peer-checked:text-fg peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)]">
                      {METRIC_META[m].short}
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="flex min-w-0 flex-wrap items-center gap-1">
                <legend className="sr-only">Map layers</legend>
                <Layers className="size-3.5 text-fg-subtle" aria-hidden />
                <LayerToggle label="Regions" icon={<MapIcon className="size-3.5" aria-hidden />} checked={layers.choropleth} onChange={(v) => setLayers((l) => ({ ...l, choropleth: v }))} />
                <LayerToggle label="Heat grid" icon={<Flame className="size-3.5" aria-hidden />} checked={layers.heat} onChange={(v) => setLayers((l) => ({ ...l, heat: v }))} />
                <LayerToggle label="Stations" icon={<RadioTower className="size-3.5" aria-hidden />} checked={layers.stations} onChange={(v) => setLayers((l) => ({ ...l, stations: v }))} />
              </fieldset>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="cq-jump">
                  Go to region
                </label>
                <select
                  id="cq-jump"
                  className="h-8 max-w-44 rounded-xl border border-line-strong bg-glass-strong px-2 text-xs text-fg"
                  value={focus.district ?? focus.state ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) selectState(null);
                    else if (v.split('-').length === 2) selectState(v);
                    else selectDistrict(v);
                  }}
                >
                  <option value="">All India</option>
                  <optgroup label="States & UTs">
                    {states.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                        {s.isPilot ? ' (pilot)' : ''}
                      </option>
                    ))}
                  </optgroup>
                  {districtRows && focus.state && (
                    <optgroup label={`Districts of ${stateMeta.get(focus.state)?.name ?? focus.state}`}>
                      {[...new Map(districtRows.map((r) => [r.code, r.name])).entries()]
                        .sort((a, b) => a[1].localeCompare(b[1]))
                        .map(([code, name]) => (
                          <option key={code} value={code}>
                            {name}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
                <button
                  type="button"
                  aria-pressed={compareMode}
                  onClick={() => setCompareMode((c) => !c)}
                  className={cn('inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs', compareMode ? 'border-accent bg-accent-soft font-semibold text-fg' : 'border-line text-fg-muted hover:bg-accent-soft')}
                >
                  <Columns3 className="size-3.5" aria-hidden /> Compare{compare.length ? ` (${compare.length})` : ''}
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'table'}
                  onClick={() => setView((v) => (v === 'map' ? 'table' : 'map'))}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-line px-2.5 text-xs text-fg-muted hover:bg-accent-soft"
                >
                  {view === 'map' ? <Table2 className="size-3.5" aria-hidden /> : <MapIcon className="size-3.5" aria-hidden />}
                  {view === 'map' ? 'View as table' : 'View map'}
                </button>
              </div>
            </div>

            {/* Map / table */}
            <div className="relative h-[62vh] min-h-[380px] lg:h-[min(68vh,700px)]" data-tour="map">
              {view === 'map' ? (
                <CommandMap
                  dark={dark}
                  palette={palette}
                  states={states}
                  stateValues={stateValues}
                  districtValues={districtValues}
                  focusState={focus.state}
                  focusDistrict={focus.district}
                  metric={metric}
                  layers={layers}
                  grid={grid}
                  stations={o.stations.items}
                  compare={compare}
                  compareMode={compareMode}
                  onSelectState={selectState}
                  onSelectDistrict={selectDistrict}
                  onToggleCompare={toggleCompare}
                  onBoundaryError={setNotice}
                />
              ) : (
                <RegionTable
                  rows={tableRows}
                  level={tableLevel}
                  day={day}
                  run={run}
                  scopeLabel={focus.state && districtRows ? `districts of ${stateMeta.get(focus.state)?.name}` : 'states and union territories'}
                  onPick={(code) => (compareMode ? toggleCompare(code) : tableLevel === 'state' ? selectState(code) : selectDistrict(code))}
                />
              )}

              {/* Breadcrumb + back (drilldown) */}
              <nav aria-label="Map drilldown" data-tour="drilldown" className="glass-strong absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-xl px-1.5 py-1 text-xs">
                {focus.state && (
                  <button type="button" onClick={back} className="rounded-lg p-1 text-fg-muted hover:bg-accent-soft hover:text-fg" aria-label="Back one level">
                    <ChevronLeft className="size-4" aria-hidden />
                  </button>
                )}
                <ol className="flex min-w-0 items-center gap-1">
                  {crumbs.map((c, i) => (
                    <li key={c.label} className="flex min-w-0 items-center gap-1">
                      {i > 0 && <ChevronRight className="size-3 shrink-0 text-fg-subtle" aria-hidden />}
                      {c.current ? (
                        <span aria-current="location" className="truncate font-semibold text-fg">
                          {c.label}
                        </span>
                      ) : (
                        <button type="button" onClick={c.onClick} className="truncate rounded px-1 text-fg-muted hover:text-fg hover:underline">
                          {c.label}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                {districtStatus === 'loading' && <span className="ml-1 text-[10px] text-fg-subtle">loading districts…</span>}
                {districtStatus === 'none' && <span className="ml-1 hidden text-[10px] text-fg-subtle sm:inline">state-level only</span>}
              </nav>

              {view === 'map' && (
                <MapLegend
                  className="absolute bottom-2 left-2 z-10"
                  metric={metric}
                  palette={palette}
                  showChoropleth={layers.choropleth}
                  showHeat={layers.heat}
                  showStations={layers.stations}
                  heatNote={gridNote}
                />
              )}
              {compareMode && view === 'map' && (
                <p className="glass-strong absolute right-2 top-2 z-10 max-w-56 rounded-xl px-2.5 py-1.5 text-[11px] text-fg">Compare mode: click up to 3 regions.</p>
              )}
              <p aria-live="polite" className={cn('glass-strong absolute left-1/2 top-12 z-20 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] text-fg', !notice && 'sr-only')}>
                {notice ?? ''}
              </p>
            </div>

            <footer className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px] text-fg-muted">
              {run ? (
                <ProvenanceBadge
                  kind="model_forecast"
                  source={`CLIMATIQ ${run.modelKey}${run.isHindcast ? ' hindcast' : ''}, issued for ${dayLabel(run.issuedFor, { weekday: false })}`}
                  updated={fmtRelative(run.createdAt)}
                />
              ) : (
                <span>No forecast run for this scenario yet — boundaries and stations only.</span>
              )}
              <OriginTag origin="climatiq" />
              {layers.heat && grid?.kind && <ProvenanceBadge kind={grid.kind} source={grid.sources.join(', ')} updated={day ? dayLabel(day, { weekday: false }) : undefined} />}
              {layers.stations && o.stations.summary.simulated > 0 && <ProvenanceBadge kind="simulated" source="demo stations" />}
              <span className="basis-full text-fg-subtle sm:basis-auto">
                States are single-centroid estimates (coarse); district detail for pilot states. Boundaries approximate, not authenticated by Survey of India.
              </span>
            </footer>
          </section>

          {(compareMode || compare.length > 0) && (
            <div>
              <ComparePanel entries={compareEntries} day={day} onRemove={(c) => setCompare((x) => x.filter((y) => y !== c))} onClear={() => setCompare([])} />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <label htmlFor="cq-add-compare" className="text-fg-muted">
                  Add region
                </label>
                <select
                  id="cq-add-compare"
                  className="h-8 rounded-xl border border-line-strong bg-glass-strong px-2 text-xs"
                  value=""
                  onChange={(e) => e.target.value && toggleCompare(e.target.value)}
                  disabled={compare.length >= 3}
                >
                  <option value="">Choose…</option>
                  <optgroup label="States & UTs">
                    {states
                      .filter((s) => !compare.includes(s.code))
                      .map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                  </optgroup>
                  {Object.entries(districts).map(([st, rows]) =>
                    Array.isArray(rows) ? (
                      <optgroup key={st} label={`Districts of ${stateMeta.get(st)?.name ?? st}`}>
                        {[...new Map(rows.map((r) => [r.code, r.name])).entries()]
                          .filter(([code]) => !compare.includes(code))
                          .sort((a, b) => a[1].localeCompare(b[1]))
                          .map(([code, name]) => (
                            <option key={code} value={code}>
                              {name}
                            </option>
                          ))}
                      </optgroup>
                    ) : null,
                  )}
                </select>
              </div>
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3" aria-label="Situation panels">
          <CollapsiblePanel
            id="focus"
            title={focus.district ? 'District forecast' : focus.state ? 'State forecast' : 'Regional overview'}
            description={day ? `Target day ${dayLabel(day)}` : undefined}
            icon={<ThermometerSun className="size-4" aria-hidden />}
          >
            <RegionPanel
              run={run}
              day={day}
              states={states}
              stateForecasts={stateForecasts}
              focus={focus}
              districtRows={districtRows}
              districtStatus={districtStatus}
              onFocusState={selectState}
              onFocusDistrict={selectDistrict}
              onDay={setDay}
              pilotNames={pilotNames}
            />
          </CollapsiblePanel>
          <CollapsiblePanel
            id="summary"
            title="Forecast summary"
            description={run ? `${days.length}-day horizon · ${run.isHindcast ? 'hindcast' : 'forecast'}` : undefined}
            footer={run ? <ProvenanceBadge kind="model_forecast" source={`CLIMATIQ ${run.modelKey}`} updated={fmtRelative(run.createdAt)} /> : undefined}
          >
            <ForecastSummary days={days} stateForecasts={stateForecasts} districtSeverityByDay={o.districtSeverityByDay} day={day} onDay={setDay} />
          </CollapsiblePanel>
          {sidePanels}
        </aside>
      </div>
    </div>
  );
}

function LayerToggle({ label, icon, checked, onChange }: { label: string; icon: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="inline-flex h-8 items-center gap-1 rounded-xl border border-line px-2 text-xs text-fg-muted peer-checked:border-accent/50 peer-checked:bg-accent-soft peer-checked:text-fg peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)]">
        {icon}
        {label}
      </span>
    </label>
  );
}
