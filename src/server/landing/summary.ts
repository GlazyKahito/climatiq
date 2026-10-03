import 'server-only';
import { and, eq, inArray, min } from 'drizzle-orm';
import type { DB } from '../db/types';
import { forecasts, regions } from '../db/schema';
import { forecastsForDay, latestRun, severityDistribution, type RegionForecastRow, type RunInfo } from '../forecasting/queries';
import type { Scenario } from '../scenario';
import { SEVERITY_META, type Severity } from '@/lib/domain';

export type LandingRegion = {
  code: string;
  name: string;
  parentName: string | null;
  level: RegionForecastRow['level'];
  severity: Severity;
  predictedTmaxC: number;
  departureC: number | null;
  resolution: string;
  confidence: RegionForecastRow['confidence'];
};

export type LandingScenarioSummary = {
  scenario: Scenario;
  run: Pick<RunInfo, 'id' | 'issuedFor' | 'horizonDays' | 'isHindcast' | 'createdAt' | 'modelKey' | 'modelName'>;
  /** the run's first forecast day (horizon day 1) shown on the landing page */
  targetDate: string;
  level: 'district' | 'state';
  regionsTotal: number;
  counts: Record<Severity, number>;
  stateCounts: Record<Severity, number>;
  top: LandingRegion[];
  /** distinct input data kinds that fed these forecasts (e.g. reanalysis, nwp_forecast) */
  inputKinds: string[];
  /** human-readable input descriptions recorded on the run */
  inputs: { nwp: string | null; history: string | null; normals: string | null };
};

export type LandingSummary = {
  replay: LandingScenarioSummary | null;
  live: LandingScenarioSummary | null;
  generatedAt: string;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

async function firstTargetDate(db: DB, runId: string): Promise<string | null> {
  const [r] = await db.select({ d: min(forecasts.targetDate) }).from(forecasts).where(eq(forecasts.runId, runId));
  return r?.d ?? null;
}

async function scenarioSummary(db: DB, scenario: Scenario, topN: number): Promise<LandingScenarioSummary | null> {
  const run = await latestRun(db, scenario);
  if (!run) return null;
  const targetDate = await firstTargetDate(db, run.id);
  if (!targetDate) return null;

  let level: 'district' | 'state' = 'district';
  let rows = await forecastsForDay(db, run.id, targetDate, { level: 'district' });
  if (rows.length === 0) {
    level = 'state';
    rows = await forecastsForDay(db, run.id, targetDate, { level: 'state' });
  }
  if (rows.length === 0) return null;

  const [counts, stateCounts] = await Promise.all([
    severityDistribution(db, run.id, targetDate, level),
    severityDistribution(db, run.id, targetDate, 'state'),
  ]);

  const ranked = [...rows].sort(
    (a, b) => SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank || b.predictedTmaxC - a.predictedTmaxC,
  );
  const topRows = ranked.slice(0, topN);
  const parentIds = [...new Set(topRows.map((r) => r.parentId).filter((v): v is number => v != null))];
  const parents = parentIds.length
    ? await db.select({ id: regions.id, name: regions.name }).from(regions).where(and(inArray(regions.id, parentIds)))
    : [];
  const parentName = new Map(parents.map((p) => [p.id, p.name]));

  const kinds = new Set<string>();
  for (const r of rows) for (const k of r.inputKinds ?? []) kinds.add(k);

  return {
    scenario,
    run: {
      id: run.id,
      issuedFor: run.issuedFor,
      horizonDays: run.horizonDays,
      isHindcast: run.isHindcast,
      createdAt: run.createdAt,
      modelKey: run.modelKey,
      modelName: run.modelName,
    },
    targetDate,
    level,
    regionsTotal: rows.length,
    counts,
    stateCounts,
    top: topRows.map((r) => ({
      code: r.code,
      name: r.name,
      parentName: r.parentId != null ? (parentName.get(r.parentId) ?? null) : null,
      level: r.level,
      severity: r.severity,
      predictedTmaxC: r.predictedTmaxC,
      departureC: r.departureC,
      resolution: r.resolution,
      confidence: r.confidence,
    })),
    inputKinds: [...kinds].sort(),
    inputs: { nwp: str(run.inputs?.nwp), history: str(run.inputs?.history), normals: str(run.inputs?.normals) },
  };
}

/**
 * Data for the public landing page's climate overview: the latest historical-replay run (real ERA5 + CLIMATIQ
 * hindcast) and the latest live run, each summarised for its first forecast day. Either side is null when no
 * successful run exists yet (the UI then shows an explanatory empty state).
 */
export async function getLandingSummary(db: DB, opts: { topN?: number } = {}): Promise<LandingSummary> {
  const topN = opts.topN ?? 5;
  const [replay, live] = await Promise.all([scenarioSummary(db, 'replay', topN), scenarioSummary(db, 'live', topN)]);
  return { replay, live, generatedAt: new Date().toISOString() };
}
