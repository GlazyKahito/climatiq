import { asc, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { regions } from '../db/schema';

export type RegionOption = { id: number; code: string; name: string; level: 'state' | 'district'; stateName: string | null; zone: 'plains' | 'coastal' | 'hilly' };

/** Regions by code (preserving the requested order). */
export async function regionsByCodes(db: DB, codes: string[]) {
  if (!codes.length) return [];
  const rows = await db
    .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level, path: regions.path, zone: regions.climateZone })
    .from(regions)
    .where(inArray(regions.code, codes));
  return codes.map((c) => rows.find((r) => r.code === c)).filter((r): r is (typeof rows)[number] => Boolean(r));
}

/** States/UTs and pilot districts for analytics pickers. */
export async function analyticsRegionOptions(db: DB): Promise<RegionOption[]> {
  const parentName = sql<string | null>`(select p.name from regions p where p.id = "regions"."parent_id")`;
  const rows = await db
    .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level, stateName: parentName, zone: regions.climateZone })
    .from(regions)
    .where(inArray(regions.level, ['state', 'district']))
    .orderBy(asc(regions.level), asc(regions.name));
  return rows.map((r) => ({ ...r, level: r.level as 'state' | 'district', stateName: r.level === 'state' ? null : r.stateName }));
}

/** All state/UT ids (for national tables). */
export async function stateIds(db: DB) {
  const rows = await db.select({ id: regions.id }).from(regions).where(inArray(regions.level, ['state']));
  return rows.map((r) => r.id);
}
