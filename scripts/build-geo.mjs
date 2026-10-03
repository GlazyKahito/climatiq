#!/usr/bin/env node
/**
 * Builds CLIMATIQ geography assets from sourced open data (run once; outputs are committed):
 *   - geoBoundaries IND ADM1 (states/UTs, CC BY 2.5 IN via DataMeet) and ADM2 (districts, ODbL 1.0)
 *     https://www.geoboundaries.org — Runfola et al. 2020
 *   - GeoNames cities15000 (CC BY 4.0) — https://www.geonames.org
 *
 * Inputs are downloaded to .data/geo-src (see docs/DATA.md). Outputs:
 *   public/geo/india-states.topo.json          all 36 states/UTs (web-simplified)
 *   public/geo/districts/<ISO>.topo.json         districts of each pilot state
 *   src/server/db/seed/data/geography.json       region hierarchy, inner points, climate zones
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import mapshaper from 'mapshaper';

const SRC = '.data/geo-src';
const PILOTS = ['IN-RJ', 'IN-UP', 'IN-MH', 'IN-OR', 'IN-TG', 'IN-HP', 'IN-DL'];

// Documented CLIMATIQ zone rules (not IMD definitions): curated coastal districts + hill states/UTs.
const COASTAL_DISTRICTS = {
  'IN-OR': ['Balasore', 'Baleshwar', 'Bhadrak', 'Kendrapara', 'Jagatsinghpur', 'Jagatsinghapur', 'Puri', 'Ganjam'],
  'IN-MH': ['Palghar', 'Thane', 'Mumbai', 'Mumbai City', 'Mumbai Suburban', 'Raigad', 'Raigarh', 'Ratnagiri', 'Sindhudurg'],
};
const HILL_STATES = ['IN-HP', 'IN-UT', 'IN-JK', 'IN-LA', 'IN-SK', 'IN-AR'];
const COASTAL_STATES = ['IN-GA', 'IN-KL', 'IN-PY', 'IN-LD', 'IN-AN', 'IN-DH'];
// Lower-elevation districts of Himachal Pradesh evaluated with plains criteria (documented heuristic, < ~600 m).
const HP_PLAINS_DISTRICTS = ['Una'];

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const slug = (s) => strip(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

async function run(cmd, inputs) {
  return mapshaper.applyCommands(cmd, inputs);
}

async function main() {
  const adm1 = readFileSync(join(SRC, 'adm1.geojson'), 'utf8');
  const adm2 = readFileSync(join(SRC, 'adm2.geojson'), 'utf8');

  // ── States: web topology + inner points ──
  const statesOut = await run(
    `-i adm1.json -each 'name=shapeName, iso=shapeISO' -filter-fields name,iso -simplify 10% keep-shapes -o format=topojson quantization=100000 states.json`,
    { 'adm1.json': adm1 },
  );
  const statesTopo = JSON.parse(statesOut['states.json']);
  // Normalise names (strip diacritics) inside the topology properties.
  for (const g of Object.values(statesTopo.objects)[0].geometries) {
    g.properties.name = strip(g.properties.name);
    g.properties.code = g.properties.iso;
  }
  statesTopo.objects = { states: Object.values(statesTopo.objects)[0] };

  const statePts = JSON.parse(
    (await run(`-i adm1.json -points inner -each 'name=shapeName, iso=shapeISO' -filter-fields name,iso -o format=geojson pts.json`, { 'adm1.json': adm1 }))['pts.json'],
  );

  // ── Districts: assign state via inner point ∈ state polygon ──
  const distPts = JSON.parse(
    (
      await run(
        `-i adm2.json -each 'dname=shapeName, did=shapeID' -filter-fields dname,did -points inner -join adm1.json fields=shapeISO -filter-fields dname,did,shapeISO -o format=geojson dpts.json`,
        { 'adm2.json': adm2, 'adm1.json': adm1 },
      )
    )['dpts.json'],
  );
  const stateOfDistrict = new Map();
  const distPoint = new Map();
  for (const f of distPts.features) {
    stateOfDistrict.set(f.properties.did, f.properties.shapeISO);
    distPoint.set(f.properties.did, f.geometry.coordinates);
  }

  const regions = [{ code: 'IN', name: 'India', level: 'country', parent: null, lat: 22.35, lon: 78.67, zone: 'plains', pilot: true, source: 'CLIMATIQ (country node)' }];
  for (const f of statePts.features) {
    const iso = f.properties.iso;
    const [lon, lat] = f.geometry.coordinates;
    regions.push({
      code: iso,
      name: strip(f.properties.name),
      level: 'state',
      parent: 'IN',
      lat: +lat.toFixed(4),
      lon: +lon.toFixed(4),
      zone: HILL_STATES.includes(iso) ? 'hilly' : COASTAL_STATES.includes(iso) ? 'coastal' : 'plains',
      pilot: PILOTS.includes(iso),
      source: 'geoBoundaries IND ADM1 (DataMeet, CC BY 2.5 IN)',
    });
  }

  mkdirSync('public/geo/districts', { recursive: true });
  const adm2Json = JSON.parse(adm2);
  const usedCodes = new Set();
  for (const iso of PILOTS) {
    const feats = adm2Json.features.filter((f) => stateOfDistrict.get(f.properties.shapeID) === iso && strip(f.properties.shapeName) !== 'DATA NOT AVAILABLE');
    const props = [];
    for (const f of feats) {
      const name = strip(f.properties.shapeName);
      let code = `${iso}-${slug(name)}`;
      while (usedCodes.has(code)) code += '-2';
      usedCodes.add(code);
      const [lon, lat] = distPoint.get(f.properties.shapeID);
      const coastal = (COASTAL_DISTRICTS[iso] ?? []).includes(name);
      const hilly = iso === 'IN-HP' && !HP_PLAINS_DISTRICTS.includes(name);
      regions.push({
        code,
        name,
        level: 'district',
        parent: iso,
        lat: +lat.toFixed(4),
        lon: +lon.toFixed(4),
        zone: hilly ? 'hilly' : coastal ? 'coastal' : 'plains',
        pilot: true,
        source: 'geoBoundaries IND ADM2 2021 (LGD/Pathways, ODbL 1.0)',
      });
      f.properties = { name, code, state: iso };
      props.push(code);
    }
    const fc = JSON.stringify({ type: 'FeatureCollection', features: feats });
    const out = await run(`-i d.json -simplify 15% keep-shapes -o format=topojson quantization=100000 out.json`, { 'd.json': fc });
    const topo = JSON.parse(out['out.json']);
    topo.objects = { districts: Object.values(topo.objects)[0] };
    writeFileSync(`public/geo/districts/${iso}.topo.json`, JSON.stringify(topo));
    console.log(`  ${iso}: ${feats.length} districts`);
  }

  // ── Cities: GeoNames, population ≥ 100k (all pilot-state capitals kept), assigned to districts spatially ──
  const lines = readFileSync(join(SRC, 'cities15000.txt'), 'utf8').split('\n');
  const rows = [];
  for (const line of lines) {
    const c = line.split('\t');
    if (c[8] !== 'IN') continue;
    const pop = Number(c[14]);
    const capital = c[7] === 'PPLA' || c[7] === 'PPLC';
    if (pop < 100000 && !capital) continue;
    rows.push({ gid: c[0], name: c[2], lat: Number(c[4]), lon: Number(c[5]), pop, fcode: c[7] });
  }
  const pilotDistricts = adm2Json.features.filter((f) => f.properties.code);
  const pts = JSON.stringify({
    type: 'FeatureCollection',
    features: rows.map((r) => ({ type: 'Feature', properties: { gid: r.gid }, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } })),
  });
  const joined = JSON.parse(
    (
      await run(`-i pts.json -join districts.json fields=code,state -o format=geojson out.json`, {
        'pts.json': pts,
        'districts.json': JSON.stringify({ type: 'FeatureCollection', features: pilotDistricts }),
      })
    )['out.json'],
  );
  const cityDistrict = new Map(joined.features.filter((f) => f.properties.code).map((f) => [f.properties.gid, f.properties.code]));
  const districtZone = new Map(regions.filter((r) => r.level === 'district').map((r) => [r.code, r.zone]));
  let cities = 0;
  for (const r of rows) {
    const d = cityDistrict.get(r.gid);
    if (!d) continue;
    let code = `${d}-C-${slug(r.name)}`;
    while (usedCodes.has(code)) code += '-2';
    usedCodes.add(code);
    regions.push({
      code,
      name: strip(r.name),
      level: 'city',
      parent: d,
      lat: +r.lat.toFixed(4),
      lon: +r.lon.toFixed(4),
      zone: districtZone.get(d) ?? 'plains',
      pilot: true,
      population: r.pop,
      source: 'GeoNames cities15000 (CC BY 4.0)',
    });
    cities++;
  }

  writeFileSync('public/geo/india-states.topo.json', JSON.stringify(statesTopo));
  mkdirSync('src/server/db/seed/data', { recursive: true });
  writeFileSync(
    'src/server/db/seed/data/geography.json',
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: [
          'geoBoundaries IND ADM1 (CC BY 2.5 IN; data from DataMeet) — Runfola et al. (2020) geoBoundaries, PLoS ONE 15(4): e0231866',
          'geoBoundaries IND ADM2 2021 (ODbL 1.0; data from Pathways / Local Government Directory)',
          'GeoNames cities15000 (CC BY 4.0)',
        ],
        disclaimer:
          'Boundaries are simplified for web display and are not authenticated by the Survey of India. Climate-zone assignment is a documented CLIMATIQ heuristic, not an IMD classification.',
        regions,
      },
      null,
      0,
    ),
  );
  const count = (l) => regions.filter((r) => r.level === l).length;
  console.log(`✓ regions: ${count('state')} states, ${count('district')} pilot districts, ${cities} cities`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
