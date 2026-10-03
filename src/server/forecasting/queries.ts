/**
 * Read-side forecast queries shared by the command center, forecast pages, portal, advisories and landing.
 * All functions are driver-agnostic (take a DB) and return plain serialisable objects.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { dataSources, forecastRuns, forecasts, gridDaily, modelVersions, regions } from '../db/schema';
import type { Scenario } from '../scenario';
import type { Severity } from '@/lib/domain';

export type RunInfo = {
  id: string;
  scenario: Scenario;
  issuedFor: string;
  horizonDays: number;
  isHindcast: boolean;
  createdAt: string;
  modelKey: string;
  modelName: string;
  inputs: Record<string, unknown>;
  regionsCount: number;
};

/** Latest successful run for a scenario. */
export async function latestRun(db: DB, scenario: Scenario): Promise<RunInfo | null> {
  const [r] = await db
    .select({
      id: forecastRuns.id,
      scenario: forecastRuns.scenario,
      issuedFor: forecastRuns.issuedFor,
      horizonDays: forecastRuns.horizonDays,
      isHindcast: forecastRuns.isHindcast,
      createdAt: forecastRuns.createdAt,
      modelKey: modelVersions.key,
      modelName: modelVersions.name,
      inputs: forecastRuns.inputs,
      regionsCount: forecastRuns.regionsCount,
    })
    .from(forecastRuns)
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .where(and(eq(forecastRuns.scenario, scenario), inArray(forecastRuns.status, ['succeeded', 'partial'])))
    .orderBy(desc(forecastRuns.issuedFor), desc(forecastRuns.createdAt))
    .limit(1);
  return r ? { ...r, createdAt: r.createdAt.toISOString() } : null;
}

export type RegionForecastRow = {
  forecastId: number;
  regionId: number;
  code: string;
  name: string;
  level: 'country' | 'state' | 'district' | 'city';
  parentId: number | null;
  path: string;
  lat: number;
  lon: number;
  climateZone: 'plains' | 'coastal' | 'hilly';
  isPilot: boolean;
  targetDate: string;
  horizonDay: number;
  resolution: string;
  predictedTmaxC: number;
  lowerC: number;
  upperC: number;
  predictedTminC: number | null;
  nwpTmaxC: number | null;
  normalTmaxC: number | null;
  departureC: number | null;
  severity: Severity;
  imdCategory: string;
  confidence: 'low' | 'medium' | 'high';
  confidenceScore: number;
  durationDays: number;
  factors: { key: string; label: string; value: string; impact: string; detail: string }[];
  inputKinds: string[];
};

const forecastCols = {
  forecastId: forecasts.id,
  regionId: regions.id,
  code: regions.code,
  name: regions.name,
  level: regions.level,
  parentId: regions.parentId,
  path: regions.path,
  lat: regions.lat,
  lon: regions.lon,
  climateZone: regions.climateZone,
  isPilot: regions.isPilot,
  targetDate: forecasts.targetDate,
  horizonDay: forecasts.horizonDay,
  resolution: forecasts.resolution,
  predictedTmaxC: forecasts.predictedTmaxC,
  lowerC: forecasts.lowerC,
  upperC: forecasts.upperC,
  predictedTminC: forecasts.predictedTminC,
  nwpTmaxC: forecasts.nwpTmaxC,
  normalTmaxC: forecasts.normalTmaxC,
  departureC: forecasts.departureC,
  severity: forecasts.severity,
  imdCategory: forecasts.imdCategory,
  confidence: forecasts.confidence,
  confidenceScore: forecasts.confidenceScore,
  durationDays: forecasts.durationDays,
  factors: forecasts.factors,
  inputKinds: forecasts.inputKinds,
};

/** All forecasts of a run for one target day (optionally filtered by level / parent region). */
export async function forecastsForDay(
  db: DB,
  runId: string,
  targetDate: string,
  opts: { level?: 'state' | 'district'; parentId?: number } = {},
): Promise<RegionForecastRow[]> {
  const conds = [eq(forecasts.runId, runId), eq(forecasts.targetDate, targetDate)];
  if (opts.level) conds.push(eq(regions.level, opts.level));
  if (opts.parentId != null) conds.push(eq(regions.parentId, opts.parentId));
  return db
    .select(forecastCols)
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(and(...conds))
    .orderBy(desc(forecasts.predictedTmaxC)) as Promise<RegionForecastRow[]>;
}

/** Full horizon for a single region (used by detail pages). Cities resolve to their parent district's forecast. */
export async function forecastSeries(db: DB, runId: string, regionId: number): Promise<RegionForecastRow[]> {
  return db
    .select(forecastCols)
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(and(eq(forecasts.runId, runId), eq(forecasts.regionId, regionId)))
    .orderBy(asc(forecasts.targetDate)) as Promise<RegionForecastRow[]>;
}

/** Severity counts for a run/day (states or districts). */
export async function severityDistribution(db: DB, runId: string, targetDate: string, level: 'state' | 'district') {
  const rows = await db
    .select({ severity: forecasts.severity, n: sql<number>`count(*)::int` })
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(and(eq(forecasts.runId, runId), eq(forecasts.targetDate, targetDate), eq(regions.level, level)))
    .groupBy(forecasts.severity);
  const out: Record<Severity, number> = { low: 0, moderate: 0, high: 0, extreme: 0 };
  for (const r of rows) out[r.severity] = Number(r.n);
  return out;
}

/** Peak severity per region across the horizon (for "regions affected in the next N days"). */
export async function peakSeverityByRegion(db: DB, runId: string, maxHorizon = 5) {
  return db
    .select({
      regionId: forecasts.regionId,
      maxTmax: sql<number>`max(${forecasts.predictedTmaxC})`,
      peakRank: sql<number>`max(case ${forecasts.severity} when 'extreme' then 3 when 'high' then 2 when 'moderate' then 1 else 0 end)::int`,
    })
    .from(forecasts)
    .where(and(eq(forecasts.runId, runId), sql`${forecasts.horizonDay} <= ${maxHorizon}`))
    .groupBy(forecasts.regionId);
}

/** Heat-map grid values for a day, with the kind of data (reanalysis / NWP / simulated) and its source. */
export async function gridForDay(db: DB, day: string) {
  return db
    .select({ lat: gridDaily.lat, lon: gridDaily.lon, tmaxC: gridDaily.tmaxC, dataKind: gridDaily.dataKind, source: dataSources.name })
    .from(gridDaily)
    .innerJoin(dataSources, eq(dataSources.id, gridDaily.sourceId))
    .where(eq(gridDaily.day, day));
}

export const SEVERITY_FROM_RANK: Severity[] = ['low', 'moderate', 'high', 'extreme'];
