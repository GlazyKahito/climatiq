/**
 * Map colour scales, legends and GeoJSON shaping helpers (pure — unit-tested in tests/unit/map-shaping.test.ts).
 * Colours come from the CSS design tokens at runtime (see readPalette); every scale has text labels for the legend.
 */
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from 'geojson';
import type { ExpressionSpecification } from 'maplibre-gl';
import { fmtDelta, fmtTemp, SEVERITY_META, type Severity } from '@/lib/domain';
import type { MapForecast, MapMetric } from './types';

export type Palette = {
  dark: boolean;
  sev: Record<Severity, string>;
  heat: string[]; // 7 steps, cool sand → wine
  cool: [string, string]; // below-normal departures
  neutral: string;
  noData: string;
  line: string;
  lineStrong: string;
  fg: string;
  bg: string;
  accent: string;
};

export const LIGHT_PALETTE: Palette = {
  dark: false,
  sev: { low: '#2e7d6b', moderate: '#b07a06', high: '#d1501a', extreme: '#7f011f' },
  heat: ['#f3ead2', '#f0d58f', '#eaa54c', '#d9672b', '#b52a2a', '#7f011f', '#4a0012'],
  cool: ['#3f6f96', '#93b3cc'],
  neutral: '#e6d9b8',
  noData: '#c9bfae',
  line: 'rgba(74,0,18,0.35)',
  lineStrong: '#22070e',
  fg: '#22070e',
  bg: '#f5ebd0',
  accent: '#7f011f',
};

export const DARK_PALETTE: Palette = {
  dark: true,
  sev: { low: '#4fbfa3', moderate: '#e5b13a', high: '#f07a3f', extreme: '#ff5d7a' },
  heat: ['#2a1218', '#5a2a14', '#eaa54c', '#d9672b', '#b52a2a', '#7f011f', '#4a0012'],
  cool: ['#5d93c2', '#2f5675'],
  neutral: '#3b2a2f',
  noData: '#4a3d40',
  line: 'rgba(238,224,199,0.35)',
  lineStrong: '#eee0c7',
  fg: '#eee0c7',
  bg: '#22070e',
  accent: '#e24a67',
};

/** Reads the palette from CSS custom properties (client only); falls back to the static palettes. */
export function readPalette(dark: boolean): Palette {
  const base = dark ? DARK_PALETTE : LIGHT_PALETTE;
  if (typeof window === 'undefined') return base;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ...base,
    sev: {
      low: v('--sev-low', base.sev.low),
      moderate: v('--sev-moderate', base.sev.moderate),
      high: v('--sev-high', base.sev.high),
      extreme: v('--sev-extreme', base.sev.extreme),
    },
    heat: base.heat.map((c, i) => v(`--heat-${i}`, c)),
    fg: v('--fg', base.fg),
    bg: v('--bg', base.bg),
    accent: v('--accent', base.accent),
  };
}

// ───────────── Bins (with text labels) ─────────────
export type Bin = { min: number; max: number; label: string; description?: string };

export const TMAX_BINS: Bin[] = [
  { min: -Infinity, max: 30, label: 'Below 30 °C' },
  { min: 30, max: 35, label: '30–35 °C' },
  { min: 35, max: 40, label: '35–40 °C' },
  { min: 40, max: 43, label: '40–43 °C', description: 'At or above the plains heatwave base threshold (40 °C)' },
  { min: 43, max: 45, label: '43–45 °C' },
  { min: 45, max: 47, label: '45–47 °C', description: 'IMD plains heatwave by absolute Tmax (≥ 45 °C)' },
  { min: 47, max: Infinity, label: '47 °C and above', description: 'IMD plains severe heatwave by absolute Tmax (≥ 47 °C)' },
];

export const DEPARTURE_BINS: Bin[] = [
  { min: -Infinity, max: -2, label: 'Below normal (< −2 °C)' },
  { min: -2, max: 2.5, label: 'Near normal (−2 to +2.5 °C)' },
  { min: 2.5, max: 4.5, label: '+2.5 to +4.5 °C', description: 'Above normal — approaching heatwave departure' },
  { min: 4.5, max: 6.5, label: '+4.5 to +6.5 °C', description: 'IMD heatwave departure range' },
  { min: 6.5, max: Infinity, label: '+6.5 °C and above', description: 'IMD severe-heatwave departure' },
];

export function binIndex(bins: Bin[], value: number) {
  const i = bins.findIndex((b) => value >= b.min && value < b.max);
  return i < 0 ? bins.length - 1 : i;
}

export function tmaxColor(t: number, p: Palette) {
  return p.heat[binIndex(TMAX_BINS, t)];
}

export function departureColor(dep: number, p: Palette) {
  const colors = [p.cool[0], p.neutral, p.heat[2], p.heat[4], p.heat[6]];
  return colors[binIndex(DEPARTURE_BINS, dep)];
}

export function colorFor(metric: MapMetric, f: MapForecast | undefined, p: Palette): string {
  if (!f) return p.noData;
  if (metric === 'severity') return p.sev[f.sev];
  if (metric === 'tmax') return tmaxColor(f.tmax, p);
  return f.dep == null ? p.noData : departureColor(f.dep, p);
}

export type LegendItem = { color: string; label: string; description?: string; pattern?: 'hatch' };

export function legendFor(metric: MapMetric, p: Palette): LegendItem[] {
  const items: LegendItem[] =
    metric === 'severity'
      ? (['extreme', 'high', 'moderate', 'low'] as Severity[]).map((s) => ({ color: p.sev[s], label: SEVERITY_META[s].label, description: SEVERITY_META[s].description }))
      : metric === 'tmax'
        ? TMAX_BINS.map((b, i) => ({ color: p.heat[i], label: b.label, description: b.description })).reverse()
        : DEPARTURE_BINS.map((b) => ({ color: departureColor(b.min === -Infinity ? -5 : b.min, p), label: b.label, description: b.description })).reverse();
  return [...items, { color: p.noData, label: 'No forecast available' }];
}

export const METRIC_META: Record<MapMetric, { label: string; short: string; description: string }> = {
  severity: { label: 'Heat-risk severity', short: 'Severity', description: 'CLIMATIQ 4-level class derived from IMD heatwave criteria (not an official IMD category).' },
  tmax: { label: 'Predicted maximum temperature', short: 'Predicted Tmax', description: 'CLIMATIQ baseline-v1 predicted daily maximum temperature.' },
  departure: { label: 'Departure from reference normal', short: 'Departure', description: 'Predicted Tmax minus the few-year ERA5 reference normal (not an official 30-year normal).' },
};

export function metricValueLabel(metric: MapMetric, f: MapForecast | undefined): string {
  if (!f) return 'No forecast';
  if (metric === 'severity') return SEVERITY_META[f.sev].label;
  if (metric === 'tmax') return fmtTemp(f.tmax);
  return fmtDelta(f.dep);
}

// ───────────── GeoJSON helpers ─────────────
export type BBox = [[number, number], [number, number]];
export const INDIA_BOUNDS: BBox = [
  [68.1, 6.7],
  [97.4, 35.7],
];

function walk(coords: unknown, fn: (p: Position) => void) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') {
    fn(coords as Position);
    return;
  }
  for (const c of coords) walk(c, fn);
}

export function bboxOf(geom: Geometry | null | undefined): BBox | null {
  if (!geom) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (g: Geometry) => {
    if (g.type === 'GeometryCollection') g.geometries.forEach(visit);
    else
      walk(g.coordinates, ([x, y]) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });
  };
  visit(geom);
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

export type RegionFeatureProps = {
  code: string;
  name: string;
  color: string;
  /** lighter variant of `color` for hover / focus in the 3D view */
  colorHi: string;
  /** predicted Tmax (°C) — drives extrusion height in 3D; null without a forecast */
  tmax: number | null;
  hasData: boolean;
  label: string;
  isPilot?: boolean;
};

/** Mixes a #rrggbb colour toward white by k (0..1); other colour formats are returned unchanged. */
export function lighten(hex: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const ch = (s: number) => Math.round(((v >> s) & 255) + (255 - ((v >> s) & 255)) * k);
  return `#${[ch(16), ch(8), ch(0)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * fill-extrusion height (m) for the 3D map: rises with predicted Tmax above 32 °C (so hot regions clearly tower over
 * mild ones) and halves per zoom level, so a 47 °C block stays ~45 px tall from the all-India view down to a
 * district. Regions without a forecast, or below 32 °C, stay as low plinths.
 */
export function extrusionHeight(scale = 1): ExpressionSpecification {
  const units: ExpressionSpecification = ['max', 0.5, ['-', ['coalesce', ['get', 'tmax'], 0], 32]];
  // metres per degree above 32 °C at zoom 3 and zoom 10 (×128 apart = one halving per zoom level)
  return ['interpolate', ['exponential', 2], ['zoom'], 3, ['*', units, 50000 * scale], 10, ['*', units, (50000 / 128) * scale]];
}

/** Attaches forecast-derived colour/label properties to boundary features (by `code`). */
export function decorateRegions(
  fc: FeatureCollection,
  values: Map<string, MapForecast>,
  metric: MapMetric,
  p: Palette,
  pilotCodes?: Set<string>,
): FeatureCollection<Geometry, RegionFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const code = String(f.properties?.code ?? '');
      const v = values.get(code);
      const color = colorFor(metric, v, p);
      return {
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: {
          code,
          name: String(f.properties?.name ?? code),
          color,
          colorHi: lighten(color, 0.32),
          tmax: v ? v.tmax : null,
          hasData: Boolean(v),
          label: metricValueLabel(metric, v),
          ...(pilotCodes ? { isPilot: pilotCodes.has(code) } : {}),
        },
      } as Feature<Geometry, RegionFeatureProps>;
    }),
  };
}

/** Square grid cells (polygons) centred on grid points, coloured with the Tmax scale. */
export function gridCells(points: [number, number, number][], step: number, p: Palette): FeatureCollection<Polygon, { tmax: number; color: string }> {
  const h = step / 2;
  return {
    type: 'FeatureCollection',
    features: points.map(([lat, lon, t]) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [lon - h, lat - h],
            [lon + h, lat - h],
            [lon + h, lat + h],
            [lon - h, lat + h],
            [lon - h, lat - h],
          ],
        ],
      },
      properties: { tmax: t, color: tmaxColor(t, p) },
    })),
  };
}

/** Index forecasts of one day by region code. */
export function valuesForDay(rows: MapForecast[], day: string): Map<string, MapForecast> {
  const m = new Map<string, MapForecast>();
  for (const r of rows) if (r.day === day) m.set(r.code, r);
  return m;
}

/** Peak (max severity, then max Tmax) across the horizon for one region. */
export function peakOf(rows: MapForecast[]): MapForecast | null {
  const rank = (s: Severity) => SEVERITY_META[s].rank;
  return rows.reduce<MapForecast | null>((m, r) => (!m || rank(r.sev) > rank(m.sev) || (rank(r.sev) === rank(m.sev) && r.tmax > m.tmax) ? r : m), null);
}

/** Severity counts for one day. */
export function severityCounts(rows: Pick<MapForecast, 'day' | 'sev'>[], day: string): Record<Severity, number> {
  const out: Record<Severity, number> = { low: 0, moderate: 0, high: 0, extreme: 0 };
  for (const r of rows) if (r.day === day) out[r.sev] += 1;
  return out;
}
