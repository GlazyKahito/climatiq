import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { alerts, appConfig, auditLogs, forecastRuns, forecasts, modelVersions, notifications, regions, roles, userRoles, users } from '@/server/db/schema';
import { seedReference } from '@/server/db/seed/reference';
import { evaluateAlerts } from '@/server/alerts/engine';
import { aggregateCandidates, DEFAULT_ALERT_CONFIG, parseAlertConfig, qualifies } from '@/server/alerts/rules';
import { acknowledgeAlert, listAlerts, resolveAlert } from '@/server/alerts/service';
import { loadUser, type AppUser } from '@/server/auth/users';
import { addDays, type Severity } from '@/lib/domain';
import { DomainError } from '@/server/alerts/errors';

let db: DB;
let close: () => Promise<void>;
const R: Record<string, { id: number; path: string }> = {};
const U: Record<string, AppUser> = {};

async function region(code: string, level: 'country' | 'state' | 'district' | 'city', parent: string | null) {
  const p = parent ? R[parent] : null;
  const [r] = await db
    .insert(regions)
    .values({ code, name: code.split('-').pop()!, level, parentId: p?.id ?? null, path: p ? `${p.path}/${code}` : code, lat: 26, lon: 75, geoSource: 'test', isPilot: level !== 'state' || code === 'IN-RJ' })
    .returning({ id: regions.id, path: regions.path });
  R[code] = r;
}

async function user(key: string, role: string, regionCode: string | null) {
  const [u] = await db.insert(users).values({ email: `${key}@test.demo`, name: key, passwordHash: 'x', isDemo: true }).returning({ id: users.id });
  const [ro] = await db.select().from(roles).where(eq(roles.key, role));
  await db.insert(userRoles).values({ userId: u.id, roleId: ro.id, regionId: regionCode ? R[regionCode].id : null });
  U[key] = (await loadUser(db, u.id))!;
}

async function run(scenario: 'replay' | 'live', issuedFor: string) {
  const [m] = await db.select().from(modelVersions).limit(1);
  const [r] = await db
    .insert(forecastRuns)
    .values({ modelVersionId: m.id, scenario, issuedFor, horizonDays: 7, status: 'succeeded', isHindcast: scenario === 'replay', triggeredBy: 'test' })
    .returning({ id: forecastRuns.id });
  return r.id;
}

async function fc(runId: string, issuedFor: string, code: string, h: number, severity: Severity, tmax: number, score: number) {
  await db.insert(forecasts).values({
    runId,
    regionId: R[code].id,
    targetDate: addDays(issuedFor, h),
    horizonDay: h,
    resolution: 'district-centroid (point)',
    predictedTmaxC: tmax,
    lowerC: tmax - 2,
    upperC: tmax + 2,
    normalTmaxC: 40,
    departureC: tmax - 40,
    severity,
    imdCategory: severity === 'extreme' ? 'severe_heatwave' : severity === 'high' ? 'heatwave' : 'none',
    confidence: score >= 0.62 ? 'high' : score >= 0.42 ? 'medium' : 'low',
    confidenceScore: score,
    durationDays: severity === 'high' || severity === 'extreme' ? 2 : 0,
    factors: [],
    inputKinds: ['reanalysis', 'climatology', 'nwp_forecast'],
  });
}

const ISSUED = '2024-05-26';
let runId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedReference(db);
  await region('IN', 'country', null);
  await region('IN-RJ', 'state', 'IN');
  await region('IN-RJ-CHURU', 'district', 'IN-RJ');
  await region('IN-RJ-JAIPUR', 'district', 'IN-RJ');
  await region('IN-HR', 'state', 'IN');
  await region('IN-UP', 'state', 'IN');
  await region('IN-UP-BANDA', 'district', 'IN-UP');
  await user('admin', 'system_admin', null);
  await user('rj_admin', 'state_admin', 'IN-RJ');
  await user('jaipur_field', 'field_responder', 'IN-RJ-JAIPUR');
  await user('up_official', 'disaster_official', 'IN-UP');
  await user('citizen', 'public', null);

  runId = await run('replay', ISSUED);
  await fc(runId, ISSUED, 'IN-RJ-CHURU', 1, 'high', 45.8, 0.75);
  await fc(runId, ISSUED, 'IN-RJ-CHURU', 2, 'extreme', 47.1, 0.6); // peak → the Churu alert
  await fc(runId, ISSUED, 'IN-RJ-JAIPUR', 1, 'high', 45.2, 0.7);
  await fc(runId, ISSUED, 'IN-RJ', 1, 'extreme', 46.9, 0.7); // pilot state (has districts) → no state alert
  await fc(runId, ISSUED, 'IN-HR', 2, 'high', 45.5, 0.55); // non-pilot state → state-level alert
  await fc(runId, ISSUED, 'IN-UP-BANDA', 1, 'moderate', 44.0, 0.8); // below min severity
  await fc(runId, ISSUED, 'IN-UP-BANDA', 3, 'extreme', 47.5, 0.3); // below min confidence
  await fc(runId, ISSUED, 'IN-UP-BANDA', 6, 'extreme', 47.9, 0.6); // beyond max horizon
});
afterAll(async () => close());

describe('alert rules (pure)', () => {
  it('applies severity, confidence and horizon thresholds', () => {
    const cfg = DEFAULT_ALERT_CONFIG;
    expect(qualifies({ severity: 'high', confidenceScore: 0.45, horizonDay: 5 }, cfg)).toBe(true);
    expect(qualifies({ severity: 'moderate', confidenceScore: 0.9, horizonDay: 1 }, cfg)).toBe(false);
    expect(qualifies({ severity: 'extreme', confidenceScore: 0.44, horizonDay: 1 }, cfg)).toBe(false);
    expect(qualifies({ severity: 'extreme', confidenceScore: 0.9, horizonDay: 6 }, cfg)).toBe(false);
    expect(qualifies({ severity: 'extreme', confidenceScore: 0.9, horizonDay: 0 }, cfg)).toBe(false);
  });

  it('parses app_config defensively', () => {
    expect(parseAlertConfig({ 'alerts.min_severity': 'extreme', 'alerts.min_confidence': 0.6, 'alerts.max_horizon_days': 3, 'alerts.cooldown_hours': 12 })).toEqual({
      minSeverity: 'extreme',
      minConfidence: 0.6,
      maxHorizonDays: 3,
      cooldownHours: 12,
    });
    expect(parseAlertConfig({ 'alerts.min_severity': 'bogus', 'alerts.min_confidence': 7 })).toEqual(DEFAULT_ALERT_CONFIG);
  });

  it('aggregates to one peak alert per region', () => {
    const base = { regionId: 1, code: 'X', name: 'X', level: 'district' as const, parentId: 9, path: 'IN/X', confidence: 'high' as const, lowerC: 0, upperC: 99, normalTmaxC: 40, departureC: 5, durationDays: 1, resolution: 'p' };
    const out = aggregateCandidates(
      [
        { ...base, forecastId: 1, targetDate: '2024-05-27', horizonDay: 1, severity: 'high', confidenceScore: 0.8, predictedTmaxC: 46 },
        { ...base, forecastId: 2, targetDate: '2024-05-28', horizonDay: 2, severity: 'extreme', confidenceScore: 0.6, predictedTmaxC: 45.5 },
        { ...base, forecastId: 3, targetDate: '2024-05-29', horizonDay: 3, severity: 'extreme', confidenceScore: 0.5, predictedTmaxC: 47 },
      ],
      DEFAULT_ALERT_CONFIG,
      new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0].forecastId).toBe(3);
    expect(out[0].qualifyingDays).toBe(3);
  });
});

describe('evaluateAlerts', () => {
  beforeEach(async () => {
    await db.update(appConfig).set({ value: 'high' }).where(eq(appConfig.key, 'alerts.min_severity'));
  });

  it('creates one alert per qualifying region with dedup keys, forecast links and audit entries', async () => {
    const res = await evaluateAlerts(db, runId);
    expect(res.created).toBe(3);
    const rows = await db.select().from(alerts);
    const keys = rows.map((r) => r.dedupKey).sort();
    expect(keys).toEqual(['replay:IN-HR:2024-05-28:high', 'replay:IN-RJ-CHURU:2024-05-28:extreme', 'replay:IN-RJ-JAIPUR:2024-05-27:high']);
    expect(rows.every((r) => r.forecastId != null && r.status === 'active')).toBe(true);
    expect(rows.find((r) => r.dedupKey.includes('CHURU'))!.message).toMatch(/not an official IMD warning/);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'alert.create'));
    expect(audits).toHaveLength(3);
  });

  it('deduplicates on re-evaluation of the same run', async () => {
    const res = await evaluateAlerts(db, runId);
    expect(res).toMatchObject({ created: 0, skipped: 3 });
    expect((await db.select().from(alerts)).length).toBe(3);
  });

  it('fans out notifications only to users whose scope covers the region (never public)', async () => {
    const [churu] = await db.select().from(alerts).where(sql`${alerts.dedupKey} like '%CHURU%'`);
    const [jaipur] = await db.select().from(alerts).where(sql`${alerts.dedupKey} like '%JAIPUR%'`);
    const [hr] = await db.select().from(alerts).where(sql`${alerts.dedupKey} like '%IN-HR%'`);
    const who = async (alertId: string) =>
      (await db.select({ name: users.name }).from(notifications).innerJoin(users, eq(users.id, notifications.userId)).where(eq(notifications.alertId, alertId)))
        .map((r) => r.name)
        .sort();
    expect(await who(churu.id)).toEqual(['admin', 'rj_admin']);
    expect(await who(jaipur.id)).toEqual(['admin', 'jaipur_field', 'rj_admin']);
    expect(await who(hr.id)).toEqual(['admin']);
    const citizen = await db.select().from(notifications).where(eq(notifications.userId, U.citizen.id));
    expect(citizen).toHaveLength(0);
  });

  it('respects the cooldown after an alert is resolved', async () => {
    const [churu] = await db.select().from(alerts).where(sql`${alerts.dedupKey} like '%CHURU%'`);
    await resolveAlert(db, U.rj_admin, churu.id, 'handled');
    // within cooldown → not re-raised
    expect((await evaluateAlerts(db, runId)).created).toBe(0);
    // cooldown elapsed → re-raised as a new open alert
    await db.update(alerts).set({ resolvedAt: new Date(Date.now() - 48 * 3600_000) }).where(eq(alerts.id, churu.id));
    const res = await evaluateAlerts(db, runId);
    expect(res.created).toBe(1);
    const open = await db.select().from(alerts).where(and(sql`${alerts.dedupKey} like '%CHURU%'`, eq(alerts.status, 'active')));
    expect(open).toHaveLength(1);
  });

  it('reads thresholds from app_config', async () => {
    await db.delete(notifications);
    await db.delete(alerts);
    await db.update(appConfig).set({ value: 'extreme' }).where(eq(appConfig.key, 'alerts.min_severity'));
    const res = await evaluateAlerts(db, runId);
    expect(res.created).toBe(1);
    const [only] = await db.select().from(alerts);
    expect(only.severity).toBe('extreme');
    expect((only.rule as { thresholds: { minSeverity: string } }).thresholds.minSeverity).toBe('extreme');
  });

  it('expires open alerts of the same scenario whose day has passed', async () => {
    const liveRun = await run('live', '2026-10-03');
    await db.insert(alerts).values({ regionId: R['IN-HR'].id, severity: 'high', title: 't', message: 'm', targetDate: '2026-09-30', dedupKey: 'live:IN-HR:2026-09-30:high', confidenceScore: 0.5 });
    const res = await evaluateAlerts(db, liveRun);
    expect(res.expired).toBe(1);
    const [old] = await db.select().from(alerts).where(eq(alerts.dedupKey, 'live:IN-HR:2026-09-30:high'));
    expect(old.status).toBe('expired');
    // replay alerts are untouched by a live run
    expect((await db.select().from(alerts).where(sql`${alerts.dedupKey} like 'replay:%'`)).every((a) => a.status === 'active')).toBe(true);
  });
});

describe('alert workflow & scoping', () => {
  it('lists alerts within the user scope only', async () => {
    await db.delete(notifications);
    await db.delete(alerts);
    await db.update(appConfig).set({ value: 'high' }).where(eq(appConfig.key, 'alerts.min_severity'));
    await evaluateAlerts(db, runId);
    const field = await listAlerts(db, U.jaipur_field, { scenario: 'replay' });
    expect(field.items.map((a) => a.regionCode)).toEqual(['IN-RJ-JAIPUR']);
    const up = await listAlerts(db, U.up_official, { scenario: 'replay' });
    expect(up.items).toHaveLength(0);
    const all = await listAlerts(db, U.admin, { scenario: 'replay' });
    expect(all.total).toBe(3);
    expect((await listAlerts(db, U.citizen)).items).toHaveLength(0);
  });

  it('enforces acknowledge/resolve permissions by region', async () => {
    const [jaipur] = await db.select().from(alerts).where(sql`${alerts.dedupKey} like '%JAIPUR%'`);
    // field responders can view but not acknowledge
    await expect(acknowledgeAlert(db, U.jaipur_field, jaipur.id)).rejects.toBeInstanceOf(DomainError);
    // other-state officials cannot act
    await expect(acknowledgeAlert(db, U.up_official, jaipur.id)).rejects.toMatchObject({ status: 403 });
    await acknowledgeAlert(db, U.rj_admin, jaipur.id);
    await expect(acknowledgeAlert(db, U.rj_admin, jaipur.id)).rejects.toMatchObject({ status: 409 });
    await resolveAlert(db, U.rj_admin, jaipur.id);
    const [after] = await db.select().from(alerts).where(eq(alerts.id, jaipur.id));
    expect(after.status).toBe('resolved');
    expect(after.resolvedAt).toBeInstanceOf(Date);
  });
});
