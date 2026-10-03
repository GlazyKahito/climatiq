'use client';

/**
 * Command-center map: state choropleth → (pilot) district choropleth drilldown, heat grid, station markers,
 * hover tooltips and click selection. Presentational — all state lives in the parent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Marker, Popup, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { fmtDelta, fmtRelative, fmtTemp, SEVERITY_META } from '@/lib/domain';
import { BaseMap, useLabelBeforeId } from './base-map';
import { DISTRICT_BOUNDARY_STATES, districtsTopoUrl, STATES_TOPO_URL, useBoundaries } from './geo';
import { bboxOf, decorateRegions, gridCells, INDIA_BOUNDS, metricValueLabel, type Palette } from './scales';
import { StationDot } from './station-dot';
import type { GridPayload, MapForecast, MapMetric, MapStation, StateMeta } from './types';

export type CommandMapProps = {
  dark: boolean;
  palette: Palette;
  states: StateMeta[];
  stateValues: Map<string, MapForecast>;
  districtValues: Map<string, MapForecast> | null;
  focusState: string | null;
  focusDistrict: string | null;
  metric: MapMetric;
  layers: { choropleth: boolean; heat: boolean; stations: boolean };
  grid: GridPayload | null;
  stations: MapStation[];
  compare: string[];
  compareMode: boolean;
  onSelectState: (code: string) => void;
  onSelectDistrict: (code: string) => void;
  onToggleCompare: (code: string) => void;
  onBoundaryError?: (msg: string) => void;
};

type Hover = { x: number; y: number; code: string; name: string; level: 'state' | 'district' } | null;

export default function CommandMap(props: CommandMapProps) {
  const { dark, palette, states, stateValues, districtValues, focusState, focusDistrict, metric, layers, grid, stations, compare, compareMode } = props;
  const mapRef = useRef<MapRef>(null);
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<Hover>(null);
  const [popup, setPopup] = useState<MapStation | null>(null);
  const [loaded, setLoaded] = useState(false);

  const statesGeo = useBoundaries(STATES_TOPO_URL, 'states');
  const hasDistrictBoundaries = focusState != null && DISTRICT_BOUNDARY_STATES.has(focusState);
  const districtsGeo = useBoundaries(hasDistrictBoundaries ? districtsTopoUrl(focusState!) : null, 'districts');

  const { onBoundaryError } = props;
  useEffect(() => {
    const err = statesGeo.error ?? districtsGeo.error;
    if (err) onBoundaryError?.(err);
  }, [statesGeo.error, districtsGeo.error, onBoundaryError]);

  const pilotCodes = useMemo(() => new Set(states.filter((s) => s.isPilot).map((s) => s.code)), [states]);
  const stateFC = useMemo(
    () => (statesGeo.data ? decorateRegions(statesGeo.data, stateValues, metric, palette, pilotCodes) : null),
    [statesGeo.data, stateValues, metric, palette, pilotCodes],
  );
  const districtFC = useMemo(
    () => (districtsGeo.data && districtValues ? decorateRegions(districtsGeo.data, districtValues, metric, palette) : null),
    [districtsGeo.data, districtValues, metric, palette],
  );
  const gridFC = useMemo(() => (grid && grid.points.length ? gridCells(grid.points, grid.step, palette) : null), [grid, palette]);

  // Fit the camera to the focused region (district > state > India).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    let bounds = INDIA_BOUNDS as ReturnType<typeof bboxOf>;
    // A selected district keeps the state framing (context matters more than a tight zoom).
    if (focusState && statesGeo.data) {
      const f = statesGeo.data.features.find((x) => x.properties?.code === focusState);
      bounds = bboxOf(f?.geometry) ?? bounds;
    }
    if (bounds) map.fitBounds(bounds, { padding: { top: 70, bottom: 50, left: 40, right: 40 }, duration: reduce ? 0 : 900, maxZoom: 8.5 });
  }, [focusState, statesGeo.data, loaded, reduce]);

  const interactive = useMemo(() => {
    const ids: string[] = [];
    if (stateFC) ids.push('cq-state-fill');
    if (districtFC) ids.push('cq-district-fill');
    return ids;
  }, [stateFC, districtFC]);

  const onMouseMove = (e: MapLayerMouseEvent) => {
    const f = e.features?.find((x) => x.layer.id === 'cq-district-fill') ?? e.features?.[0];
    if (!f) return setHover(null);
    const level = f.layer.id === 'cq-district-fill' ? 'district' : 'state';
    if (level === 'state' && districtFC && f.properties?.code === focusState) return setHover(null);
    setHover({ x: e.point.x, y: e.point.y, code: String(f.properties?.code), name: String(f.properties?.name), level });
  };

  const onClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.find((x) => x.layer.id === 'cq-district-fill') ?? e.features?.[0];
    if (!f) return;
    const code = String(f.properties?.code);
    if (f.layer.id === 'cq-district-fill') {
      if (compareMode) props.onToggleCompare(code);
      else props.onSelectDistrict(code);
    } else if (!(districtFC && code === focusState)) {
      if (compareMode) props.onToggleCompare(code);
      else props.onSelectState(code);
    }
  };

  const hovered = hover ? (hover.level === 'district' ? districtValues?.get(hover.code) : stateValues.get(hover.code)) : undefined;
  const hoveredMeta = hover?.level === 'state' ? states.find((s) => s.code === hover.code) : undefined;

  return (
    <BaseMap
      ref={mapRef}
      dark={dark}
      ariaLabel="Interactive heat-risk map of India. Use the region selector or the table view for keyboard access."
      interactiveLayerIds={interactive}
      cursor={hover ? 'pointer' : undefined}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHover(null)}
      onClick={onClick}
      onLoad={() => setLoaded(true)}
      overlay={
        hover && (
          <div
            className="glass-strong pointer-events-none absolute z-20 min-w-44 max-w-64 rounded-xl px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(hover.x + 14, 9999), top: hover.y + 14 }}
            role="tooltip"
          >
            <p className="font-semibold text-fg">{hover.name}</p>
            {hovered ? (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-fg-muted">
                <dt>Severity</dt>
                <dd className="font-medium" style={{ color: `var(--sev-${hovered.sev}-fg)` }}>
                  {SEVERITY_META[hovered.sev].label}
                </dd>
                <dt>Pred. Tmax</dt>
                <dd className="tabular">
                  {fmtTemp(hovered.tmax)} <span className="opacity-70">({hovered.lo.toFixed(1)}–{hovered.hi.toFixed(1)})</span>
                </dd>
                <dt>Departure</dt>
                <dd className="tabular">{fmtDelta(hovered.dep)}</dd>
              </dl>
            ) : (
              <p className="mt-1 text-fg-muted">No forecast for this day</p>
            )}
            <p className="mt-1 text-[10px] text-fg-subtle">
              {hover.level === 'state'
                ? hoveredMeta?.isPilot
                  ? 'State centroid estimate · click for districts'
                  : 'State-level only (single centroid point → coarse)'
                : 'District-centroid estimate'}
              {compareMode ? ' · click to compare' : ''}
            </p>
            <span className="sr-only">{metricValueLabel(metric, hovered)}</span>
          </div>
        )
      }
    >
      {stateFC && <StateLayers fc={stateFC} palette={palette} visible={layers.choropleth} focusState={focusState} drilled={Boolean(districtFC)} compare={compare} />}
      {districtFC && <DistrictLayers fc={districtFC} palette={palette} visible={layers.choropleth} focusDistrict={focusDistrict} compare={compare} />}
      {gridFC && layers.heat && (
        <Source id="cq-grid" type="geojson" data={gridFC}>
          <Layer id="cq-grid-fill" type="fill" beforeId={districtFC ? 'cq-district-line' : stateFC ? 'cq-state-line' : undefined} paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.62, 'fill-antialias': false }} />
        </Source>
      )}
      {layers.stations &&
        stations.map((s) => (
          <Marker key={s.code} longitude={s.lon} latitude={s.lat} anchor="center">
            <button
              type="button"
              className="grid size-6 place-items-center rounded-full focus-visible:outline-2"
              aria-label={`${s.name}${s.isSimulated ? ' — simulated station' : ''}, ${s.status}${s.latestTempC != null ? `, ${s.latestTempC.toFixed(1)} °C` : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setPopup(s);
              }}
            >
              <StationDot status={s.status} simulated={s.isSimulated} />
            </button>
          </Marker>
        ))}
      {popup && (
        <Popup longitude={popup.lon} latitude={popup.lat} anchor="bottom" offset={14} onClose={() => setPopup(null)} closeButton closeOnClick={false} maxWidth="260px">
          <StationPopup s={popup} />
        </Popup>
      )}
    </BaseMap>
  );
}

function StateLayers({
  fc,
  palette,
  visible,
  focusState,
  drilled,
  compare,
}: {
  fc: GeoJSON.FeatureCollection;
  palette: Palette;
  visible: boolean;
  focusState: string | null;
  drilled: boolean;
  compare: string[];
}) {
  const beforeId = useLabelBeforeId();
  const vis = visible ? 'visible' : 'none';
  const baseOpacity = focusState ? 0.35 : 0.74;
  return (
    <Source id="cq-states" type="geojson" data={fc} promoteId="code">
      <Layer
        id="cq-state-fill"
        type="fill"
        beforeId={beforeId}
        layout={{ visibility: vis }}
        paint={{
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['==', ['get', 'code'], focusState ?? ''], drilled ? 0 : 0.85, baseOpacity],
        }}
      />
      <Layer id="cq-state-line" type="line" beforeId={beforeId} paint={{ 'line-color': palette.line, 'line-width': 0.8 }} />
      <Layer
        id="cq-state-focus"
        type="line"
        filter={['==', ['get', 'code'], focusState ?? '']}
        paint={{ 'line-color': palette.lineStrong, 'line-width': 2.2 }}
      />
      <Layer
        id="cq-state-compare"
        type="line"
        filter={['in', ['get', 'code'], ['literal', compare]]}
        paint={{ 'line-color': palette.accent, 'line-width': 2.5, 'line-dasharray': [2, 1.5] }}
      />
    </Source>
  );
}

function DistrictLayers({
  fc,
  palette,
  visible,
  focusDistrict,
  compare,
}: {
  fc: GeoJSON.FeatureCollection;
  palette: Palette;
  visible: boolean;
  focusDistrict: string | null;
  compare: string[];
}) {
  const beforeId = useLabelBeforeId();
  return (
    <Source id="cq-districts" type="geojson" data={fc} promoteId="code">
      <Layer
        id="cq-district-fill"
        type="fill"
        beforeId={beforeId}
        layout={{ visibility: visible ? 'visible' : 'none' }}
        paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'code'], focusDistrict ?? ''], 0.95, 0.8] }}
      />
      <Layer id="cq-district-line" type="line" beforeId={beforeId} paint={{ 'line-color': palette.line, 'line-width': 0.6 }} />
      <Layer id="cq-district-focus" type="line" filter={['==', ['get', 'code'], focusDistrict ?? '']} paint={{ 'line-color': palette.lineStrong, 'line-width': 2.4 }} />
      <Layer
        id="cq-district-compare"
        type="line"
        filter={['in', ['get', 'code'], ['literal', compare]]}
        paint={{ 'line-color': palette.accent, 'line-width': 2.5, 'line-dasharray': [2, 1.5] }}
      />
    </Source>
  );
}

function StationPopup({ s }: { s: MapStation }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-[#22070e]">
      <p className="font-semibold">{s.name}</p>
      {s.isSimulated && (
        <p className="w-fit rounded border border-dashed border-[#8a5a00] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a5a00]">
          Simulated — not a real station
        </p>
      )}
      <p>
        <span className="font-medium capitalize">{s.status}</span>
        {s.lastSeenAt ? ` · last report ${fmtRelative(s.lastSeenAt)}` : ' · never reported'}
      </p>
      {s.latestTempC != null && (
        <p className="tabular">
          Latest {fmtTemp(s.latestTempC)} {s.isSimulated ? '(simulated)' : '(unverified)'}
        </p>
      )}
      <Link href={`/stations/${s.code}`} className={cn('mt-1 font-semibold text-[#7f011f] underline underline-offset-2')}>
        Station details →
      </Link>
    </div>
  );
}
