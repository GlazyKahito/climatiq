/**
 * Automated CLIMATIQ alert engine. Called by the forecast pipeline after every run (src/server/forecasting/run.ts),
 * by POST /api/v1/alerts/evaluate and by the demo seed.
 *
 *  1. read thresholds from app_config (alerts.min_severity / min_confidence / max_horizon_days / cooldown_hours);
 *  2. pick qualifying forecasts of the run and aggregate them (rules.ts: one alert per region per run, peak day;
 *     district-level for pilot districts, state-level otherwise);
 *  3. expire open alerts of the same scenario whose target date is before the run's issue date;
 *  4. dedup: skip when an open alert with the same key exists, or a resolved one was resolved within the cooldown;
 *  5. insert, audit, and fan out in-app notifications to users holding `alert:view` on the region.
 */
import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { alerts, appConfig, forecastRuns, forecasts, regions } from '../db/schema';
import { audit } from '../audit/log';
import { notifyUsers } from '../notifications/channels';
import { permissionHolders, recipientsFor } from '../notifications/recipients';
import { fmtDate, SEVERITY_META } from '@/lib/domain';
import { aggregateCandidates, dedupKey, parseAlertConfig, type AlertCandidate, type AlertConfig, type AlertForecastRow } from './rules';

export async function loadAlertConfig(db: DB): Promise<AlertConfig> {
  const rows = await db.select({ key: appConfig.key, value: appConfig.value }).from(appConfig).where(sql`${appConfig.key} like 'alerts.%'`);
  return parseAlertConfig(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

const t = (c: number) => `${c.toFixed(1)} °C`;

export function alertText(c: AlertCandidate & { parentName: string | null }, run: { scenario: string; issuedFor: string }) {
  const sev = SEVERITY_META[c.severity].label;
  const where = `${c.name}${c.parentName && c.level === 'district' ? `, ${c.parentName}` : ''}`;
  const title = `${sev} heat risk · ${where} · ${fmtDate(c.targetDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const origin =
    run.scenario === 'replay'
      ? `CLIMATIQ hindcast (historical replay, issued as of ${fmtDate(run.issuedFor)})`
      : `CLIMATIQ forecast issued ${fmtDate(run.issuedFor)}`;
  const dep = c.departureC != null ? `, ${c.departureC >= 0 ? '+' : '−'}${Math.abs(c.departureC).toFixed(1)} °C vs reference normal` : '';
  const spell = c.durationDays >= 2 ? ` ${c.durationDays}-day spell at High or above from that day.` : '';
  const level = c.granularity === 'state' ? ' State-level estimate (single centroid point).' : '';
  const message = `${origin}: predicted Tmax ${t(c.predictedTmaxC)} (band ${t(c.lowerC)}–${t(c.upperC)}) on ${fmtDate(c.targetDate)}${dep}.${spell} Confidence ${c.confidence} (heuristic ${c.confidenceScore.toFixed(2)}, not a probability).${level} Decision support — not an official IMD warning.`;
  return { title, message };
}

export type EvaluateOptions = { now?: Date; isDemo?: boolean; actor?: { id: string; name: string } | 'system' };

export async function evaluateAlerts(
  db: DB,
  runId: string,
  opts: EvaluateOptions = {},
): Promise<{ created: number; skipped: number; expired: number; notified: number }> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? 'system';
  const [run] = await db
    .select({ id: forecastRuns.id, scenario: forecastRuns.scenario, issuedFor: forecastRuns.issuedFor, status: forecastRuns.status })
    .from(forecastRuns)
    .where(eq(forecastRuns.id, runId))
    .limit(1);
  if (!run || (run.status !== 'succeeded' && run.status !== 'partial')) return { created: 0, skipped: 0, expired: 0, notified: 0 };

  const cfg = await loadAlertConfig(db);

  const rows = (await db
    .select({
      forecastId: forecasts.id,
      regionId: regions.id,
      code: regions.code,
      name: regions.name,
      level: regions.level,
      parentId: regions.parentId,
      path: regions.path,
      targetDate: forecasts.targetDate,
      horizonDay: forecasts.horizonDay,
      severity: forecasts.severity,
      confidence: forecasts.confidence,
      confidenceScore: forecasts.confidenceScore,
      predictedTmaxC: forecasts.predictedTmaxC,
      lowerC: forecasts.lowerC,
      upperC: forecasts.upperC,
      normalTmaxC: forecasts.normalTmaxC,
      departureC: forecasts.departureC,
      durationDays: forecasts.durationDays,
      resolution: forecasts.resolution,
    })
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(and(eq(forecasts.runId, run.id), gte(forecasts.horizonDay, 1), lte(forecasts.horizonDay, cfg.maxHorizonDays)))) as AlertForecastRow[];

  const districtParents = await db
    .selectDistinct({ parentId: regions.parentId })
    .from(forecasts)
    .innerJoin(regions, eq(regions.id, forecasts.regionId))
    .where(and(eq(forecasts.runId, run.id), eq(regions.level, 'district')));
  const statesWithDistricts = new Set(districtParents.map((d) => d.parentId).filter((x): x is number => x != null));

  const candidates = aggregateCandidates(rows, cfg, statesWithDistricts);

  // Expire open alerts of this scenario whose day has passed relative to this run.
  const expiredRows = await db
    .update(alerts)
    .set({ status: 'expired' })
    .where(
      and(
        sql`${alerts.dedupKey} like ${run.scenario + ':%'}`,
        inArray(alerts.status, ['active', 'acknowledged']),
        lt(alerts.targetDate, run.issuedFor),
      ),
    )
    .returning({ id: alerts.id });
  if (expiredRows.length) {
    await audit(db, { actor, action: 'alert.expire', entityType: 'alert', entityId: null, after: { runId: run.id, count: expiredRows.length } });
  }

  if (!candidates.length) return { created: 0, skipped: 0, expired: expiredRows.length, notified: 0 };

  const keys = candidates.map((c) => dedupKey(run.scenario, c.code, c.targetDate, c.severity));
  const existing = await db
    .select({ key: alerts.dedupKey, status: alerts.status, resolvedAt: alerts.resolvedAt })
    .from(alerts)
    .where(inArray(alerts.dedupKey, keys));
  const cooldownStart = new Date(now.getTime() - cfg.cooldownHours * 3600_000);
  const blocked = new Set(
    existing
      .filter((e) => e.status === 'active' || e.status === 'acknowledged' || (e.status === 'resolved' && e.resolvedAt != null && e.resolvedAt >= cooldownStart))
      .map((e) => e.key),
  );

  const parentIds = [...new Set(candidates.map((c) => c.parentId).filter((x): x is number => x != null))];
  const parents = parentIds.length ? await db.select({ id: regions.id, name: regions.name }).from(regions).where(inArray(regions.id, parentIds)) : [];
  const parentName = new Map(parents.map((p) => [p.id, p.name]));

  const holders = await permissionHolders(db, 'alert:view');
  let created = 0;
  let skipped = 0;
  let notified = 0;
  for (const c of candidates) {
    const key = dedupKey(run.scenario, c.code, c.targetDate, c.severity);
    if (blocked.has(key)) {
      skipped++;
      continue;
    }
    const { title, message } = alertText({ ...c, parentName: c.parentId != null ? (parentName.get(c.parentId) ?? null) : null }, run);
    const rule = {
      engine: 'climatiq-alerts-v1',
      runId: run.id,
      scenario: run.scenario,
      issuedFor: run.issuedFor,
      aggregation: 'peak-day-per-region',
      granularity: c.granularity,
      horizonDay: c.horizonDay,
      qualifyingDays: c.qualifyingDays,
      predictedTmaxC: c.predictedTmaxC,
      departureC: c.departureC,
      durationDays: c.durationDays,
      thresholds: cfg,
    };
    const [inserted] = await db
      .insert(alerts)
      .values({
        regionId: c.regionId,
        forecastId: c.forecastId,
        severity: c.severity,
        title,
        message,
        targetDate: c.targetDate,
        dedupKey: key,
        rule,
        confidenceScore: c.confidenceScore,
        isDemo: opts.isDemo ?? false,
        createdAt: now,
      })
      .onConflictDoNothing() // the partial unique index on open dedup keys guards against concurrent evaluations
      .returning({ id: alerts.id });
    if (!inserted) {
      skipped++;
      continue;
    }
    created++;
    await audit(db, {
      actor,
      action: 'alert.create',
      entityType: 'alert',
      entityId: inserted.id,
      regionId: c.regionId,
      after: { dedupKey: key, severity: c.severity, targetDate: c.targetDate, forecastId: c.forecastId, runId: run.id },
    });
    const recipients = recipientsFor(holders, c.path);
    const res = await notifyUsers(db, recipients, {
      kind: 'alert',
      severity: c.severity,
      title: `${SEVERITY_META[c.severity].label} heat alert · ${c.name}`,
      body: message,
      link: `/alerts/${inserted.id}`,
      regionId: c.regionId,
      alertId: inserted.id,
      isDemo: opts.isDemo ?? false,
      createdAt: now,
    });
    notified += res.reduce((n, r) => n + r.delivered, 0);
  }
  return { created, skipped, expired: expiredRows.length, notified };
}
