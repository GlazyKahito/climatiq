/**
 * Read-side queries over `daily_climate` and `climate_normals` for analytics, forecast detail pages and CSV export.
 * All functions take a DB handle (node-postgres in the app, PGlite in tests) and return plain objects.
 */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { climateNormals, dailyClimate, dataSources, regions } from '../db/schema';
import type { DataKind } from '@/lib/domain';

/** When several kinds exist for the same region-day, prefer real data: observed → reanalysis → simulated. */
const KIND_PRIORITY = sql`case ${dailyClimate.dataKind} when 'observed' then 0 when 'reanalysis' then 1 else 2 end`;

/**
 * Kinds that describe what actually happened. `daily_climate` also stores NWP guidance (`nwp_forecast`) used as model
 * input — that is a forecast, never history, so every history/analytics query excludes it.
 */
export const HISTORY_KINDS = ['observed', 'reanalysis', 'simulated'] as const;
const isHistory = inArray(dailyClimate.dataKind, [...HISTORY_KINDS]);

export type ClimateDay = {
  regionId: number;
  day: string;
  tmaxC: number | null;
  tminC: number | null;
  apparentTmaxC: number | null;
  rhMeanPct: number | null;
  windMaxKmh: number | null;
  radiationMj: number | null;
  dataKind: DataKind;
  sourceKey: string;
  sourceName: string;
  updatedAt: string;
};

type RawClimate = Omit<ClimateDay, 'updatedAt'> & { updatedAt: Date | string };

/** One row per region-day (best available kind), ordered by region then day. */
export async function climateSeries(db: DB, regionIds: number[], from: string, to: string): Promise<ClimateDay[]> {
  if (!regionIds.length) return [];
  const rows = (await db
    .selectDistinctOn([dailyClimate.regionId, dailyClimate.day], {
      regionId: dailyClimate.regionId,
      day: dailyClimate.day,
      tmaxC: dailyClimate.tmaxC,
      tminC: dailyClimate.tminC,
      apparentTmaxC: dailyClimate.apparentTmaxC,
      rhMeanPct: dailyClimate.rhMeanPct,
      windMaxKmh: dailyClimate.windMaxKmh,
      radiationMj: dailyClimate.radiationMj,
      dataKind: dailyClimate.dataKind,
      sourceKey: dataSources.key,
      sourceName: dataSources.name,
      updatedAt: dailyClimate.updatedAt,
    })
    .from(dailyClimate)
    .innerJoin(dataSources, eq(dataSources.id, dailyClimate.sourceId))
    .where(and(isHistory, inArray(dailyClimate.regionId, regionIds), gte(dailyClimate.day, from), lte(dailyClimate.day, to)))
    .orderBy(dailyClimate.regionId, dailyClimate.day, KIND_PRIORITY)) as RawClimate[];
  return rows.map((r) => ({ ...r, updatedAt: new Date(r.updatedAt).toISOString() }));
}

/** Compact Tmax-only series (used for heavy aggregations such as heatwave-day counting). */
export async function tmaxSeries(db: DB, regionIds: number[], from?: string, to?: string) {
  if (!regionIds.length) return [] as { regionId: number; day: string; tmaxC: number | null; dataKind: DataKind }[];
  const conds = [isHistory, inArray(dailyClimate.regionId, regionIds)];
  if (from) conds.push(gte(dailyClimate.day, from));
  if (to) conds.push(lte(dailyClimate.day, to));
  return db
    .selectDistinctOn([dailyClimate.regionId, dailyClimate.day], {
      regionId: dailyClimate.regionId,
      day: dailyClimate.day,
      tmaxC: dailyClimate.tmaxC,
      dataKind: dailyClimate.dataKind,
    })
    .from(dailyClimate)
    .where(and(...conds))
    .orderBy(dailyClimate.regionId, dailyClimate.day, KIND_PRIORITY) as Promise<{ regionId: number; day: string; tmaxC: number | null; dataKind: DataKind }[]>;
}

export type Coverage = {
  regionId: number;
  firstDay: string | null;
  lastDay: string | null;
  days: number;
  kinds: DataKind[];
  sources: string[];
  lastUpdated: string | null;
};

/** What daily climate data exists per region (span, number of days, kinds and sources). */
export async function climateCoverage(db: DB, regionIds: number[]): Promise<Coverage[]> {
  if (!regionIds.length) return [];
  const rows = await db
    .select({
      regionId: dailyClimate.regionId,
      firstDay: sql<string | null>`min(${dailyClimate.day})::text`,
      lastDay: sql<string | null>`max(${dailyClimate.day})::text`,
      days: sql<number>`count(distinct ${dailyClimate.day})::int`,
      kinds: sql<DataKind[]>`array_agg(distinct ${dailyClimate.dataKind}::text)`,
      sources: sql<string[]>`array_agg(distinct ${dataSources.name})`,
      lastUpdated: sql<string | null>`max(${dailyClimate.updatedAt})::text`,
    })
    .from(dailyClimate)
    .innerJoin(dataSources, eq(dataSources.id, dailyClimate.sourceId))
    .where(and(isHistory, inArray(dailyClimate.regionId, regionIds)))
    .groupBy(dailyClimate.regionId);
  return regionIds.map((id) => {
    const r = rows.find((x) => x.regionId === id);
    return r
      ? {
          regionId: id,
          firstDay: r.firstDay,
          lastDay: r.lastDay,
          days: Number(r.days),
          kinds: (r.kinds ?? []).filter(Boolean),
          sources: (r.sources ?? []).filter(Boolean),
          lastUpdated: r.lastUpdated ? new Date(r.lastUpdated).toISOString() : null,
        }
      : { regionId: id, firstDay: null, lastDay: null, days: 0, kinds: [], sources: [], lastUpdated: null };
  });
}

/** Overall span of daily climate data by region level (for default date ranges and coverage notes). */
export async function climateSpanByLevel(db: DB) {
  const rows = await db
    .select({
      level: regions.level,
      firstDay: sql<string | null>`min(${dailyClimate.day})::text`,
      lastDay: sql<string | null>`max(${dailyClimate.day})::text`,
      rows: sql<number>`count(*)::int`,
    })
    .from(dailyClimate)
    .innerJoin(regions, eq(regions.id, dailyClimate.regionId))
    .where(isHistory)
    .groupBy(regions.level);
  return rows.map((r) => ({ ...r, rows: Number(r.rows) }));
}

export type NormalBasis = { regionId: number; basisKey: string; basis: string; sampleYears: number; days: number; dataKind: DataKind };

/** Reference-climatology bases available per region. */
export async function normalBases(db: DB, regionIds: number[]): Promise<NormalBasis[]> {
  if (!regionIds.length) return [];
  const rows = await db
    .select({
      regionId: climateNormals.regionId,
      basisKey: climateNormals.basisKey,
      basis: sql<string>`min(${climateNormals.basis})`,
      sampleYears: sql<number>`max(${climateNormals.sampleYears})::int`,
      days: sql<number>`count(*)::int`,
      dataKind: sql<DataKind>`min(${climateNormals.dataKind}::text)`,
    })
    .from(climateNormals)
    .where(inArray(climateNormals.regionId, regionIds))
    .groupBy(climateNormals.regionId, climateNormals.basisKey);
  return rows.map((r) => ({ ...r, sampleYears: Number(r.sampleYears), days: Number(r.days) }));
}

/**
 * Picks the reference basis used for analytics: the one covering the most days of the year (so all-year state
 * series are classified consistently), then the most sample years, then the key name for determinism.
 */
export function pickBasis<T extends { basisKey: string; sampleYears: number; days: number }>(bases: T[]): T | null {
  if (!bases.length) return null;
  return [...bases].sort((a, b) => b.days - a.days || b.sampleYears - a.sampleYears || a.basisKey.localeCompare(b.basisKey))[0];
}

/** Normal Tmax by day-of-year for one region/basis. */
export async function loadNormals(db: DB, regionId: number, basisKey: string): Promise<Map<number, number>> {
  const rows = await db
    .select({ doy: climateNormals.dayOfYear, tmax: climateNormals.normalTmaxC })
    .from(climateNormals)
    .where(and(eq(climateNormals.regionId, regionId), eq(climateNormals.basisKey, basisKey)))
    .orderBy(asc(climateNormals.dayOfYear));
  return new Map(rows.map((r) => [r.doy, r.tmax]));
}

/** Normals for many regions at once: Map<regionId, Map<doy, tmax>> using the chosen basis per region. */
export async function loadNormalsFor(db: DB, choice: { regionId: number; basisKey: string }[]) {
  const out = new Map<number, Map<number, number>>();
  if (!choice.length) return out;
  const rows = await db
    .select({ regionId: climateNormals.regionId, basisKey: climateNormals.basisKey, doy: climateNormals.dayOfYear, tmax: climateNormals.normalTmaxC })
    .from(climateNormals)
    .where(and(inArray(climateNormals.regionId, choice.map((c) => c.regionId)), inArray(climateNormals.basisKey, [...new Set(choice.map((c) => c.basisKey))])));
  const wanted = new Map(choice.map((c) => [c.regionId, c.basisKey]));
  for (const r of rows) {
    if (wanted.get(r.regionId) !== r.basisKey) continue;
    const m = out.get(r.regionId) ?? new Map<number, number>();
    m.set(r.doy, r.tmax);
    out.set(r.regionId, m);
  }
  return out;
}

/**
 * Daily Tmax for the same calendar window (by month-day) in every year that has data.
 * `from`/`to` are dates in the reference year; windows crossing New Year are supported.
 */
export async function sameWindowByYear(db: DB, regionId: number, from: string, to: string) {
  const a = from.slice(5);
  const b = to.slice(5);
  const md = sql`to_char(${dailyClimate.day}::date, 'MM-DD')`;
  const windowCond = a <= b ? sql`${md} between ${a} and ${b}` : sql`(${md} >= ${a} or ${md} <= ${b})`;
  const rows = (await db
    .selectDistinctOn([dailyClimate.day], { day: dailyClimate.day, tmaxC: dailyClimate.tmaxC, dataKind: dailyClimate.dataKind })
    .from(dailyClimate)
    .where(and(isHistory, eq(dailyClimate.regionId, regionId), windowCond))
    .orderBy(dailyClimate.day, KIND_PRIORITY)) as { day: string; tmaxC: number | null; dataKind: DataKind }[];
  return rows;
}
