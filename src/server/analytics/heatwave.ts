/**
 * Heatwave-day frequency indicator: days per year on which a region's daily Tmax meets the CLIMATIQ High / Extreme
 * classes (derived from IMD heatwave criteria) when compared with a CLIMATIQ reference climatology.
 *
 * This is an INDICATOR, not an IMD declaration: IMD declares heatwaves from station observations against 1991–2020
 * station normals and requires the criteria at ≥ 2 stations in a meteorological subdivision on 2 consecutive days.
 * Here, gridded ERA5 reanalysis at the region centroid is compared with a few-year ERA5 reference normal.
 */
import { inArray } from 'drizzle-orm';
import type { DB } from '../db/types';
import { regions, severityThresholds } from '../db/schema';
import { DEFAULT_THRESHOLDS, type ClimateZone, type Threshold, type ZoneThresholds } from '../forecasting/severity';
import { heatDaysByYear, type HeatYear } from './metrics';
import { loadNormalsFor, normalBases, pickBasis, tmaxSeries } from './history';
import type { DataKind } from '@/lib/domain';

/** Thresholds from the configurable `severity_thresholds` table, falling back to the documented defaults. */
export async function loadThresholds(db: DB): Promise<ZoneThresholds> {
  const rows = await db.select().from(severityThresholds);
  if (!rows.length) return DEFAULT_THRESHOLDS;
  const out = { plains: [], coastal: [], hilly: [] } as Record<ClimateZone, Threshold[]>;
  for (const r of rows) {
    out[r.zone].push({ level: r.level, minTmaxC: r.minTmaxC, minDepartureC: r.minDepartureC, absoluteTmaxC: r.absoluteTmaxC });
  }
  for (const z of Object.keys(out) as ClimateZone[]) if (!out[z].length) out[z] = DEFAULT_THRESHOLDS[z];
  return out;
}

export type RegionHeatFrequency = {
  regionId: number;
  code: string;
  name: string;
  level: 'country' | 'state' | 'district' | 'city';
  zone: ClimateZone;
  basisKey: string | null;
  basis: string | null;
  dataKinds: DataKind[];
  years: HeatYear[];
  totalHeatwaveDays: number;
  totalExtremeDays: number;
  daysEvaluated: number;
};

/**
 * Heatwave-day counts per year for the given regions (all daily history in range, classified against ONE reference
 * basis per region so years are comparable). `basisKey` selects the preferred basis (e.g. the scenario's
 * NORMAL_BASIS key); regions lacking it fall back to the basis with the widest day-of-year coverage.
 */
export async function heatwaveFrequency(
  db: DB,
  regionIds: number[],
  opts: { from?: string; to?: string; basisKey?: string } = {},
): Promise<RegionHeatFrequency[]> {
  if (!regionIds.length) return [];
  const [regionRows, bases, thresholds, series] = await Promise.all([
    db
      .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level, zone: regions.climateZone })
      .from(regions)
      .where(inArray(regions.id, regionIds)),
    normalBases(db, regionIds),
    loadThresholds(db),
    tmaxSeries(db, regionIds, opts.from, opts.to),
  ]);
  const chosen = regionIds
    .map((id) => {
      const mine = bases.filter((b) => b.regionId === id);
      return { id, basis: (opts.basisKey && mine.find((b) => b.basisKey === opts.basisKey)) || pickBasis(mine) };
    })
    .filter((c) => c.basis)
    .map((c) => ({ regionId: c.id, basisKey: c.basis!.basisKey, basis: c.basis! }));
  const normals = await loadNormalsFor(db, chosen);

  const byRegion = new Map<number, { day: string; tmaxC: number | null; dataKind: DataKind }[]>();
  for (const s of series) {
    const list = byRegion.get(s.regionId) ?? [];
    list.push(s);
    byRegion.set(s.regionId, list);
  }

  const order = new Map(regionIds.map((id, i) => [id, i]));
  return [...regionRows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map((r) => {
    const c = chosen.find((x) => x.regionId === r.id);
    const days = byRegion.get(r.id) ?? [];
    const years = c ? heatDaysByYear(days, normals.get(r.id) ?? new Map(), r.zone, thresholds) : [];
    return {
      regionId: r.id,
      code: r.code,
      name: r.name,
      level: r.level,
      zone: r.zone,
      basisKey: c?.basisKey ?? null,
      basis: c?.basis.basis ?? null,
      dataKinds: [...new Set(days.map((d) => d.dataKind))],
      years,
      totalHeatwaveDays: years.reduce((a, y) => a + y.heatwaveDays, 0),
      totalExtremeDays: years.reduce((a, y) => a + y.extreme, 0),
      daysEvaluated: years.reduce((a, y) => a + y.daysEvaluated, 0),
    };
  });
}
