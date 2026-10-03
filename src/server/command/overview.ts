/**
 * Command-center overview: metric cards and side-panel data. Every value comes from stored data and carries
 * enough provenance for the UI to label it. Operational panels (alerts, incidents, advisories) are filtered by
 * the user's region scopes.
 */
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import {
  advisories,
  advisoryRegions,
  alerts,
  dailyClimate,
  dataSources,
  forecastRuns,
  forecasts,
  incidents,
  ingestionRuns,
  regions,
} from '../db/schema';
import { latestRun } from '../forecasting/queries';
import type { Scenario } from '../scenario';
import { listStations, statusSummary } from '../stations/queries';
import { compareRuns, peakByRegion, previousRun, runDays, runForecasts, runSummary, severityCounts, type ForecastChange } from './map-data';
import type { MapForecast, MapStation, RunSummary, StateMeta } from '@/components/map/types';
import { can, pathWithin, scopesFor, type Assignment } from '@/lib/rbac';
import { SEVERITY_META, todayIST, type DataKind, type Severity } from '@/lib/domain';

type ScopeList = (string | null)[];

/** Region path is inside one of the scopes (descendant or equal). */
export function inScopes(path: string, scopes: ScopeList) {
  return scopes.some((s) => pathWithin(path, s));
}
/** Region is inside a scope OR is an ancestor of a scope (e.g. a national advisory is relevant to a district user). */
export function relevantToScopes(path: string, scopes: ScopeList) {
  return scopes.some((s) => pathWithin(path, s) || (s !== null && pathWithin(s, path)));
}

export type CommandOverview = Awaited<ReturnType<typeof commandOverview>>;

export async function commandOverview(db: DB, opts: { scenario: Scenario; assignments: Assignment[]; now?: Date }) {
  const now = opts.now ?? new Date();
  const { scenario, assignments } = opts;
  const run = await latestRun(db, scenario);

  const stateRows = await db
    .select({ code: regions.code, name: regions.name, isPilot: regions.isPilot, zone: regions.climateZone })
    .from(regions)
    .where(eq(regions.level, 'state'))
    .orderBy(asc(regions.name));
  const states: StateMeta[] = stateRows;

  let days: string[] = [];
  let stateForecasts: MapForecast[] = [];
  const districtSeverityByDay: Record<string, Record<Severity, number>> = {};
  let hottest: { code: string; name: string; level: string; day: string; tmax: number; sev: Severity; res: string } | null = null;
  let affected: { states: number; districts: number; topStates: { code: string; name: string; districts: number }[] } | null = null;
  let changes: (ForecastChange & { prevIssuedFor: string; prevCreatedAt: string }) | null = null;

  if (run) {
    days = await runDays(db, run.id);
    stateForecasts = await runForecasts(db, run.id, 'state');
    const districtForecasts = await runForecasts(db, run.id, 'district');
    for (const d of days) districtSeverityByDay[d] = severityCounts(districtForecasts, d);

    const all = [...stateForecasts, ...districtForecasts];
    const top = all.reduce<MapForecast | null>((m, r) => (!m || r.tmax > m.tmax ? r : m), null);
    if (top) hottest = { code: top.code, name: top.name, level: top.level, day: top.day, tmax: top.tmax, sev: top.sev, res: top.res };

    const peakStates = peakByRegion(stateForecasts, 5);
    const peakDistricts = peakByRegion(districtForecasts, 5);
    const high = (s: Severity) => SEVERITY_META[s].rank >= SEVERITY_META.high.rank;
    const byState = new Map<string, number>();
    for (const d of districtForecasts) {
      const p = peakDistricts.get(d.code);
      if (p && high(p.sev) && d.h === 1 && d.parentCode) byState.set(d.parentCode, (byState.get(d.parentCode) ?? 0) + 1);
    }
    affected = {
      states: [...peakStates.values()].filter((p) => high(p.sev)).length,
      districts: [...peakDistricts.values()].filter((p) => high(p.sev)).length,
      topStates: [...byState.entries()]
        .map(([code, n]) => ({ code, name: states.find((s) => s.code === code)?.name ?? code, districts: n }))
        .sort((a, b) => b.districts - a.districts)
        .slice(0, 4),
    };

    const prev = await previousRun(db, scenario, run);
    if (prev) {
      const prevRows = [...(await runForecasts(db, prev.id, 'state')), ...(await runForecasts(db, prev.id, 'district'))];
      const c = compareRuns(prevRows, all);
      if (c.compared > 0) changes = { ...c, prevIssuedFor: prev.issuedFor, prevCreatedAt: prev.createdAt };
    }
  }

  // ── Stations (network overview, not region-restricted: viewing is not scoped) ──
  const stationList = await listStations(db, {}, now);
  const stations = {
    summary: statusSummary(stationList),
    items: stationList.map<MapStation>((s) => ({
      code: s.code,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      status: s.status,
      stationType: s.stationType,
      isSimulated: s.isSimulated,
      lastSeenAt: s.lastSeenAt,
      latestTempC: s.latest?.tempC ?? null,
      latestAt: s.latest?.observedAt ?? null,
      regionName: s.regionName,
      stateCode: s.stateCode,
    })),
  };

  // ── Alerts (scope: alert:view; scenario via the linked forecast run) ──
  let alertData: {
    open: number;
    active: number;
    acknowledged: number;
    bySeverity: Record<Severity, number>;
    latest: { id: string; title: string; severity: Severity; status: string; targetDate: string; regionName: string; createdAt: string }[];
  } | null = null;
  if (can(assignments, 'alert:view')) {
    const scopes = scopesFor(assignments, 'alert:view');
    const rows = await db
      .select({
        id: alerts.id,
        title: alerts.title,
        severity: alerts.severity,
        status: alerts.status,
        targetDate: alerts.targetDate,
        createdAt: alerts.createdAt,
        regionName: regions.name,
        path: regions.path,
        runScenario: forecastRuns.scenario,
      })
      .from(alerts)
      .innerJoin(regions, eq(regions.id, alerts.regionId))
      .leftJoin(forecasts, eq(forecasts.id, alerts.forecastId))
      .leftJoin(forecastRuns, eq(forecastRuns.id, forecasts.runId))
      .where(and(inArray(alerts.status, ['active', 'acknowledged']), or(isNull(alerts.forecastId), eq(forecastRuns.scenario, scenario))))
      .orderBy(desc(alerts.createdAt))
      .limit(2000);
    const visible = rows.filter((r) => inScopes(r.path, scopes));
    const bySeverity: Record<Severity, number> = { low: 0, moderate: 0, high: 0, extreme: 0 };
    for (const r of visible) bySeverity[r.severity] += 1;
    alertData = {
      open: visible.length,
      active: visible.filter((r) => r.status === 'active').length,
      acknowledged: visible.filter((r) => r.status === 'acknowledged').length,
      bySeverity,
      latest: visible
        .sort((a, b) => SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank || b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5)
        .map((r) => ({ id: r.id, title: r.title, severity: r.severity, status: r.status, targetDate: r.targetDate, regionName: r.regionName, createdAt: r.createdAt.toISOString() })),
    };
  }

  // ── Advisories (approved / published; internal ones only with advisory:view_internal) ──
  let advisoryData: {
    id: string;
    title: string;
    severity: Severity;
    audience: string;
    status: string;
    validFrom: string;
    validTo: string;
    provider: string;
    regions: string[];
  }[] | null = null;
  {
    const internal = can(assignments, 'advisory:view_internal');
    const scopes: ScopeList = internal ? scopesFor(assignments, 'advisory:view_internal') : [null];
    const rows = await db
      .select({
        id: advisories.id,
        title: advisories.title,
        severity: advisories.severity,
        audience: advisories.audience,
        status: advisories.status,
        validFrom: advisories.validFrom,
        validTo: advisories.validTo,
        provider: advisories.provider,
        generatedAt: advisories.generatedAt,
        runScenario: forecastRuns.scenario,
      })
      .from(advisories)
      .leftJoin(forecastRuns, eq(forecastRuns.id, advisories.forecastRunId))
      .where(
        and(
          internal ? inArray(advisories.status, ['approved', 'published']) : and(eq(advisories.status, 'published'), eq(advisories.audience, 'public')),
          or(isNull(advisories.forecastRunId), eq(forecastRuns.scenario, scenario)),
        ),
      )
      .orderBy(desc(advisories.generatedAt))
      .limit(100);
    const regionRows = rows.length
      ? await db
          .select({ advisoryId: advisoryRegions.advisoryId, name: regions.name, path: regions.path })
          .from(advisoryRegions)
          .innerJoin(regions, eq(regions.id, advisoryRegions.regionId))
          .where(
            inArray(
              advisoryRegions.advisoryId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    advisoryData = rows
      .map((r) => {
        const regs = regionRows.filter((x) => x.advisoryId === r.id);
        return { r, regs };
      })
      .filter(({ regs }) => regs.length === 0 || regs.some((x) => relevantToScopes(x.path, scopes)))
      .slice(0, 6)
      .map(({ r, regs }) => ({
        id: r.id,
        title: r.title,
        severity: r.severity,
        audience: r.audience,
        status: r.status,
        validFrom: r.validFrom,
        validTo: r.validTo,
        provider: r.provider,
        regions: regs.map((x) => x.name),
      }));
  }

  // ── Response activity (scope: incident:view; read-only) ──
  let incidentData: {
    open: number;
    byPriority: Record<string, number>;
    byState: { code: string; name: string; open: number }[];
    items: { ref: string; title: string; status: string; priority: string; severity: Severity; regionName: string; updatedAt: string }[];
  } | null = null;
  if (can(assignments, 'incident:view')) {
    const scopes = scopesFor(assignments, 'incident:view');
    const rows = await db
      .select({
        ref: incidents.ref,
        title: incidents.title,
        status: incidents.status,
        priority: incidents.priority,
        severity: incidents.severity,
        updatedAt: incidents.updatedAt,
        regionName: regions.name,
        path: regions.path,
      })
      .from(incidents)
      .innerJoin(regions, eq(regions.id, incidents.regionId))
      .where(notInArray(incidents.status, ['resolved', 'closed']))
      .orderBy(asc(incidents.priority), desc(incidents.updatedAt))
      .limit(1000);
    const visible = rows.filter((r) => inScopes(r.path, scopes));
    const byPriority: Record<string, number> = { p1: 0, p2: 0, p3: 0, p4: 0 };
    const byStateMap = new Map<string, number>();
    for (const r of visible) {
      byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
      const st = r.path.split('/')[1] ?? r.path;
      byStateMap.set(st, (byStateMap.get(st) ?? 0) + 1);
    }
    incidentData = {
      open: visible.length,
      byPriority,
      byState: [...byStateMap.entries()]
        .map(([code, open]) => ({ code, name: states.find((s) => s.code === code)?.name ?? code, open }))
        .sort((a, b) => b.open - a.open),
      items: visible.slice(0, 5).map((r) => ({
        ref: r.ref,
        title: r.title,
        status: r.status,
        priority: r.priority,
        severity: r.severity,
        regionName: r.regionName,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  // ── Data ingestion health ──
  const ingestion = (
    await db
      .select({
        id: ingestionRuns.id,
        source: dataSources.name,
        sourceKey: dataSources.key,
        sourceKind: dataSources.kind,
        job: ingestionRuns.job,
        status: ingestionRuns.status,
        triggeredBy: ingestionRuns.triggeredBy,
        startedAt: ingestionRuns.startedAt,
        finishedAt: ingestionRuns.finishedAt,
        recordsWritten: ingestionRuns.recordsWritten,
        error: ingestionRuns.error,
      })
      .from(ingestionRuns)
      .innerJoin(dataSources, eq(dataSources.id, ingestionRuns.sourceId))
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(8)
  ).map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null }));
  const [failed24] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ingestionRuns)
    .where(and(eq(ingestionRuns.status, 'failed'), sql`${ingestionRuns.startedAt} > ${new Date(now.getTime() - 86_400_000)}`));

  // ── Regional conditions: latest real (observed / reanalysis) state-level day on or before the reference day ──
  const refDay = run && scenario === 'replay' ? run.issuedFor : todayIST(now);
  const [latestDay] = await db
    .select({ day: sql<string | null>`max(${dailyClimate.day})::text` })
    .from(dailyClimate)
    .innerJoin(regions, eq(regions.id, dailyClimate.regionId))
    .where(and(eq(regions.level, 'state'), inArray(dailyClimate.dataKind, ['observed', 'reanalysis']), lte(dailyClimate.day, refDay)));
  let conditions: { day: string; refDay: string; kind: DataKind; source: string; rows: { code: string; name: string; tmax: number | null; tmin: number | null; rh: number | null }[] } | null =
    null;
  if (latestDay?.day) {
    const rows = await db
      .select({
        code: regions.code,
        name: regions.name,
        tmax: dailyClimate.tmaxC,
        tmin: dailyClimate.tminC,
        rh: dailyClimate.rhMeanPct,
        kind: dailyClimate.dataKind,
        source: dataSources.name,
      })
      .from(dailyClimate)
      .innerJoin(regions, eq(regions.id, dailyClimate.regionId))
      .innerJoin(dataSources, eq(dataSources.id, dailyClimate.sourceId))
      .where(and(eq(regions.level, 'state'), eq(dailyClimate.day, latestDay.day), inArray(dailyClimate.dataKind, ['observed', 'reanalysis'])))
      .orderBy(sql`${dailyClimate.tmaxC} desc nulls last`);
    if (rows.length) {
      conditions = {
        day: latestDay.day,
        refDay,
        kind: rows[0].kind,
        source: rows[0].source,
        rows: rows.map((r) => ({ code: r.code, name: r.name, tmax: r.tmax, tmin: r.tmin, rh: r.rh })),
      };
    }
  }

  const summary: RunSummary | null = run ? runSummary(run) : null;
  return {
    scenario,
    run: summary,
    days,
    states,
    stateForecasts,
    districtSeverityByDay,
    hottest,
    affected,
    changes,
    stations,
    alerts: alertData,
    advisories: advisoryData,
    incidents: incidentData,
    ingestion,
    ingestionFailed24h: Number(failed24?.n ?? 0),
    conditions,
    generatedAt: now.toISOString(),
  };
}
