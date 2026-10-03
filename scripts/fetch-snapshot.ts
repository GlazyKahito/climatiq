/**
 * Fetches the REAL historical climate snapshot shipped with CLIMATIQ (ERA5 reanalysis via Open-Meteo, CC BY 4.0).
 * One-time developer task — results are committed so that demo seeding is fast and works offline.
 *
 *   node --import tsx scripts/fetch-snapshot.ts
 *
 * Budget-aware: requests are paced under the free tier (600 weighted calls/min, 5,000/h) and every response is
 * cached in .data/snapshot-cache so an interrupted run resumes without re-spending quota.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { feature, merge } from 'topojson-client';
import { geoContains } from 'd3-geo';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { OpenMeteoClient, estimateCalls, type DailySeries, type DailyVar, type Point } from '../src/server/ingestion/adapters/open-meteo';

const CACHE = '.data/snapshot-cache';
const OUT = 'src/server/db/seed/data/snapshot';
const PER_MINUTE_BUDGET = 480; // stay well under 600/min
const geo = JSON.parse(readFileSync('src/server/db/seed/data/geography.json', 'utf8')) as {
  regions: { code: string; level: string; lat: number; lon: number }[];
};

const TWO: DailyVar[] = ['temperature_2m_max', 'temperature_2m_min'];
const SIX: DailyVar[] = [
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'relative_humidity_2m_mean',
  'wind_speed_10m_max',
  'shortwave_radiation_sum',
];
const ONE: DailyVar[] = ['temperature_2m_max'];

const client = new OpenMeteoClient({ batchSize: 40, timeoutMs: 90_000, onRequest: (i) => process.stdout.write(`    ↳ HTTP ${i.status ?? '—'} (attempt ${i.attempt})\n`) });

let spentThisMinute = 0;
let minuteStart = Date.now();
let totalSpent = 0;

async function pace(cost: number) {
  if (Date.now() - minuteStart > 61_000) {
    spentThisMinute = 0;
    minuteStart = Date.now();
  }
  if (spentThisMinute + cost > PER_MINUTE_BUDGET) {
    const wait = 61_000 - (Date.now() - minuteStart);
    console.log(`    … pacing ${Math.ceil(wait / 1000)} s (free-tier minute budget)`);
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    spentThisMinute = 0;
    minuteStart = Date.now();
  }
  spentThisMinute += cost;
  totalSpent += cost;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

/** Archive fetch for points, chunked so each request stays within the minute budget; cached per chunk. */
async function archive(label: string, points: Point[], start: string, end: string, vars: DailyVar[]): Promise<DailySeries[]> {
  const perLoc = estimateCalls(1, vars.length, daysBetween(start, end));
  const chunkSize = Math.max(1, Math.min(40, Math.floor(PER_MINUTE_BUDGET / perLoc)));
  const out: DailySeries[] = [];
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    const key = createHash('sha1').update(JSON.stringify([chunk.map((c) => c.key), start, end, vars])).digest('hex').slice(0, 16);
    const file = `${CACHE}/${key}.json`;
    if (existsSync(file)) {
      out.push(...(JSON.parse(readFileSync(file, 'utf8')) as DailySeries[]));
      continue;
    }
    const cost = perLoc * chunk.length;
    await pace(cost);
    console.log(`  ${label}: ${i + chunk.length}/${points.length} locations (${start}→${end}, ~${cost.toFixed(0)} calls)`);
    const series = await client.archive(chunk, start, end, { model: 'era5', variables: vars });
    writeFileSync(file, JSON.stringify(series));
    out.push(...series);
  }
  return out;
}

function indiaGrid(step = 1): Point[] {
  const topo = JSON.parse(readFileSync('public/geo/india-states.topo.json', 'utf8')) as Topology<{ states: GeometryCollection }>;
  const india = merge(topo, topo.objects.states.geometries as never);
  const ok = geoContains(india, [77.2, 28.6]);
  const shape = ok ? india : ({ ...india, coordinates: india.coordinates.map((p) => p.map((r) => [...r].reverse())) } as typeof india);
  if (!geoContains(shape, [77.2, 28.6]) || geoContains(shape, [0, 0])) throw new Error('India outline orientation check failed');
  void feature;
  const pts: Point[] = [];
  for (let lat = 6.5; lat <= 37.5; lat += step) {
    for (let lon = 68.5; lon <= 97.5; lon += step) {
      if (geoContains(shape, [lon, lat])) pts.push({ key: `${lat.toFixed(2)},${lon.toFixed(2)}`, lat, lon });
    }
  }
  return pts;
}

type Row = (number | null)[];
type Compact = Record<string, Record<string, Row>>; // key → day → [tmax, tmin, apparentTmax, rh, wind, rad]

function absorb(target: Compact, series: DailySeries[]) {
  for (const s of series) {
    const m = (target[s.key] ??= {});
    for (const d of s.days) {
      if (d.tmaxC == null) continue;
      const prev = m[d.day] ?? [null, null, null, null, null, null];
      m[d.day] = [
        d.tmaxC ?? prev[0],
        d.tminC ?? prev[1],
        (d as { apparentTmaxC?: number | null }).apparentTmaxC ?? prev[2],
        d.rhMeanPct ?? prev[3],
        d.windMaxKmh ?? prev[4],
        d.radiationMj ?? prev[5],
      ];
    }
  }
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const states: Point[] = geo.regions.filter((r) => r.level === 'state').map((r) => ({ key: r.code, lat: r.lat, lon: r.lon }));
  const districts: Point[] = geo.regions.filter((r) => r.level === 'district').map((r) => ({ key: r.code, lat: r.lat, lon: r.lon }));
  const grid = indiaGrid(1);
  console.log(`Points: ${states.length} states, ${districts.length} districts, ${grid.length} grid cells`);

  const regionData: Compact = {};
  // 1. States: continuous 5-year history (analytics + live normals)
  absorb(regionData, await archive('states 5y', states, '2021-10-01', '2026-09-27', TWO));
  // 2. Spring windows 2019–2025 for states + districts (replay normals = 2019–2023; 2024 = replay; 2025 = recent season)
  for (const y of [2019, 2020, 2021, 2022, 2023, 2025]) {
    absorb(regionData, await archive(`spring ${y} districts`, districts, `${y}-04-20`, `${y}-06-30`, TWO));
    if (y < 2021) absorb(regionData, await archive(`spring ${y} states`, states, `${y}-04-20`, `${y}-06-30`, TWO));
  }
  absorb(regionData, await archive('spring 2024 detail', [...districts, ...states], '2024-04-20', '2024-06-30', SIX));
  // 3. Autumn windows 2022–2025 for districts (live-scenario normals) + recent 2026 history
  for (const y of [2022, 2023, 2024, 2025]) absorb(regionData, await archive(`autumn ${y} districts`, districts, `${y}-09-01`, `${y}-11-15`, TWO));
  absorb(regionData, await archive('recent 2026 districts', districts, '2026-08-01', '2026-09-27', TWO));
  // 4. 1° India grid for the replay heat layer
  const gridData: Compact = {};
  absorb(gridData, await archive('grid replay', grid, '2024-05-15', '2024-06-05', ONE));

  const meta = {
    source: 'Open-Meteo Historical Weather API (archive-api.open-meteo.com)',
    model: 'ERA5 reanalysis (models=era5)',
    license: 'CC BY 4.0 — Weather data by Open-Meteo.com; contains modified Copernicus Climate Change Service information',
    retrievedAt: new Date().toISOString(),
    dataKind: 'reanalysis',
    columns: ['tmax_c', 'tmin_c', 'apparent_tmax_c', 'rh_mean_pct', 'wind_max_kmh', 'radiation_mj'],
    note: 'ERA5 is a gridded reanalysis (model reconstruction of past weather), not station observations. Values are for the grid cell nearest each region inner point.',
    estimatedWeightedCalls: Math.round(totalSpent),
  };
  writeFileSync(`${OUT}/regions-era5.json.gz`, gzipSync(JSON.stringify({ meta, data: regionData })));
  writeFileSync(`${OUT}/grid-replay-era5.json.gz`, gzipSync(JSON.stringify({ meta: { ...meta, columns: ['tmax_c'] }, points: grid.map((g) => [g.lat, g.lon]), data: gridData })));
  console.log(`✓ Snapshot written (≈${Math.round(totalSpent)} weighted Open-Meteo calls this run)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
