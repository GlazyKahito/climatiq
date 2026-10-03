import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { climateNormals, dailyClimate, dataSources, forecastRuns, forecasts, forecastVerifications, ingestionRuns, regions } from '@/server/db/schema';
import { seedReference, SOURCE_KEYS } from '@/server/db/seed/reference';
import { seedGeography } from '@/server/db/seed/geography';
import { runForecast } from '@/server/forecasting/run';
import { OpenMeteoClient } from '@/server/ingestion/adapters/open-meteo';
import { addDays, todayIST } from '@/lib/domain';

let db: DB;
let close: () => Promise<void>;
let churu: number;

async function src(key: string) {
  const [s] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, key));
  if (s) return s.id;
  const [n] = await db.insert(dataSources).values({ key, name: key, kind: 'external_api' }).returning({ id: dataSources.id });
  return n.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedReference(db);
  await seedGeography(db);
  [{ id: churu }] = await db.select({ id: regions.id }).from(regions).where(eq(regions.code, 'IN-RJ-CHURU'));
  const archive = await src(SOURCE_KEYS.openMeteoArchive);
  const prev = await src(SOURCE_KEYS.openMeteoPreviousRuns);
  const rows = [];
  for (let i = -9; i <= 7; i++) {
    const day = addDays('2024-05-26', i);
    rows.push({ regionId: churu, sourceId: archive, day, dataKind: 'reanalysis' as const, tmaxC: i <= 0 ? 46 : 47.5, tminC: 31 });
    if (i >= 1) rows.push({ regionId: churu, sourceId: prev, day, dataKind: 'nwp_forecast' as const, tmaxC: 47 });
  }
  await db.insert(dailyClimate).values(rows);
  const normals = [];
  for (let d = 1; d <= 366; d++) {
    normals.push({ regionId: churu, basisKey: 'era5-2019-2023', dayOfYear: d, normalTmaxC: 40, normalTminC: 27, basis: 'test', sampleYears: 5, dataKind: 'reanalysis' as const });
    normals.push({ regionId: churu, basisKey: 'era5-2021-2025', dayOfYear: d, normalTmaxC: 34, normalTminC: 22, basis: 'test', sampleYears: 5, dataKind: 'reanalysis' as const });
  }
  await db.insert(climateNormals).values(normals);
});
afterAll(async () => close());

describe('runForecast — replay hindcast', () => {
  it('uses only as-issued NWP + history, stores 7 days and verifies against reanalysis', async () => {
    const r = await runForecast(db, { scenario: 'replay', triggeredBy: 'test', skipAlerts: true });
    expect(r.status).toBe('partial'); // only Churu has inputs in this test database
    expect(r.regions).toBe(1);
    const [run] = await db.select().from(forecastRuns).where(eq(forecastRuns.id, r.runId));
    expect(run.isHindcast).toBe(true);
    expect(String(run.inputs.nwp)).toMatch(/as issued/i);
    const fc = await db.select().from(forecasts).where(eq(forecasts.runId, r.runId));
    expect(fc).toHaveLength(7);
    expect(fc.every((f) => f.inputKinds.includes('nwp_forecast'))).toBe(true);
    const day1 = fc.find((f) => f.horizonDay === 1)!;
    expect(day1.severity).toBe('extreme'); // ~47 °C vs 40 °C normal
    expect(day1.imdCategory).toBe('severe_heatwave');
    const ver = await db.select().from(forecastVerifications);
    expect(ver).toHaveLength(7);
    expect(ver.every((v) => v.observedKind === 'reanalysis')).toBe(true);
  });
});

describe('runForecast — live with NWP ingestion', () => {
  it('ingests NWP via the adapter and records an ingestion run', async () => {
    const today = todayIST();
    const days = Array.from({ length: 8 }, (_, i) => addDays(today, i - 3));
    const fetchImpl = async (url: string) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      const loc = { latitude: 28, longitude: 75, elevation: 250, daily: { time: days, temperature_2m_max: days.map(() => 36), temperature_2m_min: days.map(() => 22), relative_humidity_2m_mean: days.map(() => 25) } };
      return new Response(JSON.stringify(n === 1 ? loc : Array.from({ length: n }, () => loc)), { status: 200 });
    };
    // Live history for persistence (recent reanalysis)
    const archive = await src(SOURCE_KEYS.openMeteoArchive);
    await db.insert(dailyClimate).values([0, 1, 2].map((k) => ({ regionId: churu, sourceId: archive, day: addDays(today, -6 - k), dataKind: 'reanalysis' as const, tmaxC: 35, tminC: 22 }))).onConflictDoNothing();
    const r = await runForecast(db, { scenario: 'live', triggeredBy: 'test', skipAlerts: true, nwpClient: new OpenMeteoClient({ fetchImpl, sleep: async () => {} }) });
    expect(r.status === 'succeeded' || r.status === 'partial').toBe(true);
    expect(r.regions).toBeGreaterThan(200); // every state + district receives NWP guidance
    const nwpRows = await db
      .select()
      .from(dailyClimate)
      .where(and(eq(dailyClimate.regionId, churu), eq(dailyClimate.dataKind, 'nwp_forecast'), eq(dailyClimate.sourceId, await src(SOURCE_KEYS.openMeteoForecast))));
    expect(nwpRows.length).toBeGreaterThan(0);
    const ing = await db.select().from(ingestionRuns).where(eq(ingestionRuns.job, 'forecast'));
    expect(ing.some((i) => i.status === 'succeeded')).toBe(true);
  });

  it('records a failed run instead of inventing data when the API is down', async () => {
    const fetchImpl = async () => new Response('down', { status: 500 });
    const r = await runForecast(db, {
      scenario: 'live',
      triggeredBy: 'test',
      skipAlerts: true,
      nwpClient: new OpenMeteoClient({ fetchImpl, sleep: async () => {}, maxRetries: 1 }),
    });
    // Churu still has history → persistence-only forecasts; NWP status reports the failure.
    const [run] = await db.select().from(forecastRuns).where(eq(forecastRuns.id, r.runId));
    expect(String(run.inputs.nwp)).toMatch(/failed/);
    const fc = await db.select().from(forecasts).where(eq(forecasts.runId, r.runId));
    expect(fc.every((f) => !f.inputKinds.includes('nwp_forecast'))).toBe(true);
  });
});
