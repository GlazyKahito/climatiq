/**
 * Map data for the command center: forecasts shaped for the choropleth, heat grid, region detail.
 * Query functions take a DB; shaping helpers are pure (unit-tested in tests/unit/map-shaping.test.ts).
 */
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { dataSources, forecastRuns, forecasts, gridDaily, modelVersions, regions } from '../db/schema';
import type { RunInfo } from '../forecasting/queries';
import type { Scenario } from '../scenario';
import type { CityItem, GridPayload, MapForecast, RegionDetailPayload, RunSummary } from '@/components/map/types';
import type { DataKind, Severity } from '@/lib/domain';
import { severityCounts } from '@/components/map/scales';

export { severityCounts };

// ───────────── Pure shaping helpers ─────────────
export function parentCodeFromPath(path: string): string | null {
  const parts = path.split('/');
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

type ForecastLike = {
  code: string;
  name: string;
  level: string;
  path: string;
  targetDate: string;
  horizonDay: number;
  predictedTmaxC: number;
  lowerC: number;
  upperC: number;
  normalTmaxC: number | null;
  departureC: number | null;
  severity: Severity;
  confidence: 'low' | 'medium' | 'high';
  confidenceScore: number;
  durationDays: number;
  resolution: string;
  imdCategory: string;
};

const r1 = (v: number) => Math.round(v * 10) / 10;

export function toMapForecast(r: ForecastLike): MapForecast {
  return {
    code: r.code,
    name: r.name,
    level: r.level === 'district' ? 'district' : 'state',
    parentCode: parentCodeFromPath(r.path),
    day: r.targetDate,
    h: r.horizonDay,
    tmax: r1(r.predictedTmaxC),
    lo: r1(r.lowerC),
    hi: r1(r.upperC),
    normal: r.normalTmaxC == null ? null : r1(r.normalTmaxC),
    dep: r.departureC == null ? null : r1(r.departureC),
    sev: r.severity,
    conf: r.confidence,
    cs: Math.round(r.confidenceScore * 100) / 100,
    dur: r.durationDays,
    res: r.resolution,
    imd: r.imdCategory,
  };
}

export function runSummary(run: RunInfo): RunSummary {
  const inputs = run.inputs ?? {};
  return {
    id: run.id,
    scenario: run.scenario,
    issuedFor: run.issuedFor,
    horizonDays: run.horizonDays,
    isHindcast: run.isHindcast,
    createdAt: run.createdAt,
    modelKey: run.modelKey,
    modelName: run.modelName,
    nwpInput: typeof inputs.nwp === 'string' ? inputs.nwp : null,
    normalsInput: typeof inputs.normals === 'string' ? inputs.normals : null,
  };
}

const SEV_RANK: Record<Severity, number> = { low: 0, moderate: 1, high: 2, extreme: 3 };

/** Per-region peak over the first `maxHorizon` days. */
export function peakByRegion(rows: MapForecast[], maxHorizon = 5) {
  const out = new Map<string, { sev: Severity; tmax: number; day: string }>();
  for (const r of rows) {
    if (r.h > maxHorizon) continue;
    const cur = out.get(r.code);
    if (!cur || SEV_RANK[r.sev] > SEV_RANK[cur.sev] || (SEV_RANK[r.sev] === SEV_RANK[cur.sev] && r.tmax > cur.tmax)) {
      out.set(r.code, { sev: r.sev, tmax: r.tmax, day: r.day });
    }
  }
  return out;
}

export type ForecastChange = {
  compared: number;
  upgraded: number;
  downgraded: number;
  meanAbsTmaxChange: number;
  largest: { code: string; name: string; day: string; from: number; to: number; fromSev: Severity; toSev: Severity } | null;
};

/** Compares two runs on overlapping (region, target day) pairs. */
export function compareRuns(prev: MapForecast[], cur: MapForecast[]): ForecastChange {
  const prevBy = new Map(prev.map((p) => [`${p.code}|${p.day}`, p]));
  let compared = 0;
  let upgraded = 0;
  let downgraded = 0;
  let sumAbs = 0;
  let largest: ForecastChange['largest'] = null;
  for (const c of cur) {
    const p = prevBy.get(`${c.code}|${c.day}`);
    if (!p) continue;
    compared += 1;
    const d = SEV_RANK[c.sev] - SEV_RANK[p.sev];
    if (d > 0) upgraded += 1;
    if (d < 0) downgraded += 1;
    const delta = c.tmax - p.tmax;
    sumAbs += Math.abs(delta);
    if (!largest || Math.abs(delta) > Math.abs(largest.to - largest.from)) {
      largest = { code: c.code, name: c.name, day: c.day, from: p.tmax, to: c.tmax, fromSev: p.sev, toSev: c.sev };
    }
  }
  return { compared, upgraded, downgraded, meanAbsTmaxChange: compared ? r1(sumAbs / compared) : 0, largest };
}

/** Infers the grid spacing (degrees) from point coordinates. */
export function inferGridStep(points: { lat: number; lon: number }[]): number {
  const lons = [...new Set(points.map((p) => p.lon))].sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < lons.length; i++) step = Math.min(step, lons[i] - lons[i - 1]);
  return Number.isFinite(step) && step > 0 ? Math.round(step * 1000) / 1000 : 1;
}

// ───────────── Queries ─────────────
const fcCols = {
  code: regions.code,
  name: regions.name,
  level: regions.level,
  path: regions.path,
  targetDate: forecasts.targetDate,
  horizonDay: forecasts.horizonDay,
  predictedTmaxC: forecasts.predictedTmaxC,
  lowerC: forecasts.lowerC,
  upperC: forecasts.upperC,
  normalTmaxC: forecasts.normalTmaxC,
  departureC: forecasts.departureC,
  severity: forecasts.severity,
  confidence: forecasts.confidence,
  confidenceScore: forecasts.confidenceScore,
  durationDays: forecasts.durationDays,
  resolution: forecasts.resolution,
  imdCategory: forecasts.imdCategory,
};

/** All forecasts of a run at one level (all target days), optionally limited to one parent region. */
export async function runForecasts(db: DB, runId: string, level: 'state' | 'district', parentCode?: string): Promise<MapForecast[]> {
  const conds = [eq(forecasts.runId, runId), eq(regions.level, level)];
  if (parentCode) {
    const [p] = await db.select({ id: regions.id }).from(regions).where(eq(regions.code, parentCode)).limit(1);
    if (!p) return [];
    conds.push(eq(regions.parentId, p.id));
  }
  const rows = await db
    .select(fcCols)
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(and(...conds))
    .orderBy(asc(forecasts.targetDate), asc(regions.code));
  return rows.map(toMapForecast);
}

/** Distinct target days of a run (ascending). */
export async function runDays(db: DB, runId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ day: forecasts.targetDate })
    .from(forecasts)
    .where(eq(forecasts.runId, runId))
    .orderBy(asc(forecasts.targetDate));
  return rows.map((r) => r.day);
}

/** The successful run issued before `run` for the same scenario (for "recent forecast changes"). */
export async function previousRun(db: DB, scenario: Scenario, run: { id: string; issuedFor: string; createdAt: string }) {
  const [r] = await db
    .select({ id: forecastRuns.id, issuedFor: forecastRuns.issuedFor, createdAt: forecastRuns.createdAt, modelKey: modelVersions.key })
    .from(forecastRuns)
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .where(
      and(
        eq(forecastRuns.scenario, scenario),
        inArray(forecastRuns.status, ['succeeded', 'partial']),
        ne(forecastRuns.id, run.id),
        sql`(${forecastRuns.issuedFor} < ${run.issuedFor} or (${forecastRuns.issuedFor} = ${run.issuedFor} and ${forecastRuns.createdAt} < ${new Date(run.createdAt)}))`,
      ),
    )
    .orderBy(desc(forecastRuns.issuedFor), desc(forecastRuns.createdAt))
    .limit(1);
  return r ? { ...r, createdAt: r.createdAt.toISOString() } : null;
}

/** Heat grid for one day with provenance (the most trustworthy kind wins if several exist). */
export async function gridPayload(db: DB, day: string): Promise<GridPayload> {
  const rows = await db
    .select({ lat: gridDaily.lat, lon: gridDaily.lon, tmaxC: gridDaily.tmaxC, kind: gridDaily.dataKind, source: dataSources.name })
    .from(gridDaily)
    .innerJoin(dataSources, eq(dataSources.id, gridDaily.sourceId))
    .where(eq(gridDaily.day, day));
  if (!rows.length) return { day, kind: null, sources: [], step: 1, points: [] };
  const order: DataKind[] = ['observed', 'reanalysis', 'nwp_forecast', 'simulated', 'model_forecast'];
  const kind = order.find((k) => rows.some((r) => r.kind === k)) ?? rows[0].kind;
  const chosen = rows.filter((r) => r.kind === kind);
  return {
    day,
    kind,
    sources: [...new Set(chosen.map((r) => r.source))],
    step: inferGridStep(chosen),
    points: chosen.map((r) => [r.lat, r.lon, r1(r.tmaxC)]),
  };
}

/** Region detail for the side panel: forecast series (cities use their district) and the list of cities. */
export async function regionDetail(db: DB, runId: string | null, code: string): Promise<RegionDetailPayload | null> {
  const [r] = await db
    .select({
      id: regions.id,
      code: regions.code,
      name: regions.name,
      level: regions.level,
      isPilot: regions.isPilot,
      climateZone: regions.climateZone,
      parentId: regions.parentId,
      path: regions.path,
    })
    .from(regions)
    .where(eq(regions.code, code))
    .limit(1);
  if (!r) return null;
  const [p] = r.parentId
    ? await db.select({ id: regions.id, code: regions.code, name: regions.name }).from(regions).where(eq(regions.id, r.parentId)).limit(1)
    : [];

  // Cities never have their own forecast: they use the parent district's.
  const seriesRegionId = r.level === 'city' ? (p?.id ?? null) : r.id;
  const seriesRegionCode = r.level === 'city' ? (p?.code ?? null) : r.code;
  const series =
    runId && seriesRegionId
      ? (
          await db
            .select(fcCols)
            .from(forecasts)
            .innerJoin(regions, eq(regions.id, forecasts.regionId))
            .where(and(eq(forecasts.runId, runId), eq(forecasts.regionId, seriesRegionId)))
            .orderBy(asc(forecasts.targetDate))
        ).map(toMapForecast)
      : [];

  let cities: CityItem[] = [];
  if (r.level === 'district' || r.level === 'city') {
    const districtId = r.level === 'district' ? r.id : r.parentId;
    if (districtId) {
      cities = await db
        .select({ code: regions.code, name: regions.name, population: regions.population })
        .from(regions)
        .where(and(eq(regions.parentId, districtId), eq(regions.level, 'city')))
        .orderBy(desc(regions.population))
        .limit(25);
    }
  }
  return {
    region: {
      code: r.code,
      name: r.name,
      level: r.level,
      isPilot: r.isPilot,
      climateZone: r.climateZone,
      parentCode: p?.code ?? null,
      parentName: p?.name ?? null,
    },
    series,
    seriesRegionCode,
    cities,
  };
}

/** Resolves a `?region=CODE` deep link into the map focus (state → district → city). Unknown codes → India. */
export async function resolveFocus(db: DB, code: string | null): Promise<{ state: string | null; district: string | null; city: string | null }> {
  const none = { state: null, district: null, city: null };
  if (!code || !/^[A-Z0-9-]{2,80}$/.test(code)) return none;
  const [r] = await db.select({ level: regions.level, path: regions.path }).from(regions).where(eq(regions.code, code)).limit(1);
  if (!r) return none;
  const parts = r.path.split('/'); // IN / IN-RJ / IN-RJ-JAIPUR / city
  if (r.level === 'state') return { state: parts[1] ?? null, district: null, city: null };
  if (r.level === 'district') return { state: parts[1] ?? null, district: parts[2] ?? null, city: null };
  if (r.level === 'city') return { state: parts[1] ?? null, district: parts[2] ?? null, city: code };
  return none;
}
