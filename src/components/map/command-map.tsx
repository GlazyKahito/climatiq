'use client';

/**
 * Command-center map: state choropleth → (pilot) district choropleth drilldown, heat grid, station markers,
 * hover tooltips and click selection. Presentational — all state lives in the parent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Marker, Popup, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { ExpressionSpecification } from 'maplibre-gl';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Box, Map as MapIcon, Maximize } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDelta, fmtRelative, fmtTemp, SEVERITY_META } from '@/lib/domain';
import { BaseMap, useLabelBeforeId } from './base-map';
import { DISTRICT_BOUNDARY_STATES, districtsTopoUrl, STATES_TOPO_URL, useBoundaries } from './geo';
import { bboxOf, decorateRegions, extrusionHeight, gridCells, INDIA_BOUNDS, metricValueLabel, type Palette } from './scales';

/** 3D camera: tilted toward the horizon and turned slightly so the blocks' faces catch the light. */
const PITCH_3D = 45;
const BEARING_3D = -12;
const PADDING = { top: 70, bottom: 50, left: 40, right: 40 };

/**
 * Fill layer ids per view. 2D fills and 3D extrusions use different ids: MapLibre fails while rendering if a layer is
 * replaced by one of another type under the same id.
 */
const LAYER = {
  state: (threeD: boolean) => (threeD ? 'cq-state-3d' : 'cq-state-fill'),
  district: (threeD: boolean) => (threeD ? 'cq-district-3d' : 'cq-district-fill'),
};
const isDistrictLayer = (id: string) => id === 'cq-district-fill' || id === 'cq-district-3d';

/** Ground outlines: always in 2D; in 3D only under the heat-grid columns, where the regions are a flat plinth. */
const outlines = (threeD: boolean, flat: boolean) => (!threeD || flat ? 'visible' : 'none');

/** Fill colour with hover / focus / compare lifted to the lighter variant (3D has no outline to show them). */
const liftedColor = (focus: string | null, compare: string[]): ExpressionSpecification => [
  'case',
  ['boolean', ['feature-state', 'hover'], false],
  ['get', 'colorHi'],
  ['==', ['get', 'code'], focus ?? ''],
  ['get', 'colorHi'],
  ['in', ['get', 'code'], ['literal', compare]],
  ['get', 'colorHi'],
  ['get', 'color'],
];
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
  const [threeD, setThreeD] = useState(true);
  const threeDRef = useRef(threeD);
  const hoverKey = useRef<{ source: string; id: string } | null>(null);

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

  // Fit the camera to the focused region (district > state > India), keeping the current 2D/3D tilt.
  const frame = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    let bounds = INDIA_BOUNDS as ReturnType<typeof bboxOf>;
    // A selected district keeps the state framing (context matters more than a tight zoom).
    if (focusState && statesGeo.data) {
      const f = statesGeo.data.features.find((x) => x.properties?.code === focusState);
      bounds = bboxOf(f?.geometry) ?? bounds;
    }
    const tilt = threeDRef.current;
    if (bounds)
      map.fitBounds(bounds, {
        padding: PADDING,
        duration: reduce ? 0 : 1100,
        maxZoom: 8.5,
        pitch: tilt ? PITCH_3D : 0,
        bearing: tilt ? BEARING_3D : 0,
      });
  }, [focusState, statesGeo.data, reduce]);
  useEffect(() => {
    if (loaded) frame();
  }, [loaded, frame]);

  const setMode = (next: boolean) => {
    threeDRef.current = next;
    setThreeD(next);
    mapRef.current?.easeTo({ pitch: next ? PITCH_3D : 0, bearing: next ? BEARING_3D : 0, duration: reduce ? 0 : 900 });
  };

  // Hover highlight via feature-state (promoteId = code), so only the hovered region repaints.
  const setHoverState = (next: { source: string; id: string } | null) => {
    const map = mapRef.current?.getMap();
    const prev = hoverKey.current;
    if (prev && (prev.id !== next?.id || prev.source !== next?.source)) map?.setFeatureState(prev, { hover: false });
    if (next && (prev?.id !== next.id || prev?.source !== next.source)) map?.setFeatureState(next, { hover: true });
    hoverKey.current = next;
  };

  const interactive = useMemo(() => {
    const ids: string[] = [];
    if (stateFC) ids.push(LAYER.state(threeD));
    if (districtFC) ids.push(LAYER.district(threeD));
    return ids;
  }, [stateFC, districtFC, threeD]);

  const onMouseMove = (e: MapLayerMouseEvent) => {
    const f = e.features?.find((x) => isDistrictLayer(x.layer.id)) ?? e.features?.[0];
    const level = f && isDistrictLayer(f.layer.id) ? 'district' : 'state';
    if (!f || (level === 'state' && districtFC && f.properties?.code === focusState)) {
      setHoverState(null);
      return setHover(null);
    }
    const code = String(f.properties?.code);
    setHoverState({ source: level === 'district' ? 'cq-districts' : 'cq-states', id: code });
    setHover({ x: e.point.x, y: e.point.y, code, name: String(f.properties?.name), level });
  };

  const onClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.find((x) => isDistrictLayer(x.layer.id)) ?? e.features?.[0];
    if (!f) return;
    const code = String(f.properties?.code);
    if (isDistrictLayer(f.layer.id)) {
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
      onMouseLeave={() => {
        setHoverState(null);
        setHover(null);
      }}
      onClick={onClick}
      onLoad={() => setLoaded(true)}
      pitch={PITCH_3D}
      bearing={BEARING_3D}
      overlay={
        <>
          <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
            <div className="glass-strong flex items-center gap-1 rounded-xl p-1 text-xs shadow-lg" role="group" aria-label="Map view">
              {(
                [
                  [false, '2D', MapIcon],
                  [true, '3D', Box],
                ] as const
              ).map(([mode, label, Icon]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={threeD === mode}
                  onClick={() => setMode(mode)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold transition',
                    threeD === mode ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-accent-soft hover:text-fg',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden /> {label}
                </button>
              ))}
              <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
              <button
                type="button"
                onClick={frame}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-fg-muted transition hover:bg-accent-soft hover:text-fg"
                title="Reset view"
              >
                <Maximize className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Reset view</span>
                <span className="sr-only sm:hidden">Reset view</span>
              </button>
            </div>
            {threeD && (
              <p className="glass-strong rounded-lg px-2 py-1 text-[10px] text-fg-muted">
                Height = predicted Tmax · right-drag or Ctrl+drag to tilt and rotate
              </p>
            )}
          </div>
          {hover && (
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
          )}
        </>
      }
    >
      {stateFC && (
        <StateLayers
          fc={stateFC}
          palette={palette}
          visible={layers.choropleth}
          focusState={focusState}
          drilled={Boolean(districtFC)}
          compare={compare}
          threeD={threeD}
          flat={Boolean(gridFC && layers.heat)}
        />
      )}
      {districtFC && (
        <DistrictLayers
          fc={districtFC}
          palette={palette}
          visible={layers.choropleth}
          focusDistrict={focusDistrict}
          compare={compare}
          threeD={threeD}
          flat={Boolean(gridFC && layers.heat)}
        />
      )}
      {gridFC && layers.heat && <GridLayer fc={gridFC} threeD={threeD} below2d={districtFC ? 'cq-district-line' : stateFC ? 'cq-state-line' : undefined} />}
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
  threeD,
  flat,
}: {
  fc: GeoJSON.FeatureCollection;
  palette: Palette;
  visible: boolean;
  focusState: string | null;
  drilled: boolean;
  compare: string[];
  threeD: boolean;
  /** the heat-grid columns are showing: keep the states as a low plinth under them */
  flat: boolean;
}) {
  const beforeId = useLabelBeforeId();
  const vis = visible ? 'visible' : 'none';
  const baseOpacity = focusState ? 0.35 : 0.74;
  return (
    <Source id="cq-states" type="geojson" data={fc} promoteId="code">
      {threeD ? (
        <Layer
          key="state-3d"
          id="cq-state-3d"
          type="fill-extrusion"
          beforeId={beforeId}
          layout={{ visibility: vis }}
          // a drilled-into state makes way for its districts
          filter={drilled && focusState ? ['!=', ['get', 'code'], focusState] : ['has', 'code']}
          paint={{
            'fill-extrusion-color': liftedColor(focusState, compare),
            'fill-extrusion-height': flat ? 1500 : extrusionHeight(),
            'fill-extrusion-opacity': flat ? 0.5 : focusState ? 0.62 : 0.94,
            'fill-extrusion-vertical-gradient': true,
          }}
        />
      ) : (
        <Layer
          key="state-2d"
          id="cq-state-fill"
          type="fill"
          beforeId={beforeId}
          layout={{ visibility: vis }}
          paint={{
            'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], ['get', 'colorHi'], ['get', 'color']],
            'fill-opacity': ['case', ['==', ['get', 'code'], focusState ?? ''], drilled ? 0 : 0.85, baseOpacity],
          }}
        />
      )}
      {/* ground outlines would float across tall blocks, so 3D relies on the lifted colours instead */}
      <Layer id="cq-state-line" type="line" beforeId={beforeId} layout={{ visibility: outlines(threeD, flat) }} paint={{ 'line-color': palette.line, 'line-width': 0.8 }} />
      <Layer
        id="cq-state-focus"
        type="line"
        filter={['==', ['get', 'code'], focusState ?? '']}
        layout={{ visibility: outlines(threeD, flat) }}
        paint={{ 'line-color': palette.lineStrong, 'line-width': 2.2 }}
      />
      <Layer
        id="cq-state-compare"
        type="line"
        filter={['in', ['get', 'code'], ['literal', compare]]}
        layout={{ visibility: outlines(threeD, flat) }}
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
  threeD,
  flat,
}: {
  fc: GeoJSON.FeatureCollection;
  palette: Palette;
  visible: boolean;
  focusDistrict: string | null;
  compare: string[];
  threeD: boolean;
  flat: boolean;
}) {
  const beforeId = useLabelBeforeId();
  return (
    <Source id="cq-districts" type="geojson" data={fc} promoteId="code">
      {threeD ? (
        <Layer
          key="district-3d"
          id="cq-district-3d"
          type="fill-extrusion"
          beforeId={beforeId}
          layout={{ visibility: visible ? 'visible' : 'none' }}
          paint={{
            'fill-extrusion-color': liftedColor(focusDistrict, compare),
            'fill-extrusion-height': flat ? 1500 : extrusionHeight(),
            'fill-extrusion-opacity': flat ? 0.5 : 0.95,
            'fill-extrusion-vertical-gradient': true,
          }}
        />
      ) : (
        <Layer
          key="district-2d"
          id="cq-district-fill"
          type="fill"
          beforeId={beforeId}
          layout={{ visibility: visible ? 'visible' : 'none' }}
          paint={{
            'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], ['get', 'colorHi'], ['get', 'color']],
            'fill-opacity': ['case', ['==', ['get', 'code'], focusDistrict ?? ''], 0.95, 0.8],
          }}
        />
      )}
      <Layer id="cq-district-line" type="line" beforeId={beforeId} layout={{ visibility: outlines(threeD, flat) }} paint={{ 'line-color': palette.line, 'line-width': 0.6 }} />
      <Layer
        id="cq-district-focus"
        type="line"
        filter={['==', ['get', 'code'], focusDistrict ?? '']}
        layout={{ visibility: outlines(threeD, flat) }}
        paint={{ 'line-color': palette.lineStrong, 'line-width': 2.4 }}
      />
      <Layer
        id="cq-district-compare"
        type="line"
        filter={['in', ['get', 'code'], ['literal', compare]]}
        layout={{ visibility: outlines(threeD, flat) }}
        paint={{ 'line-color': palette.accent, 'line-width': 2.5, 'line-dasharray': [2, 1.5] }}
      />
    </Source>
  );
}

/** Heat grid: flat cells under the region outlines in 2D; in 3D each 1° cell is a column (height and colour = Tmax). */
function GridLayer({ fc, threeD, below2d }: { fc: GeoJSON.FeatureCollection; threeD: boolean; below2d: string | undefined }) {
  const beforeId = useLabelBeforeId();
  return (
    <Source id="cq-grid" type="geojson" data={fc}>
      {threeD ? (
        <Layer
          key="grid-3d"
          id="cq-grid-3d"
          type="fill-extrusion"
          beforeId={beforeId}
          paint={{ 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': extrusionHeight(), 'fill-extrusion-opacity': 0.92 }}
        />
      ) : (
        <Layer key="grid-2d" id="cq-grid-fill" type="fill" beforeId={below2d} paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.62, 'fill-antialias': false }} />
      )}
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
