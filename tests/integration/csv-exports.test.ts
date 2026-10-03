import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { dailyClimate, dataSources, forecastRuns, forecasts, forecastVerifications, modelVersions, regions } from '@/server/db/schema';
import { seedReference } from '@/server/db/seed/reference';
import { FORECAST_COLUMNS, forecastsCsv, HISTORY_COLUMNS, historyCsv, VERIFICATION_COLUMNS, verificationCsv } from '@/server/analytics/exports';
import { getRegionByCode } from '@/server/geo/regions';

let db: DB;
let close: () => Promise<void>;
let runId = '';
const NOW = new Date('2026-10-03T06:00:00Z');

/** Minimal RFC 4180 parser for assertions. */
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === CR && text[i + 1] === LF) {
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
      i++;
    } else f += c;
  }
  return rows;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedReference(db);
  const ins = async (code: string, name: string, level: 'country' | 'state' | 'district', parent: string | null) => {
    const p = parent ? await getRegionByCode(db, parent) : null;
    await db.insert(regions).values({ code, name, level, parentId: p?.id ?? null, path: p ? `${p.path}/${code}` : code, lat: 27, lon: 74, geoSource: 'test' });
  };
  await ins('IN', 'India', 'country', null);
  await ins('IN-RJ', 'Rajasthan', 'state', 'IN');
  await ins('IN-UP', 'Uttar Pradesh', 'state', 'IN');
  await ins('IN-RJ-CHURU', 'Churu, "Thar gateway"', 'district', 'IN-RJ');
  const [model] = await db.select().from(modelVersions).where(eq(modelVersions.key, 'baseline-v1'));
  const [run] = await db
    .insert(forecastRuns)
    .values({
      modelVersionId: model.id,
      scenario: 'replay',
      issuedFor: '2024-05-26',
      horizonDays: 1,
      status: 'succeeded',
      isHindcast: true,
      triggeredBy: 'seed',
      inputs: { normals: 'ERA5 2019–2023 mean (±7-day window)' },
      params: { normalsBasis: 'era5-2019-2023' },
    })
    .returning();
  runId = run.id;
  for (const code of ['IN-RJ', 'IN-UP', 'IN-RJ-CHURU']) {
    const r = (await getRegionByCode(db, code))!;
    const [f] = await db
      .insert(forecasts)
      .values({
        runId,
        regionId: r.id,
        targetDate: '2024-05-27',
        horizonDay: 1,
        resolution: 'centroid',
        predictedTmaxC: 46.2,
        lowerC: 44,
        upperC: 48.4,
        normalTmaxC: 40.1,
        departureC: 6.1,
        severity: 'high',
        imdCategory: 'heatwave',
        confidence: 'medium',
        confidenceScore: 0.55,
        inputKinds: ['reanalysis', 'climatology'],
      })
      .returning();
    await db.insert(forecastVerifications).values({ forecastId: f.id, observedTmaxC: 47.3, observedKind: 'reanalysis', errorC: -1.1, observedSeverity: 'extreme' });
  }
  const [archive] = await db.select().from(dataSources).where(eq(dataSources.key, 'open-meteo-archive'));
  const [nwp] = await db.select().from(dataSources).where(eq(dataSources.key, 'open-meteo-forecast'));
  const churu = (await getRegionByCode(db, 'IN-RJ-CHURU'))!;
  await db.insert(dailyClimate).values([
    { regionId: churu.id, sourceId: archive.id, day: '2024-05-26', dataKind: 'reanalysis', tmaxC: 47.9, tminC: 31.2, rhMeanPct: 18 },
    { regionId: churu.id, sourceId: archive.id, day: '2024-05-27', dataKind: 'reanalysis', tmaxC: 48.5, tminC: null },
    { regionId: churu.id, sourceId: nwp.id, day: '2024-05-28', dataKind: 'nwp_forecast', tmaxC: 49 },
  ]);
});
afterAll(async () => close());

describe('forecasts.csv', () => {
  it('writes one row per forecast with units, provenance, ISO timestamps and RFC 4180 quoting', async () => {
    const file = (await forecastsCsv(db, runId, [null], NOW))!;
    expect(file.filename).toMatch(/^climatiq_forecasts_replay_2024-05-26_[0-9a-f]{8}\.csv$/);
    expect(file.body.endsWith('\r\n')).toBe(true);
    const rows = parse(file.body);
    expect(rows[0]).toEqual(FORECAST_COLUMNS);
    expect(rows).toHaveLength(4);
    const col = (name: string) => FORECAST_COLUMNS.indexOf(name);
    const churu = rows.find((r) => r[col('region_code')] === 'IN-RJ-CHURU')!;
    expect(churu[col('region_name')]).toBe('Churu, "Thar gateway"');
    expect(file.body).toContain('"Churu, ""Thar gateway"""');
    expect(churu[col('predicted_tmax_c')]).toBe('46.2');
    expect(churu[col('data_kind')]).toBe('model_forecast');
    expect(churu[col('official')]).toBe('false');
    expect(churu[col('normal_basis')]).toBe('ERA5 2019–2023 mean (±7-day window)');
    expect(churu[col('input_kinds')]).toBe('reanalysis|climatology');
    expect(churu[col('exported_at')]).toBe('2026-10-03T06:00:00.000Z');
    expect(churu[col('run_generated_at')]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(FORECAST_COLUMNS.filter((c) => c.endsWith('_c'))).toContain('predicted_tmax_c');
  });

  it('limits rows to the caller’s geographic scope', async () => {
    const file = (await forecastsCsv(db, runId, ['IN/IN-RJ'], NOW))!;
    const codes = parse(file.body).slice(1).map((r) => r[FORECAST_COLUMNS.indexOf('region_code')]);
    expect(codes.sort()).toEqual(['IN-RJ', 'IN-RJ-CHURU']);
  });

  it('returns null for an unknown run', async () => {
    expect(await forecastsCsv(db, '00000000-0000-4000-8000-000000000000', [null])).toBeNull();
  });
});

describe('verification.csv', () => {
  it('pairs predictions with reanalysis truth and derived columns', async () => {
    const file = (await verificationCsv(db, runId, [null], NOW))!;
    const rows = parse(file.body);
    expect(rows[0]).toEqual(VERIFICATION_COLUMNS);
    const col = (name: string) => VERIFICATION_COLUMNS.indexOf(name);
    const r = rows[1];
    expect(r[col('observed_kind')]).toBe('reanalysis');
    expect(r[col('error_c')]).toBe('-1.1'); // negative numbers stay numeric (no formula-guard prefix)
    expect(r[col('abs_error_c')]).toBe('1.1');
    expect(r[col('within_band')]).toBe('true');
    expect(r[col('severity_exact_match')]).toBe('false');
    expect(r[col('truth_source')]).toMatch(/not station observations/);
  });
});

describe('history.csv', () => {
  it('exports observed/reanalysis days only (never NWP guidance) with empty cells for missing values', async () => {
    const churu = (await getRegionByCode(db, 'IN-RJ-CHURU'))!;
    const file = await historyCsv(db, churu, '2024-05-01', '2024-05-31', NOW);
    expect(file.filename).toBe('climatiq_history_IN-RJ-CHURU_2024-05-01_2024-05-31.csv');
    const rows = parse(file.body);
    expect(rows[0]).toEqual(HISTORY_COLUMNS);
    expect(rows).toHaveLength(3);
    const col = (name: string) => HISTORY_COLUMNS.indexOf(name);
    expect(rows.slice(1).map((r) => r[col('day')])).toEqual(['2024-05-26', '2024-05-27']);
    expect(rows[2][col('tmin_c')]).toBe('');
    expect(rows[1][col('data_kind')]).toBe('reanalysis');
    expect(rows[1][col('source')]).toMatch(/ERA5/);
    const all = await historyCsv(db, churu, '2024-05-01', '2024-06-30', NOW);
    expect(all.rows).toBe(2);
  });
});
