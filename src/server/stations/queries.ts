/**
 * Read-side station queries (list, detail, observations, options). Driver-agnostic and serialisable.
 * Never returns `api_key_hash`.
 */
import { and, asc, count, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DB } from '../db/types';
import { dataSources, regions, stationObservations, weatherStations } from '../db/schema';
import { countByStatus, effectiveStatus, type StationStatus, type StationType } from './status';
import { pathWithin } from '@/lib/rbac';

const parent = alias(regions, 'parent_region');

export type LatestObservation = {
  observedAt: string;
  tempC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  pressureHpa: number | null;
  quality: 'verified' | 'unverified' | 'suspect' | 'rejected';
  dataKind: 'observed' | 'reanalysis' | 'nwp_forecast' | 'model_forecast' | 'simulated';
};

export type StationListItem = {
  id: number;
  code: string;
  name: string;
  stationType: StationType;
  isSimulated: boolean;
  isDemo: boolean;
  status: StationStatus; // effective (freshness-aware)
  storedStatus: StationStatus;
  lat: number;
  lon: number;
  elevationM: number | null;
  sensors: string[];
  regionId: number;
  regionCode: string;
  regionName: string;
  regionPath: string;
  stateCode: string;
  stateName: string;
  sourceName: string;
  registeredAt: string;
  lastSeenAt: string | null;
  latest: LatestObservation | null;
};

export type StationFilters = { status?: StationStatus; type?: StationType; state?: string };

const baseCols = {
  id: weatherStations.id,
  code: weatherStations.code,
  name: weatherStations.name,
  stationType: weatherStations.stationType,
  isSimulated: weatherStations.isSimulated,
  isDemo: weatherStations.isDemo,
  storedStatus: weatherStations.status,
  lat: weatherStations.lat,
  lon: weatherStations.lon,
  elevationM: weatherStations.elevationM,
  sensors: weatherStations.sensors,
  regionId: regions.id,
  regionCode: regions.code,
  regionName: regions.name,
  regionLevel: regions.level,
  regionPath: regions.path,
  parentCode: parent.code,
  parentName: parent.name,
  sourceName: dataSources.name,
  registeredAt: weatherStations.registeredAt,
  lastSeenAt: weatherStations.lastSeenAt,
};

type BaseRow = {
  id: number;
  code: string;
  name: string;
  stationType: StationType;
  isSimulated: boolean;
  isDemo: boolean;
  storedStatus: StationStatus;
  lat: number;
  lon: number;
  elevationM: number | null;
  sensors: string[];
  regionId: number;
  regionCode: string;
  regionName: string;
  regionLevel: string;
  regionPath: string;
  parentCode: string | null;
  parentName: string | null;
  sourceName: string;
  registeredAt: Date;
  lastSeenAt: Date | null;
};

function shape(r: BaseRow, latest: LatestObservation | null, now: Date): StationListItem {
  const isState = r.regionLevel === 'state';
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    stationType: r.stationType,
    isSimulated: r.isSimulated,
    isDemo: r.isDemo,
    status: effectiveStatus(r.storedStatus, r.lastSeenAt, now),
    storedStatus: r.storedStatus,
    lat: r.lat,
    lon: r.lon,
    elevationM: r.elevationM,
    sensors: r.sensors ?? [],
    regionId: r.regionId,
    regionCode: r.regionCode,
    regionName: r.regionName,
    regionPath: r.regionPath,
    stateCode: isState ? r.regionCode : (r.parentCode ?? r.regionCode),
    stateName: isState ? r.regionName : (r.parentName ?? r.regionName),
    sourceName: r.sourceName,
    registeredAt: r.registeredAt.toISOString(),
    lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
    latest,
  };
}

async function latestFor(db: DB, stationIds: number[]): Promise<Map<number, LatestObservation>> {
  if (!stationIds.length) return new Map();
  const rows = await db
    .selectDistinctOn([stationObservations.stationId], {
      stationId: stationObservations.stationId,
      observedAt: stationObservations.observedAt,
      tempC: stationObservations.tempC,
      humidityPct: stationObservations.humidityPct,
      windKmh: stationObservations.windKmh,
      pressureHpa: stationObservations.pressureHpa,
      quality: stationObservations.quality,
      dataKind: stationObservations.dataKind,
    })
    .from(stationObservations)
    .where(inArray(stationObservations.stationId, stationIds))
    .orderBy(stationObservations.stationId, desc(stationObservations.observedAt));
  return new Map(rows.map((r) => [r.stationId, { ...r, observedAt: r.observedAt.toISOString() }]));
}

/** All stations (optionally filtered). Status filter applies to the effective status. */
export async function listStations(db: DB, filters: StationFilters = {}, now: Date = new Date()): Promise<StationListItem[]> {
  const conds = [];
  if (filters.type) conds.push(eq(weatherStations.stationType, filters.type));
  if (filters.state) conds.push(or(eq(regions.code, filters.state), eq(parent.code, filters.state)));
  const rows = (await db
    .select(baseCols)
    .from(weatherStations)
    .innerJoin(regions, eq(regions.id, weatherStations.regionId))
    .leftJoin(parent, eq(parent.id, regions.parentId))
    .innerJoin(dataSources, eq(dataSources.id, weatherStations.sourceId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(weatherStations.code))) as BaseRow[];
  const latest = await latestFor(
    db,
    rows.map((r) => r.id),
  );
  const items = rows.map((r) => shape(r, latest.get(r.id) ?? null, now));
  return filters.status ? items.filter((i) => i.status === filters.status) : items;
}

export async function getStation(db: DB, code: string, now: Date = new Date()) {
  const [r] = (await db
    .select({ ...baseCols, sourceAttribution: dataSources.attribution, sourceKind: dataSources.kind })
    .from(weatherStations)
    .innerJoin(regions, eq(regions.id, weatherStations.regionId))
    .leftJoin(parent, eq(parent.id, regions.parentId))
    .innerJoin(dataSources, eq(dataSources.id, weatherStations.sourceId))
    .where(eq(weatherStations.code, code))
    .limit(1)) as (BaseRow & { sourceAttribution: string | null; sourceKind: string })[];
  if (!r) return null;
  const latest = (await latestFor(db, [r.id])).get(r.id) ?? null;
  const since24h = new Date(now.getTime() - 24 * 3_600_000);
  const since7d = new Date(now.getTime() - 7 * 86_400_000);
  const [stats] = await db
    .select({
      total: count(),
      last24h: sql<number>`count(*) filter (where ${stationObservations.observedAt} >= ${since24h})::int`,
      last7d: sql<number>`count(*) filter (where ${stationObservations.observedAt} >= ${since7d})::int`,
      suspect7d: sql<number>`count(*) filter (where ${stationObservations.observedAt} >= ${since7d} and ${stationObservations.quality} = 'suspect')::int`,
      first: sql<string | null>`min(${stationObservations.observedAt})`,
    })
    .from(stationObservations)
    .where(eq(stationObservations.stationId, r.id));
  return {
    ...shape(r, latest, now),
    sourceAttribution: r.sourceAttribution,
    sourceKind: r.sourceKind,
    stats: {
      total: Number(stats?.total ?? 0),
      last24h: Number(stats?.last24h ?? 0),
      last7d: Number(stats?.last7d ?? 0),
      suspect7d: Number(stats?.suspect7d ?? 0),
      first: stats?.first ? new Date(stats.first).toISOString() : null,
    },
  };
}
export type StationDetail = NonNullable<Awaited<ReturnType<typeof getStation>>>;

export type ObservationRow = {
  observedAt: string;
  tempC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  pressureHpa: number | null;
  dataKind: LatestObservation['dataKind'];
  quality: LatestObservation['quality'];
  receivedAt: string;
};

/** Observations in [from, to], newest first (or oldest first with `order: 'asc'`). */
export async function stationObservationsBetween(
  db: DB,
  stationId: number,
  opts: { from: Date; to: Date; limit?: number; order?: 'asc' | 'desc' },
): Promise<ObservationRow[]> {
  const rows = await db
    .select({
      observedAt: stationObservations.observedAt,
      tempC: stationObservations.tempC,
      humidityPct: stationObservations.humidityPct,
      windKmh: stationObservations.windKmh,
      pressureHpa: stationObservations.pressureHpa,
      dataKind: stationObservations.dataKind,
      quality: stationObservations.quality,
      receivedAt: stationObservations.receivedAt,
    })
    .from(stationObservations)
    .where(and(eq(stationObservations.stationId, stationId), gte(stationObservations.observedAt, opts.from), lte(stationObservations.observedAt, opts.to)))
    .orderBy(opts.order === 'asc' ? asc(stationObservations.observedAt) : desc(stationObservations.observedAt))
    .limit(opts.limit ?? 5000);
  return rows.map((r) => ({ ...r, observedAt: r.observedAt.toISOString(), receivedAt: r.receivedAt.toISOString() }));
}

/** States that have at least one station (filter options). */
export async function stationStateOptions(db: DB) {
  const all = await listStations(db);
  const map = new Map<string, string>();
  for (const s of all) map.set(s.stateCode, s.stateName);
  return [...map.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function statusSummary(stations: Pick<StationListItem, 'status' | 'isSimulated'>[]) {
  return {
    total: stations.length,
    simulated: stations.filter((s) => s.isSimulated).length,
    real: stations.filter((s) => !s.isSimulated).length,
    byStatus: countByStatus(stations),
  };
}

/** States + districts where the user may register stations (`station:manage` scopes; null = nationwide). */
export async function registrableRegions(db: DB, scopes: (string | null)[]) {
  if (!scopes.length) return [];
  const rows = await db
    .select({ code: regions.code, name: regions.name, level: regions.level, path: regions.path, parentId: regions.parentId, id: regions.id })
    .from(regions)
    .where(inArray(regions.level, ['state', 'district']))
    .orderBy(asc(regions.path));
  const allowed = rows.filter((r) => scopes.some((s) => pathWithin(r.path, s)));
  const states = new Map(rows.filter((r) => r.level === 'state').map((r) => [r.id, r]));
  const groups = new Map<string, { state: { code: string; name: string } | null; options: { code: string; name: string; level: string }[] }>();
  for (const r of allowed) {
    const stateRow = r.level === 'state' ? r : states.get(r.parentId ?? -1);
    const key = stateRow?.code ?? r.code;
    if (!groups.has(key)) groups.set(key, { state: stateRow ? { code: stateRow.code, name: stateRow.name } : null, options: [] });
    groups.get(key)!.options.push({ code: r.code, name: r.level === 'state' ? `${r.name} (whole state)` : r.name, level: r.level });
  }
  return [...groups.values()].sort((a, b) => (a.state?.name ?? '').localeCompare(b.state?.name ?? ''));
}
