import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../types';
import { regions } from '../schema';

type GeoRegion = {
  code: string;
  name: string;
  level: 'country' | 'state' | 'district' | 'city';
  parent: string | null;
  lat: number;
  lon: number;
  zone: 'plains' | 'coastal' | 'hilly';
  pilot: boolean;
  population?: number;
  source: string;
};

export function loadGeography(): { regions: GeoRegion[]; sources: string[]; disclaimer: string } {
  return JSON.parse(readFileSync(join(process.cwd(), 'src/server/db/seed/data/geography.json'), 'utf8'));
}

/** Inserts India → states → pilot districts → cities, parents first, with materialised paths. */
export async function seedGeography(db: DB) {
  const geo = loadGeography();
  const order = { country: 0, state: 1, district: 2, city: 3 } as const;
  const sorted = [...geo.regions].sort((a, b) => order[a.level] - order[b.level]);
  const ids = new Map<string, { id: number; path: string }>();
  const BATCH = 200;
  for (const level of ['country', 'state', 'district', 'city'] as const) {
    const rows = sorted.filter((r) => r.level === level);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => {
        const parent = r.parent ? ids.get(r.parent) : undefined;
        if (r.parent && !parent) throw new Error(`Missing parent ${r.parent} for ${r.code}`);
        return {
          code: r.code,
          name: r.name,
          level: r.level,
          parentId: parent?.id ?? null,
          path: parent ? `${parent.path}/${r.code}` : r.code,
          lat: r.lat,
          lon: r.lon,
          climateZone: r.zone,
          isPilot: r.pilot,
          population: r.population ?? null,
          geoSource: r.source,
        };
      });
      const inserted = await db
        .insert(regions)
        .values(chunk)
        .onConflictDoNothing()
        .returning({ id: regions.id, code: regions.code, path: regions.path });
      for (const r of inserted) ids.set(r.code, { id: r.id, path: r.path });
    }
    if (level !== 'city') {
      // ensure ids for pre-existing rows (idempotency)
      const all = await db.select({ id: regions.id, code: regions.code, path: regions.path }).from(regions);
      for (const r of all) ids.set(r.code, { id: r.id, path: r.path });
    }
  }
  const count = (l: GeoRegion['level']) => geo.regions.filter((r) => r.level === l).length;
  return { states: count('state'), districts: count('district'), cities: count('city') };
}
