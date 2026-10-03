/**
 * Forecast pipeline: loads inputs (history, normals, NWP) for every forecastable region, runs the registered model,
 * stores the run + forecasts, verifies hindcasts against reanalysis truth and triggers the alert engine.
 */
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import {
  climateNormals,
  dailyClimate,
  dataSources,
  forecastRuns,
  forecasts,
  forecastVerifications,
  ingestionRuns,
  modelVersions,
  regions,
  severityThresholds,
} from '../db/schema';
import { forecastRegion, MODEL_KEY, type DayInput, type ForecastPoint } from './baseline';
import { classify, DEFAULT_THRESHOLDS, type ZoneThresholds } from './severity';
import { OpenMeteoClient, openMeteoFromEnv, type DailySeries } from '../ingestion/adapters/open-meteo';
import { evaluateAlerts } from '../alerts/engine';
import { SOURCE_KEYS } from '../db/seed/reference';
import { audit } from '../audit/log';
import { addDays, todayIST } from '@/lib/domain';

export type Scenario = 'live' | 'replay';

export const REPLAY_ISSUED_FOR = '2024-05-26';
/** Normals basis per scenario: replay uses only years BEFORE the event; live uses the latest years. */
export const NORMAL_BASIS: Record<Scenario, { key: string; label: string; years: number[] }> = {
  replay: { key: 'era5-2019-2023', label: 'ERA5 2019–2023 mean (±7-day window)', years: [2019, 2020, 2021, 2022, 2023] },
  live: { key: 'era5-2021-2025', label: 'ERA5 2021–2025 mean (±7-day window)', years: [2021, 2022, 2023, 2024, 2025] },
};

export type RunOptions = {
  scenario: Scenario;
  issuedFor?: string;
  horizonDays?: number;
  triggeredBy: string;
  /** Inject an Open-Meteo client (tests) or `null` to skip NWP. */
  nwpClient?: OpenMeteoClient | null;
  skipAlerts?: boolean;
};

export type RunResult = { runId: string; status: 'succeeded' | 'partial' | 'failed'; regions: number; error?: string };

async function sourceId(db: DB, key: string) {
  const [s] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, key)).limit(1);
  if (!s) throw new Error(`Data source ${key} missing — run the reference seed`);
  return s.id;
}

export async function loadThresholds(db: DB): Promise<ZoneThresholds> {
  const rows = await db.select().from(severityThresholds);
  if (!rows.length) return DEFAULT_THRESHOLDS;
  const out: ZoneThresholds = { plains: [], coastal: [], hilly: [] };
  for (const r of rows) out[r.zone].push({ level: r.level, minTmaxC: r.minTmaxC, minDepartureC: r.minDepartureC, absoluteTmaxC: r.absoluteTmaxC });
  return out;
}

/** Forecastable regions: all states + pilot districts (cities inherit their district forecast). */
async function forecastRegions(db: DB) {
  return db
    .select({ id: regions.id, code: regions.code, level: regions.level, lat: regions.lat, lon: regions.lon, zone: regions.climateZone })
    .from(regions)
    .where(inArray(regions.level, ['state', 'district']));
}

export async function runForecast(db: DB, opts: RunOptions): Promise<RunResult> {
  const scenario = opts.scenario;
  const issuedFor = opts.issuedFor ?? (scenario === 'replay' ? REPLAY_ISSUED_FOR : todayIST());
  const horizon = opts.horizonDays ?? 7;
  const basis = NORMAL_BASIS[scenario];
  const [model] = await db.select().from(modelVersions).where(eq(modelVersions.key, MODEL_KEY)).limit(1);
  if (!model) throw new Error('Model version baseline-v1 missing — run the reference seed');

  const [run] = await db
    .insert(forecastRuns)
    .values({
      modelVersionId: model.id,
      scenario,
      issuedFor,
      horizonDays: horizon,
      isHindcast: scenario === 'replay',
      triggeredBy: opts.triggeredBy,
      params: { tauDays: 3, band: 'nominal 80% (heuristic σ, uncalibrated)', normalsBasis: basis.key },
    })
    .returning({ id: forecastRuns.id });

  try {
    const regs = await forecastRegions(db);
    const ids = regs.map((r) => r.id);
    const thresholds = await loadThresholds(db);

    // History (reanalysis/simulated) for the 10 days up to the issue date.
    const hist = await db
      .select({ regionId: dailyClimate.regionId, day: dailyClimate.day, kind: dailyClimate.dataKind, tmax: dailyClimate.tmaxC, tmin: dailyClimate.tminC })
      .from(dailyClimate)
      .where(and(inArray(dailyClimate.regionId, ids), between(dailyClimate.day, addDays(issuedFor, -10), issuedFor), inArray(dailyClimate.dataKind, ['reanalysis', 'observed', 'simulated'])))
      .orderBy(asc(dailyClimate.day));
    const histBy = new Map<number, { days: DayInput[]; kind: 'reanalysis' | 'observed' | 'simulated' }>();
    for (const h of hist) {
      const e = histBy.get(h.regionId) ?? { days: [], kind: h.kind as 'reanalysis' };
      e.days.push({ day: h.day, tmaxC: h.tmax, tminC: h.tmin });
      histBy.set(h.regionId, e);
    }

    // Reference normals.
    const norms = await db
      .select({ regionId: climateNormals.regionId, doy: climateNormals.dayOfYear, tmax: climateNormals.normalTmaxC, tmin: climateNormals.normalTminC })
      .from(climateNormals)
      .where(and(eq(climateNormals.basisKey, basis.key), inArray(climateNormals.regionId, ids)));
    const normBy = new Map<number, Map<number, { tmax: number; tmin: number | null }>>();
    for (const n of norms) {
      const m = normBy.get(n.regionId) ?? new Map();
      m.set(n.doy, { tmax: n.tmax, tmin: n.tmin });
      normBy.set(n.regionId, m);
    }

    // NWP guidance: live → Open-Meteo forecast API (stored as nwp_forecast in daily_climate);
    // replay → none available for 2024 in our snapshot (honest: persistence + climatology only).
    const nwpBy = new Map<number, DayInput[]>();
    let nwpStatus = 'none available';
    if (scenario === 'replay') {
      nwpStatus = await loadStoredNwp(db, SOURCE_KEYS.openMeteoPreviousRuns, ids, issuedFor, horizon, nwpBy);
    } else {
      const client = opts.nwpClient === undefined ? openMeteoFromEnv() : opts.nwpClient;
      if (client) {
        nwpStatus = await ingestNwp(db, client, regs, issuedFor, horizon, nwpBy).catch((e: Error) => `failed: ${e.message}`);
      } else nwpStatus = 'disabled';
    }

    const points: ForecastPoint[] = [];
    let missingNormals = 0;
    for (const r of regs) {
      const h = histBy.get(r.id);
      const normals = normBy.get(r.id);
      if (!normals?.size) missingNormals++;
      if (!h?.days.length && !nwpBy.get(r.id)?.length) continue;
      points.push(
        ...forecastRegion(
          {
            regionId: r.id,
            zone: r.zone,
            resolution: r.level === 'state' ? 'state-centroid (single point)' : 'district-centroid (point)',
            history: h?.days ?? [],
            nwp: nwpBy.get(r.id) ?? [],
            normals: normals ?? new Map(),
            historyKind: h?.kind ?? 'reanalysis',
          },
          issuedFor,
          horizon,
          thresholds,
        ),
      );
    }

    for (let i = 0; i < points.length; i += 500) {
      await db.insert(forecasts).values(points.slice(i, i + 500).map((p) => ({ ...p, runId: run.id })));
    }
    const regionsCount = new Set(points.map((p) => p.regionId)).size;
    const status: RunResult['status'] = regionsCount === 0 ? 'failed' : regionsCount < regs.length ? 'partial' : 'succeeded';
    await db
      .update(forecastRuns)
      .set({
        status,
        regionsCount,
        finishedAt: new Date(),
        inputs: {
          history: 'ERA5 reanalysis via Open-Meteo (data_kind reanalysis)',
          normals: basis.label,
          nwp: nwpStatus,
          regionsConsidered: regs.length,
          regionsWithoutNormals: missingNormals,
        },
        error: regionsCount === 0 ? 'No input data available for any region' : null,
      })
      .where(eq(forecastRuns.id, run.id));

    if (scenario === 'replay') await verifyRun(db, run.id);
    await audit(db, { actor: 'system', action: 'forecast.run', entityType: 'forecast_run', entityId: run.id, after: { scenario, issuedFor, status, regionsCount } });
    if (!opts.skipAlerts && status !== 'failed') await evaluateAlerts(db, run.id);
    return { runId: run.id, status, regions: regionsCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(forecastRuns).set({ status: 'failed', error: msg.slice(0, 500), finishedAt: new Date() }).where(eq(forecastRuns.id, run.id));
    return { runId: run.id, status: 'failed', regions: 0, error: msg };
  }
}

/** Fetches Open-Meteo NWP for all regions, stores it as `nwp_forecast` daily_climate rows, fills `nwpBy`. */
async function ingestNwp(
  db: DB,
  client: OpenMeteoClient,
  regs: { id: number; code: string; lat: number; lon: number }[],
  issuedFor: string,
  horizon: number,
  nwpBy: Map<number, DayInput[]>,
): Promise<string> {
  const src = await sourceId(db, SOURCE_KEYS.openMeteoForecast);
  const [ing] = await db.insert(ingestionRuns).values({ sourceId: src, job: 'forecast', triggeredBy: 'forecast-run' }).returning({ id: ingestionRuns.id });
  try {
    const series: DailySeries[] = await client.forecast(
      regs.map((r) => ({ key: String(r.id), lat: r.lat, lon: r.lon })),
      Math.min(16, horizon + 1),
      3,
    );
    const rows = [];
    for (const s of series) {
      const regionId = Number(s.key);
      nwpBy.set(regionId, s.days);
      for (const d of s.days) {
        if (d.day <= issuedFor || d.tmaxC == null) continue;
        rows.push({
          regionId,
          sourceId: src,
          day: d.day,
          dataKind: 'nwp_forecast' as const,
          tmaxC: d.tmaxC,
          tminC: d.tminC ?? null,
          apparentTmaxC: (d as { apparentTmaxC?: number | null }).apparentTmaxC ?? null,
          rhMeanPct: d.rhMeanPct ?? null,
          windMaxKmh: d.windMaxKmh ?? null,
          radiationMj: d.radiationMj ?? null,
          ingestionRunId: ing.id,
        });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      await db
        .insert(dailyClimate)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [dailyClimate.regionId, dailyClimate.sourceId, dailyClimate.day, dailyClimate.dataKind],
          set: { tmaxC: sql`excluded.tmax_c`, tminC: sql`excluded.tmin_c`, rhMeanPct: sql`excluded.rh_mean_pct`, windMaxKmh: sql`excluded.wind_max_kmh`, radiationMj: sql`excluded.radiation_mj`, ingestionRunId: ing.id, updatedAt: new Date() },
        });
    }
    // Recent days from the forecast API (past_days) give a near-real-time persistence signal when ERA5 lags.
    await db
      .update(ingestionRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), recordsIn: series.length, recordsWritten: rows.length, attempts: 1, meta: { requests: client.requests } })
      .where(eq(ingestionRuns.id, ing.id));
    return `Open-Meteo forecast API (best-match NWP), ${series.length} locations, retrieved ${new Date().toISOString()}`;
  } catch (e) {
    await db
      .update(ingestionRuns)
      .set({ status: 'failed', finishedAt: new Date(), error: (e as Error).message.slice(0, 500) })
      .where(eq(ingestionRuns.id, ing.id));
    throw e;
  }
}

/** Loads previously ingested NWP guidance (e.g. archived as-issued forecasts for the replay). */
async function loadStoredNwp(db: DB, sourceKey: string, ids: number[], issuedFor: string, horizon: number, nwpBy: Map<number, DayInput[]>) {
  const [src] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, sourceKey)).limit(1);
  if (!src) return 'none available (archived NWP not ingested)';
  const rows = await db
    .select({ regionId: dailyClimate.regionId, day: dailyClimate.day, tmax: dailyClimate.tmaxC, tmin: dailyClimate.tminC })
    .from(dailyClimate)
    .where(and(eq(dailyClimate.sourceId, src.id), eq(dailyClimate.dataKind, 'nwp_forecast'), inArray(dailyClimate.regionId, ids), between(dailyClimate.day, addDays(issuedFor, 1), addDays(issuedFor, horizon))));
  for (const r of rows) {
    const list = nwpBy.get(r.regionId) ?? [];
    list.push({ day: r.day, tmaxC: r.tmax, tminC: r.tmin });
    nwpBy.set(r.regionId, list);
  }
  return rows.length
    ? `Open-Meteo Previous Runs API — NWP as issued h days before each target day (no hindsight), ${nwpBy.size} regions`
    : 'none available (archived NWP not ingested)';
}

/** Verifies a run against reanalysis truth where available (replay hindcasts). */
export async function verifyRun(db: DB, runId: string) {
  const rows = await db
    .select({
      forecastId: forecasts.id,
      predicted: forecasts.predictedTmaxC,
      normal: forecasts.normalTmaxC,
      zone: regions.climateZone,
      observed: dailyClimate.tmaxC,
    })
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .innerJoin(dailyClimate, and(eq(dailyClimate.regionId, forecasts.regionId), eq(dailyClimate.day, forecasts.targetDate), eq(dailyClimate.dataKind, 'reanalysis')))
    .where(eq(forecasts.runId, runId));
  const values = rows
    .filter((r) => r.observed != null)
    .map((r) => ({
      forecastId: r.forecastId,
      observedTmaxC: r.observed as number,
      observedKind: 'reanalysis' as const,
      errorC: Math.round((r.predicted - (r.observed as number)) * 100) / 100,
      observedSeverity: classify(r.observed as number, r.normal, r.zone).severity,
    }));
  for (let i = 0; i < values.length; i += 500) await db.insert(forecastVerifications).values(values.slice(i, i + 500)).onConflictDoNothing();
  return values.length;
}
