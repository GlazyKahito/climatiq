/** Loads the daily anchors (real district data → normals → documented curve) used by the station simulator. */
import { and, eq, gte, lte, ne } from 'drizzle-orm';
import type { DB } from '../db/types';
import { climateNormals, dailyClimate } from '../db/schema';
import { resolveAnchor, type ClimateZone, type DayAnchor } from './simulate';

const KIND_RANK: Record<string, number> = { observed: 0, reanalysis: 1, nwp_forecast: 2 };

export async function loadAnchorResolver(
  db: DB,
  region: { id: number; lat: number; zone: ClimateZone },
  fromDay: string,
  toDay: string,
): Promise<(day: string) => DayAnchor> {
  const lookback = new Date(`${fromDay}T00:00:00Z`);
  lookback.setUTCDate(lookback.getUTCDate() - 10);
  const rows = await db
    .select({
      day: dailyClimate.day,
      kind: dailyClimate.dataKind,
      tmaxC: dailyClimate.tmaxC,
      tminC: dailyClimate.tminC,
      rhMeanPct: dailyClimate.rhMeanPct,
      windMaxKmh: dailyClimate.windMaxKmh,
    })
    .from(dailyClimate)
    .where(
      and(
        eq(dailyClimate.regionId, region.id),
        gte(dailyClimate.day, lookback.toISOString().slice(0, 10)),
        lte(dailyClimate.day, toDay),
        ne(dailyClimate.dataKind, 'simulated'),
      ),
    );
  const daily = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = daily.get(r.day);
    if (!cur || (KIND_RANK[r.kind] ?? 9) < (KIND_RANK[cur.kind] ?? 9)) daily.set(r.day, r);
  }
  const normalRows = await db
    .select({ doy: climateNormals.dayOfYear, normalTmaxC: climateNormals.normalTmaxC, normalTminC: climateNormals.normalTminC })
    .from(climateNormals)
    .where(eq(climateNormals.regionId, region.id));
  const normals = new Map(normalRows.map((n) => [n.doy, n]));
  const cache = new Map<string, DayAnchor>();
  return (day: string) => {
    let a = cache.get(day);
    if (!a) {
      a = resolveAnchor(day, daily, normals, region.lat, region.zone);
      cache.set(day, a);
    }
    return a;
  };
}
