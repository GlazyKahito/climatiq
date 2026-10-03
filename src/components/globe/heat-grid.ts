/**
 * Replay heat grid (ERA5 daily Tmax over India) — shared, dependency-free parsing for the browser globe and the
 * server-rendered previews. The file is produced from real ERA5 reanalysis via Open-Meteo; if it is missing or
 * malformed we render NOTHING rather than inventing values.
 */

export const HEAT_GRID_URL = '/data/heat-grid-replay.json';

export type HeatPoint = { lat: number; lon: number; tmaxC: number };

export type HeatGridMeta = {
  day: string;
  source: string | null;
  model: string | null;
  license: string | null;
  dataKind: string;
  note: string | null;
  /** grid spacing in degrees, when the file states it */
  resolutionDeg: number | null;
};

export type HeatGrid = { meta: HeatGridMeta; points: HeatPoint[] };

export type HeatGridStats = {
  count: number;
  maxC: number;
  minC: number;
  meanC: number;
  hottest: HeatPoint;
  atOrAbove45: number;
  atOrAbove40: number;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** Validates the JSON shape; drops implausible rows. Returns null when nothing usable remains. */
export function parseHeatGrid(json: unknown): HeatGrid | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { meta?: Record<string, unknown>; points?: unknown };
  if (!Array.isArray(j.points)) return null;
  const points: HeatPoint[] = [];
  for (const p of j.points) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const lat = num(r.lat);
    const lon = num(r.lon);
    const tmaxC = num(r.tmaxC ?? r.tmax_c ?? r.tmax);
    if (lat == null || lon == null || tmaxC == null) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (tmaxC < -60 || tmaxC > 65) continue; // physically implausible → discard
    points.push({ lat, lon, tmaxC });
  }
  if (points.length === 0) return null;
  const m = j.meta ?? {};
  const day = str(m.day);
  return {
    meta: {
      day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '',
      source: str(m.source),
      model: str(m.model),
      license: str(m.license),
      dataKind: str(m.dataKind) ?? 'reanalysis',
      note: str(m.note),
      resolutionDeg: num(m.resolutionDeg),
    },
    points,
  };
}

export function heatGridStats(points: HeatPoint[]): HeatGridStats | null {
  if (points.length === 0) return null;
  let max = -Infinity;
  let min = Infinity;
  let sum = 0;
  let hottest = points[0];
  let a45 = 0;
  let a40 = 0;
  for (const p of points) {
    if (p.tmaxC > max) {
      max = p.tmaxC;
      hottest = p;
    }
    if (p.tmaxC < min) min = p.tmaxC;
    sum += p.tmaxC;
    if (p.tmaxC >= 45) a45++;
    if (p.tmaxC >= 40) a40++;
  }
  return { count: points.length, maxC: max, minC: min, meanC: sum / points.length, hottest, atOrAbove45: a45, atOrAbove40: a40 };
}

/** "26 May 2024" from "2024-05-26" (UTC-safe, no locale surprises). */
export function formatGridDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** Caption shown next to the heat glyphs, e.g. "ERA5 reanalysis · 26 May 2024 · via Open-Meteo (CC BY 4.0)". */
export function heatGridCaption(meta: HeatGridMeta): string {
  const kind = meta.dataKind === 'reanalysis' ? 'ERA5 reanalysis' : meta.dataKind;
  const day = meta.day ? formatGridDay(meta.day) : 'date unknown';
  return `${kind} · ${day} · via Open-Meteo (CC BY 4.0)`;
}
