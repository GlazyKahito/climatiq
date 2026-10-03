/**
 * Imports the committed REAL climate snapshot (ERA5 reanalysis via Open-Meteo, CC BY 4.0) into daily_climate,
 * derives reference normals for each scenario basis and loads the replay heat grid.
 * If the snapshot is missing, nothing is fabricated: the step records that history is unavailable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { eq, inArray } from 'drizzle-orm';
import type { DB } from '../types';
import { climateNormals, dailyClimate, dataSources, gridDaily, ingestionRuns, regions } from '../schema';
import { DATA_SOURCES, SOURCE_KEYS } from './reference';
import { buildNormals, type DayInput } from '../../forecasting/baseline';
import { NORMAL_BASIS } from '../../forecasting/run';

const DIR = join(process.cwd(), 'src/server/db/seed/data/snapshot');

type Snapshot = { meta: Record<string, unknown>; data: Record<string, Record<string, (number | null)[]>> };
type GridSnapshot = Snapshot & { points: [number, number][] };

function read<T>(file: string): T | null {
  const p = join(DIR, file);
  if (!existsSync(p)) return null;
  return JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as T;
}

export async function seedHistory(db: DB, log: (m: string) => void = () => {}) {
  const snap = read<Snapshot>('regions-era5.json.gz');
  if (!snap) {
    log('No climate snapshot found — skipping history (run scripts/fetch-snapshot.ts). No data will be invented.');
    return { incomplete: true, reason: 'snapshot missing' };
  }
  const [src] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, SOURCE_KEYS.openMeteoArchive));
  const [ing] = await db
    .insert(ingestionRuns)
    .values({ sourceId: src.id, job: 'archive', triggeredBy: 'seed:snapshot', meta: { snapshot: snap.meta } })
    .returning({ id: ingestionRuns.id });

  const codes = Object.keys(snap.data);
  const regionRows = await db.select({ id: regions.id, code: regions.code }).from(regions).where(inArray(regions.code, codes));
  const idOf = new Map(regionRows.map((r) => [r.code, r.id]));

  let written = 0;
  let buffer: (typeof dailyClimate.$inferInsert)[] = [];
  const flush = async () => {
    if (!buffer.length) return;
    await db.insert(dailyClimate).values(buffer).onConflictDoNothing();
    written += buffer.length;
    buffer = [];
  };
  const normalsRows: (typeof climateNormals.$inferInsert)[] = [];

  for (const code of codes) {
    const regionId = idOf.get(code);
    if (!regionId) continue;
    const days = snap.data[code];
    const series: DayInput[] = [];
    for (const [day, v] of Object.entries(days)) {
      if (v[0] == null) continue;
      series.push({ day, tmaxC: v[0], tminC: v[1] });
      buffer.push({
        regionId,
        sourceId: src.id,
        day,
        dataKind: 'reanalysis',
        tmaxC: v[0],
        tminC: v[1],
        apparentTmaxC: v[2],
        rhMeanPct: v[3],
        windMaxKmh: v[4],
        radiationMj: v[5],
        ingestionRunId: ing.id,
      });
      if (buffer.length >= 1000) await flush();
    }
    for (const basis of Object.values(NORMAL_BASIS)) {
      const subset = series.filter((s) => basis.years.includes(Number(s.day.slice(0, 4))));
      const years = new Set(subset.map((s) => s.day.slice(0, 4))).size;
      if (!subset.length) continue;
      for (const [doy, n] of buildNormals(subset, 7)) {
        normalsRows.push({
          regionId,
          basisKey: basis.key,
          dayOfYear: doy,
          normalTmaxC: Math.round(n.tmax * 100) / 100,
          normalTminC: n.tmin == null ? null : Math.round(n.tmin * 100) / 100,
          basis: basis.label,
          sampleYears: years,
          dataKind: 'reanalysis',
        });
      }
    }
  }
  await flush();
  for (let i = 0; i < normalsRows.length; i += 1000) await db.insert(climateNormals).values(normalsRows.slice(i, i + 1000)).onConflictDoNothing();

  // Replay heat grid
  const grid = read<GridSnapshot>('grid-replay-era5.json.gz');
  let gridRows = 0;
  if (grid) {
    const rows: (typeof gridDaily.$inferInsert)[] = [];
    for (const [key, days] of Object.entries(grid.data)) {
      const [lat, lon] = key.split(',').map(Number);
      for (const [day, v] of Object.entries(days)) {
        if (v[0] == null) continue;
        rows.push({ lat, lon, day, dataKind: 'reanalysis', sourceId: src.id, tmaxC: v[0], ingestionRunId: ing.id });
      }
    }
    for (let i = 0; i < rows.length; i += 1000) await db.insert(gridDaily).values(rows.slice(i, i + 1000)).onConflictDoNothing();
    gridRows = rows.length;
  }

  const nwpRows = await importReplayNwp(db, idOf);

  await db
    .update(ingestionRuns)
    .set({ status: 'succeeded', finishedAt: new Date(), recordsIn: codes.length, recordsWritten: written + gridRows + nwpRows })
    .where(eq(ingestionRuns.id, ing.id));
  log(`Imported ${written} daily records, ${normalsRows.length} normals, ${gridRows} grid values (ERA5 snapshot retrieved ${String(snap.meta.retrievedAt)})`);
  return { daily: written, normals: normalsRows.length, grid: gridRows, replayNwp: nwpRows, retrievedAt: snap.meta.retrievedAt };
}

/** NWP guidance as issued before the replay date (Open-Meteo Previous Runs API) → daily_climate (nwp_forecast). */
export async function importReplayNwp(db: DB, idOf?: Map<string, number>) {
  const snap = read<{ meta: Record<string, unknown>; data: Record<string, Record<string, number>> }>('replay-nwp-previous-runs.json.gz');
  if (!snap) return 0;
  const [first] = DATA_SOURCES.filter((d) => d.key === SOURCE_KEYS.openMeteoPreviousRuns);
  await db.insert(dataSources).values(first).onConflictDoNothing();
  const [src] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, SOURCE_KEYS.openMeteoPreviousRuns));
  if (!idOf) {
    const rows = await db.select({ id: regions.id, code: regions.code }).from(regions).where(inArray(regions.code, Object.keys(snap.data)));
    idOf = new Map(rows.map((r) => [r.code, r.id]));
  }
  const [ing] = await db
    .insert(ingestionRuns)
    .values({ sourceId: src.id, job: 'forecast', triggeredBy: 'seed:snapshot', meta: { snapshot: snap.meta } })
    .returning({ id: ingestionRuns.id });
  const rows: (typeof dailyClimate.$inferInsert)[] = [];
  for (const [code, days] of Object.entries(snap.data)) {
    const regionId = idOf.get(code);
    if (!regionId) continue;
    for (const [day, tmax] of Object.entries(days)) rows.push({ regionId, sourceId: src.id, day, dataKind: 'nwp_forecast', tmaxC: tmax, ingestionRunId: ing.id });
  }
  for (let i = 0; i < rows.length; i += 1000) await db.insert(dailyClimate).values(rows.slice(i, i + 1000)).onConflictDoNothing();
  await db.update(ingestionRuns).set({ status: 'succeeded', finishedAt: new Date(), recordsIn: Object.keys(snap.data).length, recordsWritten: rows.length }).where(eq(ingestionRuns.id, ing.id));
  return rows.length;
}
