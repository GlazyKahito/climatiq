/**
 * Fetches NWP guidance AS ISSUED before the replay date (Open-Meteo Previous Runs API, CC BY 4.0) so the replay
 * hindcast uses only information available on 2024-05-26: target day D = issue + h uses `temperature_2m_previous_day{h}`
 * (the forecast made h days earlier). Daily max is taken over the IST calendar day from hourly values.
 *   node --import tsx scripts/fetch-replay-nwp.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const ISSUED = '2024-05-26';
const HORIZON = 7;
const OUT = 'src/server/db/seed/data/snapshot/replay-nwp-previous-runs.json.gz';
const CACHE = '.data/snapshot-cache/prev-runs';
const geo = JSON.parse(readFileSync('src/server/db/seed/data/geography.json', 'utf8')) as { regions: { code: string; level: string; lat: number; lon: number }[] };
const points = geo.regions.filter((r) => r.level === 'state' || r.level === 'district');

const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const vars = Array.from({ length: HORIZON }, (_, i) => `temperature_2m_previous_day${i + 1}`);

async function get(url: string, attempt = 1): Promise<unknown> {
  const res = await fetch(url);
  if (res.ok) return res.json();
  if ((res.status === 429 || res.status >= 500) && attempt < 5) { await new Promise((r) => setTimeout(r, 2000 * attempt)); return get(url, attempt + 1); }
  throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const data: Record<string, Record<string, number>> = {};
  const BATCH = 40;
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    const file = `${CACHE}/${i}.json`;
    let json: unknown;
    if (existsSync(file)) json = JSON.parse(readFileSync(file, 'utf8'));
    else {
      const p = new URLSearchParams({
        latitude: batch.map((b) => b.lat.toFixed(4)).join(','),
        longitude: batch.map((b) => b.lon.toFixed(4)).join(','),
        hourly: vars.join(','),
        start_date: addDays(ISSUED, 1),
        end_date: addDays(ISSUED, HORIZON),
        timezone: 'Asia/Kolkata',
      });
      json = await get(`https://previous-runs-api.open-meteo.com/v1/forecast?${p}`);
      writeFileSync(file, JSON.stringify(json));
      console.log(`  ${i + batch.length}/${points.length}`);
      await new Promise((r) => setTimeout(r, 4000));
    }
    const arr = (Array.isArray(json) ? json : [json]) as { hourly: Record<string, (number | null)[]> & { time: string[] } }[];
    arr.forEach((loc, idx) => {
      const code = batch[idx].code;
      const out: Record<string, number> = {};
      for (let h = 1; h <= HORIZON; h++) {
        const day = addDays(ISSUED, h);
        const vals = loc.hourly.time.map((t, k) => (t.startsWith(day) ? loc.hourly[`temperature_2m_previous_day${h}`][k] : null)).filter((v): v is number => v != null);
        if (vals.length >= 18) out[day] = Math.round(Math.max(...vals) * 10) / 10;
      }
      data[code] = out;
    });
  }
  const meta = {
    source: 'Open-Meteo Previous Runs API (previous-runs-api.open-meteo.com), best-match NWP archive',
    license: 'CC BY 4.0 — Weather data by Open-Meteo.com',
    retrievedAt: new Date().toISOString(),
    dataKind: 'nwp_forecast',
    issuedFor: ISSUED,
    method: 'Target day = issue + h uses hourly temperature_2m_previous_day{h} (forecast made h days earlier); daily max over the IST day.',
  };
  writeFileSync(OUT, gzipSync(JSON.stringify({ meta, data })));
  const covered = Object.values(data).filter((d) => Object.keys(d).length === HORIZON).length;
  console.log(`✓ ${Object.keys(data).length} regions, ${covered} with full ${HORIZON}-day coverage`);
}
main().catch((e) => { console.error(e); process.exit(1); });
