/**
 * Forecast runs, verification and model comparison queries.
 * Verification rows join `forecast_verifications` (truth) with `forecasts` (prediction), the run and the model.
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/types';
import { forecastRuns, forecasts, forecastVerifications, modelVersions, regions } from '../db/schema';
import { summariseAccuracy, type AccuracySummary, type VerificationPoint } from './metrics';
import type { DataKind, Severity } from '@/lib/domain';

export type RunListItem = {
  id: string;
  scenario: 'live' | 'replay';
  issuedFor: string;
  horizonDays: number;
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  isHindcast: boolean;
  createdAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  modelKey: string;
  modelName: string;
  regionsCount: number;
  forecastCount: number;
  verifiedCount: number;
};

/** All forecast runs (newest first) with forecast / verification counts. */
export async function listRuns(db: DB, opts: { scenario?: 'live' | 'replay'; limit?: number } = {}): Promise<RunListItem[]> {
  const fc = sql<number>`(select count(*) from ${forecasts} f where f.run_id = ${forecastRuns.id})::int`;
  const vc = sql<number>`(select count(*) from ${forecastVerifications} v join ${forecasts} f on f.id = v.forecast_id where f.run_id = ${forecastRuns.id})::int`;
  const rows = await db
    .select({
      id: forecastRuns.id,
      scenario: forecastRuns.scenario,
      issuedFor: forecastRuns.issuedFor,
      horizonDays: forecastRuns.horizonDays,
      status: forecastRuns.status,
      isHindcast: forecastRuns.isHindcast,
      createdAt: forecastRuns.createdAt,
      finishedAt: forecastRuns.finishedAt,
      triggeredBy: forecastRuns.triggeredBy,
      modelKey: modelVersions.key,
      modelName: modelVersions.name,
      regionsCount: forecastRuns.regionsCount,
      forecastCount: fc,
      verifiedCount: vc,
    })
    .from(forecastRuns)
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .where(opts.scenario ? eq(forecastRuns.scenario, opts.scenario) : undefined)
    .orderBy(desc(forecastRuns.createdAt))
    .limit(opts.limit ?? 50);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    forecastCount: Number(r.forecastCount),
    verifiedCount: Number(r.verifiedCount),
  }));
}

export type VerificationRow = VerificationPoint & {
  forecastId: number;
  runId: string;
  scenario: 'live' | 'replay';
  issuedFor: string;
  isHindcast: boolean;
  modelName: string;
  targetDate: string;
  path: string;
  observedKind: DataKind;
  evaluatedAt: string;
};

/** Joined verification rows, optionally restricted to runs / a level. */
export async function verificationRows(db: DB, opts: { runIds?: string[]; level?: 'state' | 'district' } = {}): Promise<VerificationRow[]> {
  const conds: SQL[] = [];
  if (opts.runIds?.length) conds.push(inArray(forecasts.runId, opts.runIds));
  if (opts.level) conds.push(eq(regions.level, opts.level));
  const rows = await db
    .select({
      forecastId: forecasts.id,
      runId: forecasts.runId,
      scenario: forecastRuns.scenario,
      issuedFor: forecastRuns.issuedFor,
      isHindcast: forecastRuns.isHindcast,
      modelKey: modelVersions.key,
      modelName: modelVersions.name,
      regionId: regions.id,
      regionCode: regions.code,
      regionName: regions.name,
      level: regions.level,
      path: regions.path,
      targetDate: forecasts.targetDate,
      horizonDay: forecasts.horizonDay,
      predictedTmaxC: forecasts.predictedTmaxC,
      lowerC: forecasts.lowerC,
      upperC: forecasts.upperC,
      predictedSeverity: forecasts.severity,
      observedTmaxC: forecastVerifications.observedTmaxC,
      observedKind: forecastVerifications.observedKind,
      errorC: forecastVerifications.errorC,
      observedSeverity: forecastVerifications.observedSeverity,
      evaluatedAt: forecastVerifications.evaluatedAt,
    })
    .from(forecastVerifications)
    .innerJoin(forecasts, eq(forecasts.id, forecastVerifications.forecastId))
    .innerJoin(forecastRuns, eq(forecastRuns.id, forecasts.runId))
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(forecasts.runId), asc(regions.level), asc(regions.name), asc(forecasts.targetDate));
  return rows.map((r) => ({ ...r, evaluatedAt: r.evaluatedAt.toISOString() }));
}

export type AccuracyReport = AccuracySummary & {
  runs: { id: string; scenario: 'live' | 'replay'; issuedFor: string; isHindcast: boolean; modelKey: string }[];
  observedKinds: DataKind[];
  /** Distinct (region, target day) samples and distinct regions, to make small-sample caveats explicit. */
  regions: number;
};

export async function accuracyReport(db: DB, opts: { runIds?: string[]; level?: 'state' | 'district' } = {}): Promise<AccuracyReport> {
  const rows = await verificationRows(db, opts);
  const runs = [...new Map(rows.map((r) => [r.runId, { id: r.runId, scenario: r.scenario, issuedFor: r.issuedFor, isHindcast: r.isHindcast, modelKey: r.modelKey }])).values()];
  return {
    ...summariseAccuracy(rows),
    runs,
    observedKinds: [...new Set(rows.map((r) => r.observedKind))],
    regions: new Set(rows.map((r) => r.regionId)).size,
  };
}

export type ModelVersionRow = {
  id: number;
  key: string;
  name: string;
  method: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  runs: number;
  lastRunAt: string | null;
  verified: number;
};

/** Registered model versions with run and verification counts (accuracy per model comes from accuracyReport). */
export async function modelVersionTable(db: DB): Promise<ModelVersionRow[]> {
  const runs = sql<number>`(select count(*) from ${forecastRuns} r where r.model_version_id = "model_versions"."id")::int`;
  const lastRun = sql<string | null>`(select max(r.created_at)::text from ${forecastRuns} r where r.model_version_id = "model_versions"."id")`;
  const verified = sql<number>`(select count(*) from ${forecastVerifications} v join ${forecasts} f on f.id = v.forecast_id join ${forecastRuns} r on r.id = f.run_id where r.model_version_id = "model_versions"."id")::int`;
  const rows = await db
    .select({
      id: modelVersions.id,
      key: modelVersions.key,
      name: modelVersions.name,
      method: modelVersions.method,
      description: modelVersions.description,
      isActive: modelVersions.isActive,
      createdAt: modelVersions.createdAt,
      runs,
      lastRunAt: lastRun,
      verified,
    })
    .from(modelVersions)
    .orderBy(asc(modelVersions.id));
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    runs: Number(r.runs),
    verified: Number(r.verified),
    lastRunAt: r.lastRunAt ? new Date(r.lastRunAt).toISOString() : null,
  }));
}

export type RunRisk = {
  runId: string;
  scenario: 'live' | 'replay';
  issuedFor: string;
  isHindcast: boolean;
  status: string;
  modelKey: string;
  createdAt: string;
  /** Peak severity across the horizon, counted per region. */
  states: Record<Severity, number>;
  districts: Record<Severity, number>;
};

/** Distribution of peak forecast severity per region, for each run (newest first). */
export async function riskDistributionByRun(db: DB, limit = 12): Promise<RunRisk[]> {
  const runs = await db
    .select({
      id: forecastRuns.id,
      scenario: forecastRuns.scenario,
      issuedFor: forecastRuns.issuedFor,
      isHindcast: forecastRuns.isHindcast,
      status: forecastRuns.status,
      modelKey: modelVersions.key,
      createdAt: forecastRuns.createdAt,
    })
    .from(forecastRuns)
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .where(inArray(forecastRuns.status, ['succeeded', 'partial']))
    .orderBy(desc(forecastRuns.createdAt))
    .limit(limit);
  if (!runs.length) return [];
  const peak = sql<number>`max(case ${forecasts.severity} when 'extreme' then 3 when 'high' then 2 when 'moderate' then 1 else 0 end)::int`;
  const perRegion = db
    .select({ runId: forecasts.runId, regionId: forecasts.regionId, peak: peak.as('peak') })
    .from(forecasts)
    .where(inArray(forecasts.runId, runs.map((r) => r.id)))
    .groupBy(forecasts.runId, forecasts.regionId)
    .as('per_region');
  const counts = await db
    .select({ runId: perRegion.runId, level: regions.level, peak: perRegion.peak, n: sql<number>`count(*)::int` })
    .from(perRegion)
    .innerJoin(regions, eq(regions.id, perRegion.regionId))
    .groupBy(perRegion.runId, regions.level, perRegion.peak);
  const sev: Severity[] = ['low', 'moderate', 'high', 'extreme'];
  const empty = (): Record<Severity, number> => ({ low: 0, moderate: 0, high: 0, extreme: 0 });
  return runs.map((r) => {
    const states = empty();
    const districts = empty();
    for (const c of counts.filter((x) => x.runId === r.id)) {
      const s = sev[Number(c.peak)] ?? 'low';
      if (c.level === 'state') states[s] += Number(c.n);
      if (c.level === 'district') districts[s] += Number(c.n);
    }
    return {
      runId: r.id,
      scenario: r.scenario,
      issuedFor: r.issuedFor,
      isHindcast: r.isHindcast,
      status: r.status,
      modelKey: r.modelKey,
      createdAt: r.createdAt.toISOString(),
      states,
      districts,
    };
  });
}
