/**
 * Read models for the /forecasts pages, JSON API and CSV export. Builds on the lead-owned helpers in
 * `@/server/forecasting/queries` and adds run metadata, per-day distributions, history context and warnings.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { dataSources, forecastRuns, forecasts, modelVersions, officialWarnings, regions } from '../db/schema';
import { forecastSeries, latestRun, type RegionForecastRow } from '../forecasting/queries';
import { climateSeries, sameWindowByYear } from './history';
import type { Scenario } from '../scenario';
import { addDays, SEVERITIES, type DataKind, type Severity } from '@/lib/domain';

export type RunDetail = {
  id: string;
  scenario: Scenario;
  issuedFor: string;
  horizonDays: number;
  isHindcast: boolean;
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  modelKey: string;
  modelName: string;
  modelMethod: string;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  regionsCount: number;
};

const runCols = {
  id: forecastRuns.id,
  scenario: forecastRuns.scenario,
  issuedFor: forecastRuns.issuedFor,
  horizonDays: forecastRuns.horizonDays,
  isHindcast: forecastRuns.isHindcast,
  status: forecastRuns.status,
  error: forecastRuns.error,
  createdAt: forecastRuns.createdAt,
  finishedAt: forecastRuns.finishedAt,
  triggeredBy: forecastRuns.triggeredBy,
  modelKey: modelVersions.key,
  modelName: modelVersions.name,
  modelMethod: modelVersions.method,
  inputs: forecastRuns.inputs,
  params: forecastRuns.params,
  regionsCount: forecastRuns.regionsCount,
};

type RawRun = Omit<RunDetail, 'createdAt' | 'finishedAt'> & { createdAt: Date; finishedAt: Date | null };
const toRunDetail = (r: RawRun): RunDetail => ({ ...r, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null });

export async function getRunDetail(db: DB, runId: string): Promise<RunDetail | null> {
  const [r] = await db
    .select(runCols)
    .from(forecastRuns)
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .where(eq(forecastRuns.id, runId))
    .limit(1);
  return r ? toRunDetail(r as RawRun) : null;
}

/** Latest successful/partial run for a scenario, with full metadata. */
export async function latestRunDetail(db: DB, scenario: Scenario): Promise<RunDetail | null> {
  const r = await latestRun(db, scenario);
  return r ? getRunDetail(db, r.id) : null;
}

/** Most recent run attempt for a scenario regardless of status (to explain failures in empty states). */
export async function lastRunAttempt(db: DB, scenario: Scenario): Promise<RunDetail | null> {
  const [r] = await db
    .select(runCols)
    .from(forecastRuns)
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .where(eq(forecastRuns.scenario, scenario))
    .orderBy(desc(forecastRuns.createdAt))
    .limit(1);
  return r ? toRunDetail(r as RawRun) : null;
}

/** Distinct input kinds used by a run's forecasts (e.g. reanalysis, climatology, nwp_forecast). */
export async function runInputKinds(db: DB, runId: string): Promise<string[]> {
  const res = await db.execute(
    sql`select distinct jsonb_array_elements_text(${forecasts.inputKinds}) as k from ${forecasts} where ${forecasts.runId} = ${runId}`,
  );
  // node-postgres and PGlite both expose `.rows`.
  return ((res as unknown as { rows: { k: string }[] }).rows ?? []).map((r) => r.k).sort();
}

/** Target days present in a run, ascending. */
export async function runDays(db: DB, runId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ day: forecasts.targetDate })
    .from(forecasts)
    .where(eq(forecasts.runId, runId))
    .orderBy(asc(forecasts.targetDate));
  return rows.map((r) => r.day);
}

export type DaySeverity = { day: string; horizonDay: number } & Record<Severity, number>;

/** Severity counts per target day for one level (one grouped query). */
export async function severityByDay(db: DB, runId: string, level: 'state' | 'district'): Promise<DaySeverity[]> {
  const rows = await db
    .select({ day: forecasts.targetDate, horizonDay: forecasts.horizonDay, severity: forecasts.severity, n: sql<number>`count(*)::int` })
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(and(eq(forecasts.runId, runId), eq(regions.level, level)))
    .groupBy(forecasts.targetDate, forecasts.horizonDay, forecasts.severity)
    .orderBy(asc(forecasts.targetDate));
  const out = new Map<string, DaySeverity>();
  for (const r of rows) {
    const d = out.get(r.day) ?? { day: r.day, horizonDay: r.horizonDay, low: 0, moderate: 0, high: 0, extreme: 0 };
    d[r.severity] += Number(r.n);
    out.set(r.day, d);
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Rows for the regions table / JSON API: one target day, states + districts, with parent (state) name. */
export type ForecastTableRow = Pick<
  RegionForecastRow,
  | 'regionId'
  | 'code'
  | 'name'
  | 'level'
  | 'targetDate'
  | 'horizonDay'
  | 'resolution'
  | 'predictedTmaxC'
  | 'lowerC'
  | 'upperC'
  | 'nwpTmaxC'
  | 'normalTmaxC'
  | 'departureC'
  | 'severity'
  | 'imdCategory'
  | 'confidence'
  | 'confidenceScore'
  | 'durationDays'
  | 'climateZone'
> & { stateCode: string; stateName: string; peakSeverity: Severity };

export async function forecastTable(db: DB, runId: string, day: string, opts: { level?: 'state' | 'district' } = {}): Promise<ForecastTableRow[]> {
  const parent = sql<string | null>`(select p.code from regions p where p.id = ${regions.parentId})`;
  const parentName = sql<string | null>`(select p.name from regions p where p.id = ${regions.parentId})`;
  const peak = sql<number>`(select max(case f2.severity when 'extreme' then 3 when 'high' then 2 when 'moderate' then 1 else 0 end) from forecasts f2 where f2.run_id = ${forecasts.runId} and f2.region_id = ${forecasts.regionId})::int`;
  const conds = [eq(forecasts.runId, runId), eq(forecasts.targetDate, day)];
  if (opts.level) conds.push(eq(regions.level, opts.level));
  else conds.push(inArray(regions.level, ['state', 'district']));
  const rows = await db
    .select({
      regionId: regions.id,
      code: regions.code,
      name: regions.name,
      level: regions.level,
      climateZone: regions.climateZone,
      parentCode: parent,
      parentName,
      targetDate: forecasts.targetDate,
      horizonDay: forecasts.horizonDay,
      resolution: forecasts.resolution,
      predictedTmaxC: forecasts.predictedTmaxC,
      lowerC: forecasts.lowerC,
      upperC: forecasts.upperC,
      nwpTmaxC: forecasts.nwpTmaxC,
      normalTmaxC: forecasts.normalTmaxC,
      departureC: forecasts.departureC,
      severity: forecasts.severity,
      imdCategory: forecasts.imdCategory,
      confidence: forecasts.confidence,
      confidenceScore: forecasts.confidenceScore,
      durationDays: forecasts.durationDays,
      peak,
    })
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(and(...conds))
    .orderBy(desc(forecasts.predictedTmaxC));
  return rows.map(({ parentCode, parentName: pName, peak: pk, ...r }) => ({
    ...r,
    stateCode: r.level === 'state' ? r.code : (parentCode ?? ''),
    stateName: r.level === 'state' ? r.name : (pName ?? ''),
    peakSeverity: SEVERITIES[Number(pk)] ?? r.severity,
  }));
}

/** Ranks "top risks": severity first, then predicted Tmax, then confidence. */
export function topRisks<T extends { severity: Severity; predictedTmaxC: number; confidenceScore: number }>(rows: T[], n = 8): T[] {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  return [...rows]
    .filter((r) => rank(r.severity) >= 1)
    .sort((a, b) => rank(b.severity) - rank(a.severity) || b.predictedTmaxC - a.predictedTmaxC || b.confidenceScore - a.confidenceScore)
    .slice(0, n);
}

/** Full horizon for a region. */
export async function regionSeries(db: DB, runId: string, regionId: number) {
  return forecastSeries(db, runId, regionId);
}

/** Recent daily climate before (and including) the issue date, e.g. last 14 days of reanalysis. */
export async function recentHistory(db: DB, regionId: number, issuedFor: string, days = 14) {
  return climateSeries(db, [regionId], addDays(issuedFor, -(days - 1)), issuedFor);
}

/** Verified truth for the forecast window (only exists for hindcasts / past runs). */
export async function windowTruth(db: DB, regionId: number, from: string, to: string) {
  return climateSeries(db, [regionId], from, to);
}

export type YearWindow = { year: number; label: string; values: Record<string, number | null>; mean: number | null; max: number | null; days: number; kinds: DataKind[] };

/**
 * Same calendar window (month-day range) in every year that has data. `refYear` is the forecast's year; its series
 * contains reanalysis (truth) where available. Values are keyed by 'MM-DD'.
 */
export async function historicalComparison(db: DB, regionId: number, from: string, to: string): Promise<YearWindow[]> {
  const rows = await sameWindowByYear(db, regionId, from, to);
  const crosses = from.slice(5) > to.slice(5);
  const byYear = new Map<number, typeof rows>();
  for (const r of rows) {
    let y = Number(r.day.slice(0, 4));
    // For windows crossing New Year, January days belong to the previous year's window.
    if (crosses && r.day.slice(5) <= to.slice(5)) y -= 1;
    const list = byYear.get(y) ?? [];
    list.push(r);
    byYear.set(y, list);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, list]) => {
      const vals = list.map((x) => x.tmaxC).filter((x): x is number => x != null);
      return {
        year,
        label: String(year),
        values: Object.fromEntries(list.map((x) => [x.day.slice(5), x.tmaxC])),
        mean: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null,
        max: vals.length ? Math.max(...vals) : null,
        days: vals.length,
        kinds: [...new Set(list.map((x) => x.dataKind))],
      };
    });
}

export type WarningRow = { id: number; colorCode: string; title: string; issuedAt: string; validFrom: string; validTo: string; url: string; retrievedAt: string; verified: boolean; source: string; regionName: string };

/** Official warnings (IMD) for the given regions. Empty unless a verified integration is configured. */
export async function officialWarningsFor(db: DB, regionIds: number[], window?: { from: string; to: string }): Promise<WarningRow[]> {
  if (!regionIds.length) return [];
  const conds = [inArray(officialWarnings.regionId, regionIds)];
  if (window) {
    conds.push(lte(officialWarnings.validFrom, new Date(`${window.to}T23:59:59+05:30`)));
    conds.push(gte(officialWarnings.validTo, new Date(`${window.from}T00:00:00+05:30`)));
  }
  const rows = await db
    .select({
      id: officialWarnings.id,
      colorCode: officialWarnings.colorCode,
      title: officialWarnings.title,
      issuedAt: officialWarnings.issuedAt,
      validFrom: officialWarnings.validFrom,
      validTo: officialWarnings.validTo,
      url: officialWarnings.url,
      retrievedAt: officialWarnings.retrievedAt,
      verified: officialWarnings.verified,
      source: dataSources.name,
      regionName: regions.name,
    })
    .from(officialWarnings)
    .innerJoin(dataSources, eq(dataSources.id, officialWarnings.sourceId))
    .innerJoin(regions, eq(regions.id, officialWarnings.regionId))
    .where(and(...conds))
    .orderBy(desc(officialWarnings.issuedAt))
    .limit(20);
  return rows.map((r) => ({
    ...r,
    issuedAt: r.issuedAt.toISOString(),
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo.toISOString(),
    retrievedAt: r.retrievedAt.toISOString(),
  }));
}

/** IMD source registry row (to explain whether the integration is configured). */
export async function imdSource(db: DB) {
  const [s] = await db.select().from(dataSources).where(eq(dataSources.key, 'imd')).limit(1);
  return s ?? null;
}

/** Data-source registry (for provenance lists). */
export async function sourcesByKey(db: DB, keys: string[]) {
  if (!keys.length) return [];
  return db.select().from(dataSources).where(inArray(dataSources.key, keys));
}

export type ChildSeverity = { regionId: number; code: string; name: string; level: string; hasForecast: boolean; peakSeverity: Severity | null; peakTmaxC: number | null; day1Severity: Severity | null };

/** Children of a region with their peak forecast severity in a run (for drill-down chips). */
export async function childrenSeverity(db: DB, runId: string | null, parentId: number): Promise<ChildSeverity[]> {
  const kids = await db
    .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level })
    .from(regions)
    .where(eq(regions.parentId, parentId))
    .orderBy(asc(regions.name));
  if (!kids.length) return [];
  const stats = runId
    ? await db
        .select({
          regionId: forecasts.regionId,
          peak: sql<number>`max(case ${forecasts.severity} when 'extreme' then 3 when 'high' then 2 when 'moderate' then 1 else 0 end)::int`,
          peakTmax: sql<number>`max(${forecasts.predictedTmaxC})`,
          day1: sql<string | null>`min(case when ${forecasts.horizonDay} = 1 then ${forecasts.severity}::text end)`,
        })
        .from(forecasts)
        .where(and(eq(forecasts.runId, runId), inArray(forecasts.regionId, kids.map((k) => k.id))))
        .groupBy(forecasts.regionId)
    : [];
  return kids.map((k) => {
    const s = stats.find((x) => x.regionId === k.id);
    return {
      regionId: k.id,
      code: k.code,
      name: k.name,
      level: k.level,
      hasForecast: Boolean(s),
      peakSeverity: s ? (SEVERITIES[Number(s.peak)] ?? 'low') : null,
      peakTmaxC: s ? Number(s.peakTmax) : null,
      day1Severity: (s?.day1 as Severity | null) ?? null,
    };
  });
}

/** Forecast rows for a run (all regions, all days) for CSV export. */
export async function runExportRows(db: DB, runId: string) {
  const parent = sql<string | null>`(select p.code from regions p where p.id = ${regions.parentId})`;
  return db
    .select({
      code: regions.code,
      name: regions.name,
      level: regions.level,
      path: regions.path,
      parentCode: parent,
      climateZone: regions.climateZone,
      lat: regions.lat,
      lon: regions.lon,
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
      inputKinds: forecasts.inputKinds,
    })
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(eq(forecasts.runId, runId))
    .orderBy(asc(regions.level), asc(regions.code), asc(forecasts.targetDate));
}
