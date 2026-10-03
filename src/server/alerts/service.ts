/** Alert queries and workflow (acknowledge / resolve) with region-scoped authorisation. */
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/types';
import { advisories, alerts, forecasts, incidents, regions } from '../db/schema';
import { audit } from '../audit/log';
import type { AppUser } from '../auth/users';
import { DomainError } from './errors';
import { can, scopesFor, type Permission } from '@/lib/rbac';
import type { Severity } from '@/lib/domain';
import { withinScopes } from './scope';

export type AlertStatusFilter = 'open' | 'active' | 'acknowledged' | 'resolved' | 'expired' | 'all';

export type AlertFilters = {
  status?: AlertStatusFilter;
  severity?: Severity;
  /** Region code: alerts for that region or below. */
  region?: string;
  scenario?: 'live' | 'replay' | 'all';
  limit?: number;
  offset?: number;
};

export type AlertListItem = {
  id: string;
  title: string;
  message: string;
  severity: Severity;
  status: 'active' | 'acknowledged' | 'resolved' | 'expired';
  targetDate: string;
  confidenceScore: number;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  regionId: number;
  regionCode: string;
  regionName: string;
  regionLevel: string;
  regionPath: string;
  scenario: string;
  forecastId: number | null;
  incidentRefs: string[];
  isDemo: boolean;
};

function assertCan(user: AppUser, perm: Permission, path: string) {
  if (!can(user.assignments, perm, path)) throw new DomainError(403, `Missing permission ${perm} for this region`);
}

const ackUser = sql<string | null>`(select u.name from users u where u.id = "alerts"."acknowledged_by")`;
const incidentRefs = sql<string[]>`coalesce((select array_agg(i.ref order by i.opened_at) from incidents i where i.alert_id = "alerts"."id"), '{}')`;

const cols = {
  id: alerts.id,
  title: alerts.title,
  message: alerts.message,
  severity: alerts.severity,
  status: alerts.status,
  targetDate: alerts.targetDate,
  confidenceScore: alerts.confidenceScore,
  createdAt: alerts.createdAt,
  acknowledgedAt: alerts.acknowledgedAt,
  acknowledgedBy: ackUser,
  resolvedAt: alerts.resolvedAt,
  regionId: regions.id,
  regionCode: regions.code,
  regionName: regions.name,
  regionLevel: regions.level,
  regionPath: regions.path,
  dedupKey: alerts.dedupKey,
  forecastId: alerts.forecastId,
  incidentRefs,
  isDemo: alerts.isDemo,
};

type Row = { [K in keyof typeof cols]: unknown } & Record<string, unknown>;
function toItem(r: Row): AlertListItem {
  const x = r as unknown as {
    id: string; title: string; message: string; severity: Severity; status: AlertListItem['status']; targetDate: string; confidenceScore: number;
    createdAt: Date; acknowledgedAt: Date | null; acknowledgedBy: string | null; resolvedAt: Date | null; regionId: number; regionCode: string;
    regionName: string; regionLevel: string; regionPath: string; dedupKey: string; forecastId: number | null; incidentRefs: string[] | null; isDemo: boolean;
  };
  return {
    id: x.id,
    title: x.title,
    message: x.message,
    severity: x.severity,
    status: x.status,
    targetDate: x.targetDate,
    confidenceScore: x.confidenceScore,
    createdAt: new Date(x.createdAt).toISOString(),
    acknowledgedAt: x.acknowledgedAt ? new Date(x.acknowledgedAt).toISOString() : null,
    acknowledgedBy: x.acknowledgedBy,
    resolvedAt: x.resolvedAt ? new Date(x.resolvedAt).toISOString() : null,
    regionId: x.regionId,
    regionCode: x.regionCode,
    regionName: x.regionName,
    regionLevel: x.regionLevel,
    regionPath: x.regionPath,
    scenario: x.dedupKey.split(':')[0] ?? 'live',
    forecastId: x.forecastId,
    incidentRefs: x.incidentRefs ?? [],
    isDemo: x.isDemo,
  };
}

function filterConds(user: AppUser, f: AlertFilters): SQL[] {
  const conds: SQL[] = [];
  const scope = withinScopes(regions.path, scopesFor(user.assignments, 'alert:view'));
  if (scope) conds.push(scope);
  const status = f.status ?? 'open';
  if (status === 'open') conds.push(inArray(alerts.status, ['active', 'acknowledged']));
  else if (status !== 'all') conds.push(eq(alerts.status, status));
  if (f.severity) conds.push(eq(alerts.severity, f.severity));
  if (f.scenario && f.scenario !== 'all') conds.push(sql`${alerts.dedupKey} like ${f.scenario + ':%'}`);
  if (f.region) conds.push(sql`(${regions.code} = ${f.region} or ${regions.path} like ${'%/' + f.region + '/%'} or ${regions.path} like ${'%/' + f.region})`);
  return conds;
}

export async function listAlerts(db: DB, user: AppUser, f: AlertFilters = {}) {
  if (!can(user.assignments, 'alert:view')) return { items: [] as AlertListItem[], total: 0 };
  const conds = filterConds(user, f);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await db
    .select(cols)
    .from(alerts)
    .innerJoin(regions, eq(regions.id, alerts.regionId))
    .where(and(...conds))
    .orderBy(
      sql`case ${alerts.status} when 'active' then 0 when 'acknowledged' then 1 when 'resolved' then 2 else 3 end`,
      sql`case ${alerts.severity} when 'extreme' then 0 when 'high' then 1 when 'moderate' then 2 else 3 end`,
      alerts.targetDate,
      desc(alerts.createdAt),
    )
    .limit(limit)
    .offset(Math.max(f.offset ?? 0, 0));
  const [{ n }] = await db.select({ n: count() }).from(alerts).innerJoin(regions, eq(regions.id, alerts.regionId)).where(and(...conds));
  return { items: rows.map((r) => toItem(r as Row)), total: Number(n) };
}

/** Status counts in the user's scope (for tab badges / summaries). */
export async function alertStatusCounts(db: DB, user: AppUser, scenario?: 'live' | 'replay') {
  const out = { active: 0, acknowledged: 0, resolved: 0, expired: 0 };
  if (!can(user.assignments, 'alert:view')) return out;
  const conds: SQL[] = [];
  const scope = withinScopes(regions.path, scopesFor(user.assignments, 'alert:view'));
  if (scope) conds.push(scope);
  if (scenario) conds.push(sql`${alerts.dedupKey} like ${scenario + ':%'}`);
  const rows = await db
    .select({ status: alerts.status, n: count() })
    .from(alerts)
    .innerJoin(regions, eq(regions.id, alerts.regionId))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(alerts.status);
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

export async function getAlert(db: DB, user: AppUser, id: string) {
  const [row] = await db.select(cols).from(alerts).innerJoin(regions, eq(regions.id, alerts.regionId)).where(eq(alerts.id, id)).limit(1);
  if (!row) throw new DomainError(404, 'Alert not found');
  const item = toItem(row as Row);
  assertCan(user, 'alert:view', item.regionPath);
  const [detail] = await db
    .select({
      rule: alerts.rule,
      advisoryId: alerts.advisoryId,
      advisoryTitle: advisories.title,
      parentName: sql<string | null>`(select p.name from regions p where p.id = "regions"."parent_id")`,
    })
    .from(alerts)
    .innerJoin(regions, eq(regions.id, alerts.regionId))
    .leftJoin(advisories, eq(advisories.id, alerts.advisoryId))
    .where(eq(alerts.id, id));
  const forecast = item.forecastId
    ? (
        await db
          .select({
            targetDate: forecasts.targetDate,
            horizonDay: forecasts.horizonDay,
            resolution: forecasts.resolution,
            predictedTmaxC: forecasts.predictedTmaxC,
            lowerC: forecasts.lowerC,
            upperC: forecasts.upperC,
            normalTmaxC: forecasts.normalTmaxC,
            departureC: forecasts.departureC,
            confidence: forecasts.confidence,
            confidenceScore: forecasts.confidenceScore,
            durationDays: forecasts.durationDays,
            imdCategory: forecasts.imdCategory,
            factors: forecasts.factors,
            inputKinds: forecasts.inputKinds,
            runId: forecasts.runId,
          })
          .from(forecasts)
          .where(eq(forecasts.id, item.forecastId))
          .limit(1)
      )[0] ?? null
    : null;
  const linked = await db
    .select({ ref: incidents.ref, title: incidents.title, status: incidents.status, priority: incidents.priority })
    .from(incidents)
    .where(eq(incidents.alertId, id));
  return {
    ...item,
    parentName: detail?.parentName ?? null,
    rule: (detail?.rule ?? {}) as Record<string, unknown>,
    advisory: detail?.advisoryId ? { id: detail.advisoryId, title: detail.advisoryTitle ?? 'Advisory' } : null,
    forecast,
    incidents: linked,
  };
}

async function loadForUpdate(db: DB, id: string) {
  const [a] = await db
    .select({ id: alerts.id, status: alerts.status, regionId: alerts.regionId, path: regions.path })
    .from(alerts)
    .innerJoin(regions, eq(regions.id, alerts.regionId))
    .where(eq(alerts.id, id))
    .limit(1);
  if (!a) throw new DomainError(404, 'Alert not found');
  return a;
}

export async function acknowledgeAlert(db: DB, user: AppUser, id: string) {
  const a = await loadForUpdate(db, id);
  assertCan(user, 'alert:acknowledge', a.path);
  if (a.status !== 'active') throw new DomainError(409, `Alert is ${a.status}; only active alerts can be acknowledged`);
  const at = new Date();
  await db.update(alerts).set({ status: 'acknowledged', acknowledgedBy: user.id, acknowledgedAt: at }).where(and(eq(alerts.id, id), eq(alerts.status, 'active')));
  await audit(db, { actor: user, action: 'alert.acknowledge', entityType: 'alert', entityId: id, regionId: a.regionId, before: { status: a.status }, after: { status: 'acknowledged' } });
  return { id, status: 'acknowledged' as const, acknowledgedAt: at.toISOString() };
}

export async function resolveAlert(db: DB, user: AppUser, id: string, note?: string) {
  const a = await loadForUpdate(db, id);
  assertCan(user, 'alert:manage', a.path);
  if (a.status !== 'active' && a.status !== 'acknowledged') throw new DomainError(409, `Alert is already ${a.status}`);
  const at = new Date();
  await db
    .update(alerts)
    .set({ status: 'resolved', resolvedAt: at, ...(a.status === 'active' ? { acknowledgedBy: user.id, acknowledgedAt: at } : {}) })
    .where(eq(alerts.id, id));
  await audit(db, {
    actor: user,
    action: 'alert.resolve',
    entityType: 'alert',
    entityId: id,
    regionId: a.regionId,
    before: { status: a.status },
    after: { status: 'resolved', note: note?.slice(0, 500) ?? null },
  });
  return { id, status: 'resolved' as const, resolvedAt: at.toISOString() };
}

