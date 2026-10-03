/**
 * Fetches the REAL global context layer for the landing globe: ERA5 daily maximum 2 m temperature on the replay day,
 * on a 2.5° grid over land (60°S–84°N), via the Open-Meteo Historical Weather API (CC BY 4.0). One-time developer
 * task — the result is committed to public/data so the globe never calls the API at runtime.
 *
 *   node --import tsx scripts/fetch-global-heat.ts
 *
 * Each location's daily maximum uses its own local day (timezone=auto), so the afternoon peak is captured everywhere.
 * Requests are paced under the free tier (~480 weighted calls/min) and cached in .data/global-heat-cache, so an
 * interrupted run resumes without re-spending quota.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { geoContains, type GeoPermissibleObjects } from 'd3-geo';
import type { GeometryCollection, Topology } from 'topojson-specification';

const DAY = '2024-05-26'; // must match public/data/heat-grid-replay.json
const RES = 2.5;
const MIN_LAT = -60; // Antarctica adds ~1,500 cells and no heat story
const BATCH = 100;
const PER_MINUTE_BUDGET = 480; // 1 day × 1 variable ≈ 1 weighted call per location; stay under 600/min
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const CACHE = '.data/global-heat-cache';
const OUT = 'public/data/heat-grid-global.json';

type Cell = { lat: number; lon: number };

const topo = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8')) as Topology<{ land: GeometryCollection }>;
const land = feature(topo, topo.objects.land) as GeoPermissibleObjects;

/** A cell counts as land if any of 3×3 samples inside it is on land, so islands and coasts are not dropped. */
function cells(): Cell[] {
  const out: Cell[] = [];
  for (let lat = MIN_LAT + RES / 2; lat < 85; lat += RES) {
    for (let lon = -180 + RES / 2; lon < 180; lon += RES) {
      let onLand = false;
      for (const fy of [-1 / 3, 0, 1 / 3]) {
        for (const fx of [-1 / 3, 0, 1 / 3]) {
          if (geoContains(land, [lon + fx * RES, lat + fy * RES])) onLand = true;
        }
      }
      if (onLand) out.push({ lat: +lat.toFixed(2), lon: +lon.toFixed(2) });
    }
  }
  return out;
}

let spent = 0;
let minuteStart = Date.now();
async function pace(cost: number) {
  if (Date.now() - minuteStart > 61_000) {
    spent = 0;
    minuteStart = Date.now();
  }
  if (spent + cost > PER_MINUTE_BUDGET) {
    const wait = 61_000 - (Date.now() - minuteStart);
    console.log(`  … pacing ${Math.ceil(wait / 1000)} s (free-tier minute budget)`);
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    spent = 0;
    minuteStart = Date.now();
  }
  spent += cost;
}

type Row = { latitude: number; longitude: number; daily?: { time: string[]; temperature_2m_max: (number | null)[] } };

async function fetchBatch(batch: Cell[], index: number): Promise<Row[]> {
  const file = `${CACHE}/${DAY}-${RES}-${index}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Row[];
  const p = new URLSearchParams({
    latitude: batch.map((c) => c.lat.toFixed(2)).join(','),
    longitude: batch.map((c) => c.lon.toFixed(2)).join(','),
    start_date: DAY,
    end_date: DAY,
    daily: 'temperature_2m_max',
    models: 'era5',
    timezone: 'auto',
  });
  for (let attempt = 1; attempt <= 4; attempt++) {
    await pace(batch.length);
    const res = await fetch(`${ARCHIVE}?${p}`, { signal: AbortSignal.timeout(90_000) });
    if (res.ok) {
      const json = (await res.json()) as Row | Row[];
      const rows = Array.isArray(json) ? json : [json];
      writeFileSync(file, JSON.stringify(rows));
      return rows;
    }
    console.log(`  ↳ HTTP ${res.status} (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, res.status === 429 ? 61_000 : 5_000 * attempt));
  }
  throw new Error(`batch ${index} failed`);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const all = cells();
  console.log(`› ${all.length} land cells at ${RES}° (${MIN_LAT}°–85°N), ~${all.length} weighted calls`);
  const points: { lat: number; lon: number; tmaxC: number }[] = [];
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const rows = await fetchBatch(batch, i / BATCH);
    rows.forEach((row, j) => {
      const t = row.daily?.temperature_2m_max?.[0];
      // keep the requested cell centre (the API snaps to its own grid point nearby)
      if (typeof t === 'number' && Number.isFinite(t)) points.push({ lat: batch[j].lat, lon: batch[j].lon, tmaxC: +t.toFixed(1) });
    });
    console.log(`  ✓ ${Math.min(i + BATCH, all.length)}/${all.length}`);
  }
  const out = {
    meta: {
      day: DAY,
      source: 'Open-Meteo Historical Weather API',
      model: 'ERA5 reanalysis',
      license: 'CC BY 4.0 — Weather data by Open-Meteo.com; contains modified Copernicus Climate Change Service information',
      dataKind: 'reanalysis',
      resolutionDeg: RES,
      retrievedAt: new Date().toISOString(),
      note: `Daily maximum 2 m temperature (each location's local day) on a ${RES}° grid over land, ${Math.abs(MIN_LAT)}°S–85°N. Global context for the India replay; reanalysis, not station observations.`,
    },
    points,
  };
  writeFileSync(OUT, JSON.stringify(out));
  const t = points.map((p) => p.tmaxC);
  console.log(`✓ wrote ${OUT}: ${points.length} cells, Tmax ${Math.min(...t)} … ${Math.max(...t)} °C`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
