import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import {
  climateNormals,
  dailyClimate,
  dataSources,
  forecastRuns,
  forecasts,
  forecastVerifications,
  modelVersions,
  officialWarnings,
  regions,
} from '@/server/db/schema';
import { seedReference } from '@/server/db/seed/reference';
import { dayOfYear } from '@/server/forecasting/baseline';
import { addDays } from '@/lib/domain';
import { heatwaveFrequency, loadThresholds } from '@/server/analytics/heatwave';
import { accuracyReport, listRuns, modelVersionTable, riskDistributionByRun, verificationRows } from '@/server/analytics/accuracy';
import { climateCoverage, climateSeries, normalBases, pickBasis } from '@/server/analytics/history';
import {
  childrenSeverity,
  forecastTable,
  historicalComparison,
  latestRunDetail,
  officialWarningsFor,
  recentHistory,
  runDays,
  runExportRows,
  severityByDay,
  topRisks,
} from '@/server/analytics/forecast-views';

let db: DB;
let close: () => Promise<void>;
const ids = {} as Record<string, number>;
let runId = '';

async function region(code: string, name: string, level: 'country' | 'state' | 'district' | 'city', parent: string | null, zone: 'plains' | 'hilly' = 'plains') {
  const parentRow = parent ? (await db.select().from(regions).where(eq(regions.code, parent)))[0] : null;
  const [r] = await db
    .insert(regions)
    .values({ code, name, level, parentId: parentRow?.id ?? null, path: parentRow ? `${parentRow.path}/${code}` : code, lat: 26, lon: 75, climateZone: zone, isPilot: true, geoSource: 'test' })
    .returning();
  ids[code] = r.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedReference(db);
  await region('IN', 'India', 'country', null);
  await region('IN-RJ', 'Rajasthan', 'state', 'IN');
  await region('IN-HP', 'Himachal Pradesh', 'state', 'IN', 'hilly');
  await region('IN-RJ-CHURU', 'Churu', 'district', 'IN-RJ');
  await region('IN-RJ-CHURU-C-CHURU', 'Churu', 'city', 'IN-RJ-CHURU');

  const [archive] = await db.select().from(dataSources).where(eq(dataSources.key, 'open-meteo-archive'));
  const [sim] = await db.select().from(dataSources).where(eq(dataSources.key, 'climatiq-simulator'));

  // Reanalysis for Rajasthan: 2023-05-20..05-31 at 42 °C and 2024-05-20..05-31 ramping 42 → 47.5 °C.
  const climate = [] as (typeof dailyClimate.$inferInsert)[];
  for (let i = 0; i < 12; i++) {
    climate.push({ regionId: ids['IN-RJ'], sourceId: archive.id, day: addDays('2023-05-20', i), dataKind: 'reanalysis', tmaxC: 42, tminC: 28 });
    climate.push({ regionId: ids['IN-RJ'], sourceId: archive.id, day: addDays('2024-05-20', i), dataKind: 'reanalysis', tmaxC: 42 + i * 0.5, tminC: 29 });
  }
  // A simulated duplicate on one day must lose against the reanalysis row.
  climate.push({ regionId: ids['IN-RJ'], sourceId: sim.id, day: '2024-05-25', dataKind: 'simulated', tmaxC: 10 });
  // NWP guidance stored in daily_climate is model input, never history.
  const [nwpSrc] = await db.select().from(dataSources).where(eq(dataSources.key, 'open-meteo-forecast'));
  climate.push({ regionId: ids['IN-RJ'], sourceId: nwpSrc.id, day: '2024-06-01', dataKind: 'nwp_forecast', tmaxC: 49 });
  climate.push({ regionId: ids['IN-RJ'], sourceId: nwpSrc.id, day: '2024-05-26', dataKind: 'nwp_forecast', tmaxC: 49 });
  await db.insert(dailyClimate).values(climate);

  // Two normal bases; the one covering more days must be picked for analytics.
  const normals = [] as (typeof climateNormals.$inferInsert)[];
  for (let d = 130; d <= 160; d++) normals.push({ regionId: ids['IN-RJ'], basisKey: 'era5-wide', dayOfYear: d, normalTmaxC: 40, basis: 'test wide', sampleYears: 3, dataKind: 'reanalysis' });
  for (let d = 140; d <= 145; d++) normals.push({ regionId: ids['IN-RJ'], basisKey: 'era5-narrow', dayOfYear: d, normalTmaxC: 30, basis: 'test narrow', sampleYears: 5, dataKind: 'reanalysis' });
  await db.insert(climateNormals).values(normals);

  // One replay hindcast run with 3 days for Rajasthan + Churu, all verified.
  const [model] = await db.select().from(modelVersions).where(eq(modelVersions.key, 'baseline-v1'));
  const [run] = await db
    .insert(forecastRuns)
    .values({ modelVersionId: model.id, scenario: 'replay', issuedFor: '2024-05-26', horizonDays: 3, status: 'succeeded', isHindcast: true, triggeredBy: 'seed', regionsCount: 2 })
    .returning();
  runId = run.id;
  const sev = ['high', 'extreme', 'moderate'] as const;
  const obsSev = ['high', 'high', 'low'] as const;
  for (const [code, offset] of [
    ['IN-RJ', 0],
    ['IN-RJ-CHURU', 1],
  ] as const) {
    for (let h = 1; h <= 3; h++) {
      const pred = 45 + offset + h;
      const [f] = await db
        .insert(forecasts)
        .values({
          runId,
          regionId: ids[code],
          targetDate: addDays('2024-05-26', h),
          horizonDay: h,
          resolution: code === 'IN-RJ' ? 'state-centroid' : 'district-centroid',
          predictedTmaxC: pred,
          lowerC: pred - 2,
          upperC: pred + 2,
          normalTmaxC: 40,
          departureC: pred - 40,
          severity: sev[h - 1],
          imdCategory: 'none',
          confidence: 'medium',
          confidenceScore: 0.5,
        })
        .returning();
      // observed = predicted − h  → error = +h (warm bias growing with horizon); day 3 falls outside the band.
      await db.insert(forecastVerifications).values({ forecastId: f.id, observedTmaxC: pred - h, observedKind: 'reanalysis', errorC: h, observedSeverity: obsSev[h - 1] });
    }
  }
});
afterAll(async () => close());

describe('history queries', () => {
  it('returns one row per region-day, preferring reanalysis over simulated', async () => {
    const rows = await climateSeries(db, [ids['IN-RJ']], '2024-05-24', '2024-05-26');
    expect(rows).toHaveLength(3);
    const d = rows.find((r) => r.day === '2024-05-25')!;
    expect(d.dataKind).toBe('reanalysis');
    expect(d.tmaxC).toBe(44.5);
    expect(d.sourceKey).toBe('open-meteo-archive');
  });

  it('never treats NWP guidance as history', async () => {
    expect(await climateSeries(db, [ids['IN-RJ']], '2024-06-01', '2024-06-02')).toEqual([]);
    const d = (await climateSeries(db, [ids['IN-RJ']], '2024-05-26', '2024-05-26'))[0];
    expect(d).toMatchObject({ dataKind: 'reanalysis', tmaxC: 45 });
  });

  it('reports coverage and empty coverage', async () => {
    const [rj, hp] = await climateCoverage(db, [ids['IN-RJ'], ids['IN-HP']]);
    expect(rj).toMatchObject({ firstDay: '2023-05-20', lastDay: '2024-05-31', days: 24 });
    expect(rj.kinds.sort()).toEqual(['reanalysis', 'simulated']);
    expect(hp).toMatchObject({ days: 0, firstDay: null });
  });

  it('picks the reference basis with the widest day-of-year coverage', async () => {
    const b = pickBasis(await normalBases(db, [ids['IN-RJ']]));
    expect(b?.basisKey).toBe('era5-wide');
  });

  it('builds the same-window comparison across years', async () => {
    const ys = await historicalComparison(db, ids['IN-RJ'], '2024-05-20', '2024-05-31');
    expect(ys.map((y) => y.year)).toEqual([2023, 2024]);
    expect(ys[0]).toMatchObject({ mean: 42, max: 42, days: 12 });
    expect(ys[1].values['05-31']).toBe(47.5);
  });

  it('returns the recent history window ending on the issue date', async () => {
    const h = await recentHistory(db, ids['IN-RJ'], '2024-05-26', 14);
    expect(h.at(-1)?.day).toBe('2024-05-26');
    expect(h[0].day).toBe('2024-05-20');
  });
});

describe('heatwave frequency', () => {
  it('counts High/Extreme days per year with classify() against the chosen basis', async () => {
    const thresholds = await loadThresholds(db);
    expect(thresholds.plains.find((t) => t.level === 'high')?.minDepartureC).toBe(4.5);
    const [rj] = await heatwaveFrequency(db, [ids['IN-RJ']]);
    expect(rj.basisKey).toBe('era5-wide');
    // 2023: 42 °C vs normal 40 → +2 → low on all days.
    expect(rj.years.find((y) => y.year === 2023)).toMatchObject({ daysEvaluated: 12, heatwaveDays: 0 });
    // 2024: 42 + 0.5·i; ≥ 44.5 (dep ≥ 4.5) → high, ≥ 46.5 (dep ≥ 6.5) → extreme. i = 5..8 high, 9..11 extreme.
    const y24 = rj.years.find((y) => y.year === 2024)!;
    expect(y24).toMatchObject({ high: 4, extreme: 3, heatwaveDays: 7, maxTmaxC: 47.5 });
    expect(y24.moderate).toBe(4); // 43 … 44 (dep 2.5–4.4)
    expect(rj.totalHeatwaveDays).toBe(7);
  });

  it('honours a preferred basis key', async () => {
    const [rj] = await heatwaveFrequency(db, [ids['IN-RJ']], { basisKey: 'era5-narrow' });
    expect(rj.basisKey).toBe('era5-narrow');
    // narrow basis only covers doy 140–145 → fewer evaluated days
    expect(rj.daysEvaluated).toBeLessThan(24);
  });

  it('returns no years for regions without normals', async () => {
    const [hp] = await heatwaveFrequency(db, [ids['IN-HP']]);
    expect(hp.basisKey).toBeNull();
    expect(hp.years).toEqual([]);
  });
});

describe('accuracy & runs', () => {
  it('joins verifications with forecasts and runs', async () => {
    const rows = await verificationRows(db, { runIds: [runId] });
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ scenario: 'replay', isHindcast: true, modelKey: 'baseline-v1', observedKind: 'reanalysis' });
  });

  it('computes MAE/RMSE/bias by horizon, band coverage and the confusion matrix', async () => {
    const r = await accuracyReport(db, { runIds: [runId] });
    expect(r.overall).toMatchObject({ n: 6, mae: 2, bias: 2 });
    expect(r.byHorizon.map((h) => [h.horizonDay, h.n, h.mae])).toEqual([
      [1, 2, 1],
      [2, 2, 2],
      [3, 2, 3],
    ]);
    expect(r.bandCoverage).toEqual({ inside: 4, n: 6, rate: 0.667 });
    expect(r.confusion.event).toMatchObject({ hits: 4, misses: 0, falseAlarms: 0, correctNegatives: 2 });
    expect(r.confusion.matrix[1][0]).toBe(2); // predicted moderate, observed low
    expect(r.regions).toBe(2);
    expect(r.observedKinds).toEqual(['reanalysis']);
  });

  it('filters by level', async () => {
    const r = await accuracyReport(db, { runIds: [runId], level: 'district' });
    expect(r.overall?.n).toBe(3);
  });

  it('lists runs with forecast/verification counts and model versions', async () => {
    const [run] = await listRuns(db);
    expect(run).toMatchObject({ id: runId, forecastCount: 6, verifiedCount: 6, modelKey: 'baseline-v1' });
    const [m] = await modelVersionTable(db);
    expect(m).toMatchObject({ key: 'baseline-v1', runs: 1, verified: 6 });
  });

  it('summarises peak severity per region for each run', async () => {
    const [r] = await riskDistributionByRun(db);
    expect(r.states).toEqual({ low: 0, moderate: 0, high: 0, extreme: 1 });
    expect(r.districts).toEqual({ low: 0, moderate: 0, high: 0, extreme: 1 });
  });
});

describe('forecast views', () => {
  it('finds the latest replay run and its days', async () => {
    const run = await latestRunDetail(db, 'replay');
    expect(run).toMatchObject({ id: runId, modelKey: 'baseline-v1', isHindcast: true, status: 'succeeded' });
    expect(await latestRunDetail(db, 'live')).toBeNull();
    expect(await runDays(db, runId)).toEqual(['2024-05-27', '2024-05-28', '2024-05-29']);
  });

  it('counts severity per day by level', async () => {
    const s = await severityByDay(db, runId, 'state');
    expect(s.map((d) => [d.day, d.high, d.extreme, d.moderate])).toEqual([
      ['2024-05-27', 1, 0, 0],
      ['2024-05-28', 0, 1, 0],
      ['2024-05-29', 0, 0, 1],
    ]);
  });

  it('builds the regions table with state names and peak severity', async () => {
    const rows = await forecastTable(db, runId, '2024-05-27');
    expect(rows).toHaveLength(2);
    const churu = rows.find((r) => r.code === 'IN-RJ-CHURU')!;
    expect(churu).toMatchObject({ stateCode: 'IN-RJ', stateName: 'Rajasthan', severity: 'high', peakSeverity: 'extreme' });
    expect(topRisks(rows, 1)[0].code).toBe('IN-RJ-CHURU');
  });

  it('lists children with peak severity chips', async () => {
    const kids = await childrenSeverity(db, runId, ids['IN-RJ']);
    expect(kids).toEqual([expect.objectContaining({ code: 'IN-RJ-CHURU', hasForecast: true, peakSeverity: 'extreme', day1Severity: 'high' })]);
    const none = await childrenSeverity(db, null, ids['IN-RJ']);
    expect(none[0]).toMatchObject({ hasForecast: false, peakSeverity: null });
  });

  it('exports every forecast row of a run', async () => {
    const rows = await runExportRows(db, runId);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ code: 'IN-RJ', level: 'state', parentCode: 'IN' });
  });

  it('returns official warnings only when present', async () => {
    expect(await officialWarningsFor(db, [ids['IN-RJ']])).toEqual([]);
    const [imd] = await db.select().from(dataSources).where(eq(dataSources.key, 'imd'));
    await db.insert(officialWarnings).values({
      sourceId: imd.id,
      regionId: ids['IN-RJ'],
      colorCode: 'red',
      title: 'Test warning',
      issuedAt: new Date('2024-05-26T06:00:00Z'),
      validFrom: new Date('2024-05-26T06:00:00Z'),
      validTo: new Date('2024-05-28T06:00:00Z'),
      url: 'https://mausam.imd.gov.in/',
      retrievedAt: new Date('2024-05-26T07:00:00Z'),
    });
    expect(await officialWarningsFor(db, [ids['IN-RJ']], { from: '2024-05-27', to: '2024-05-29' })).toHaveLength(1);
    expect(await officialWarningsFor(db, [ids['IN-RJ']], { from: '2024-06-10', to: '2024-06-12' })).toHaveLength(0);
  });

  it('day-of-year helper agrees with normals keys used in tests', () => {
    expect(dayOfYear('2024-05-26')).toBe(147);
  });
});
