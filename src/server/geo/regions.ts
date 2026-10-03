import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { regions } from '../db/schema';

export type RegionSummary = {
  id: number;
  code: string;
  name: string;
  level: 'country' | 'state' | 'district' | 'city';
  parentId: number | null;
  path: string;
  lat: number;
  lon: number;
  climateZone: 'plains' | 'coastal' | 'hilly';
  isPilot: boolean;
};

const cols = {
  id: regions.id,
  code: regions.code,
  name: regions.name,
  level: regions.level,
  parentId: regions.parentId,
  path: regions.path,
  lat: regions.lat,
  lon: regions.lon,
  climateZone: regions.climateZone,
  isPilot: regions.isPilot,
};

export async function searchRegions(db: DB, q: string, limit = 12): Promise<(RegionSummary & { parentName: string | null })[]> {
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return [];
  // Qualify the outer column explicitly: an unqualified parent_id would bind to the subquery's alias.
  const parent = sql<string | null>`(select p.name from regions p where p.id = "regions"."parent_id")`;
  return db
    .select({ ...cols, parentName: parent })
    .from(regions)
    .where(or(ilike(regions.name, `${term}%`), ilike(regions.name, `% ${term}%`), ilike(regions.code, `${term}%`)))
    .orderBy(sql`case ${regions.level} when 'state' then 0 when 'district' then 1 when 'city' then 2 else 3 end`, asc(regions.name))
    .limit(limit);
}

export async function getRegionByCode(db: DB, code: string) {
  const [r] = await db.select(cols).from(regions).where(eq(regions.code, code)).limit(1);
  return r ?? null;
}

export async function childrenOf(db: DB, parentId: number) {
  return db.select(cols).from(regions).where(eq(regions.parentId, parentId)).orderBy(asc(regions.name));
}

export async function regionsByLevel(db: DB, level: RegionSummary['level'], opts: { pilotOnly?: boolean } = {}) {
  return db
    .select(cols)
    .from(regions)
    .where(opts.pilotOnly ? and(eq(regions.level, level), eq(regions.isPilot, true)) : eq(regions.level, level))
    .orderBy(asc(regions.name));
}

/** Ancestors (root first) for breadcrumbs, resolved from the materialised path. */
export async function ancestorsOf(db: DB, path: string) {
  const codes = path.split('/');
  const rows = await db.select(cols).from(regions).where(inArray(regions.code, codes));
  return codes.map((c) => rows.find((r) => r.code === c)).filter((r): r is RegionSummary => Boolean(r));
}
