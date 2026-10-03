/**
 * Ingestion jobs (manual from the admin panel, daily Vercel Cron, or on demand):
 *  - refreshRecentHistory: last N days of ERA5 reanalysis for all forecastable regions (ERA5 lags ~5 days)
 *  - refreshLiveGrid:      Open-Meteo NWP Tmax on the 1° India grid for the next 7 days (heat layer)
 *  - refreshAll:           both, then a new live forecast run (which ingests per-region NWP itself)
 * Each job records an `ingestion_runs` row with counts, attempts and errors; failures never fabricate data.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { dailyClimate, dataSources, forecastRuns, gridDaily, ingestionRuns, notifications, regions } from '../db/schema';
import { openMeteoFromEnv } from './adapters/open-meteo';
import { SOURCE_KEYS } from '../db/seed/reference';
import { runForecast, type RunResult } from '../forecasting/run';
import { addDays, todayIST } from '@/lib/domain';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

async function source(db: DB, key: string) {
  const [s] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, key)).limit(1);
  if (!s) throw new Error(`Unknown data source ${key}`);
  return s.id;
}

async function startRun(db: DB, sourceKey: string, job: string, triggeredBy: string) {
  const [r] = await db.insert(ingestionRuns).values({ sourceId: await source(db, sourceKey), job, triggeredBy }).returning({ id: ingestionRuns.id });
  return r.id;
}

async function finishRun(db: DB, id: string, patch: Partial<typeof ingestionRuns.$inferInsert>) {
  await db.update(ingestionRuns).set({ finishedAt: new Date(), ...patch }).where(eq(ingestionRuns.id, id));
}

export type JobResult = { job: string; status: 'succeeded' | 'failed' | 'partial'; written: number; error?: string };

export async function refreshRecentHistory(db: DB, triggeredBy: string, client = openMeteoFromEnv({ batchSize: 50 }), days = 21): Promise<JobResult> {
  const runId = await startRun(db, SOURCE_KEYS.openMeteoArchive, 'archive', triggeredBy);
  try {
    const regs = await db
      .select({ id: regions.id, lat: regions.lat, lon: regions.lon })
      .from(regions)
      .where(inArray(regions.level, ['state', 'district']));
    const end = addDays(todayIST(), -5); // ERA5 availability lag
    const start = addDays(end, -days + 1);
    const series = await client.archive(
      regs.map((r) => ({ key: String(r.id), lat: r.lat, lon: r.lon })),
      start,
      end,
      { model: 'era5', variables: ['temperature_2m_max', 'temperature_2m_min'] },
    );
    const src = await source(db, SOURCE_KEYS.openMeteoArchive);
    const rows = series.flatMap((s) =>
      s.days
        .filter((d) => d.tmaxC != null)
        .map((d) => ({ regionId: Number(s.key), sourceId: src, day: d.day, dataKind: 'reanalysis' as const, tmaxC: d.tmaxC, tminC: d.tminC ?? null, ingestionRunId: runId })),
    );
    for (let i = 0; i < rows.length; i += 1000) {
      await db
        .insert(dailyClimate)
        .values(rows.slice(i, i + 1000))
        .onConflictDoUpdate({
          target: [dailyClimate.regionId, dailyClimate.sourceId, dailyClimate.day, dailyClimate.dataKind],
          set: { tmaxC: sql`excluded.tmax_c`, tminC: sql`excluded.tmin_c`, ingestionRunId: runId, updatedAt: new Date() },
        });
    }
    await finishRun(db, runId, { status: 'succeeded', recordsIn: series.length, recordsWritten: rows.length, meta: { start, end, requests: client.requests } });
    return { job: 'archive', status: 'succeeded', written: rows.length };
  } catch (e) {
    const msg = (e as Error).message;
    await finishRun(db, runId, { status: 'failed', error: msg.slice(0, 500) });
    return { job: 'archive', status: 'failed', written: 0, error: msg };
  }
}

/** Grid points of the heat layer (same 1° grid as the replay snapshot). */
export function gridPoints(): [number, number][] {
  const file = join(process.cwd(), 'src/server/db/seed/data/snapshot/grid-replay-era5.json.gz');
  if (!existsSync(file)) return [];
  return (JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as { points: [number, number][] }).points;
}

export async function refreshLiveGrid(db: DB, triggeredBy: string, client = openMeteoFromEnv({ batchSize: 100 })): Promise<JobResult> {
  const runId = await startRun(db, SOURCE_KEYS.openMeteoForecast, 'grid', triggeredBy);
  try {
    const pts = gridPoints();
    if (!pts.length) throw new Error('Grid definition missing (snapshot not present)');
    const series = await client.forecast(pts.map(([lat, lon]) => ({ key: `${lat},${lon}`, lat, lon })), 8);
    const src = await source(db, SOURCE_KEYS.openMeteoForecast);
    const today = todayIST();
    const rows = series.flatMap((s) => {
      const [lat, lon] = s.key.split(',').map(Number);
      return s.days
        .filter((d) => d.tmaxC != null && d.day > today)
        .map((d) => ({ lat, lon, day: d.day, dataKind: 'nwp_forecast' as const, sourceId: src, tmaxC: d.tmaxC as number, ingestionRunId: runId }));
    });
    for (let i = 0; i < rows.length; i += 1000) {
      await db
        .insert(gridDaily)
        .values(rows.slice(i, i + 1000))
        .onConflictDoUpdate({ target: [gridDaily.lat, gridDaily.lon, gridDaily.day, gridDaily.dataKind], set: { tmaxC: sql`excluded.tmax_c`, ingestionRunId: runId } });
    }
    // Drop stale NWP grid days (kept data is either future guidance or reanalysis).
    await db.delete(gridDaily).where(and(eq(gridDaily.dataKind, 'nwp_forecast'), lt(gridDaily.day, addDays(today, -14))));
    await finishRun(db, runId, { status: 'succeeded', recordsIn: series.length, recordsWritten: rows.length, meta: { requests: client.requests } });
    return { job: 'grid', status: 'succeeded', written: rows.length };
  } catch (e) {
    const msg = (e as Error).message;
    await finishRun(db, runId, { status: 'failed', error: msg.slice(0, 500) });
    return { job: 'grid', status: 'failed', written: 0, error: msg };
  }
}

/** Retention: prune old read notifications and superseded live forecast runs (keeps the latest per day). */
export async function applyRetention(db: DB) {
  const notifCutoff = new Date(Date.now() - 30 * 86_400_000);
  const delNotifs = await db
    .delete(notifications)
    .where(and(sql`${notifications.readAt} is not null`, lt(notifications.createdAt, notifCutoff)))
    .returning({ id: notifications.id });
  const runCutoff = addDays(todayIST(), -400);
  const delRuns = await db.delete(forecastRuns).where(and(eq(forecastRuns.scenario, 'live'), lt(forecastRuns.issuedFor, runCutoff))).returning({ id: forecastRuns.id });
  return { notifications: delNotifs.length, forecastRuns: delRuns.length };
}

export async function refreshAll(db: DB, triggeredBy: string): Promise<{ jobs: JobResult[]; forecast: RunResult; retention: Awaited<ReturnType<typeof applyRetention>> }> {
  const jobs = [await refreshRecentHistory(db, triggeredBy), await refreshLiveGrid(db, triggeredBy)];
  const forecast = await runForecast(db, { scenario: 'live', triggeredBy });
  const retention = await applyRetention(db);
  return { jobs, forecast, retention };
}
