'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { appConfig, severityThresholds } from '@/server/db/schema';
import { AuthError, authorize } from '@/server/auth/dal';
import { HttpError } from '@/server/http';
import { createUser, grantRole, revokeAssignment, setUserActive } from '@/server/admin/users';
import { refreshLiveGrid, refreshRecentHistory, applyRetention } from '@/server/ingestion/runner';
import { runForecast } from '@/server/forecasting/run';
import { resetDemo, RESET_PHRASE } from '@/server/demo/reset';
import { env } from '@/server/config/env';
import { audit } from '@/server/audit/log';
import { ROLES, type RoleKey } from '@/lib/rbac';

export type ActionState = { ok?: string; error?: string } | undefined;

async function guard<T>(fn: () => Promise<T>, okMessage: (r: T) => string): Promise<ActionState> {
  try {
    const r = await fn();
    revalidatePath('/admin');
    return { ok: okMessage(r) };
  } catch (e) {
    if (e instanceof AuthError || e instanceof HttpError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? 'Invalid input' };
    console.error('[admin action]', e);
    return { error: 'The action failed. Please retry.' };
  }
}

const roleKey = z.enum(Object.keys(ROLES) as [RoleKey, ...RoleKey[]]);
const regionCode = z
  .string()
  .trim()
  .max(80)
  .transform((v) => (v ? v.toUpperCase() : null));

export async function grantRoleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const actor = await authorize('admin:users');
    const input = z.object({ userId: z.string().uuid(), roleKey, regionCode }).parse(Object.fromEntries(fd));
    await grantRole(getDb(), actor, input.userId, input.roleKey, input.regionCode);
  }, () => 'Role granted.');
}

export async function revokeAssignmentAction(fd: FormData) {
  const actor = await authorize('admin:users');
  const id = z.coerce.number().int().parse(fd.get('assignmentId'));
  await revokeAssignment(getDb(), actor, id);
  revalidatePath('/admin');
}

export async function setActiveAction(fd: FormData) {
  const actor = await authorize('admin:users');
  const input = z.object({ userId: z.string().uuid(), active: z.enum(['true', 'false']) }).parse(Object.fromEntries(fd));
  await setUserActive(getDb(), actor, input.userId, input.active === 'true');
  revalidatePath('/admin');
}

export async function createUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const actor = await authorize('admin:users');
    const input = z
      .object({
        name: z.string().trim().min(2, 'Name is required').max(80),
        email: z.string().trim().email('Valid email required').max(200),
        designation: z.string().trim().max(120).optional(),
        password: z.string().min(10, 'Temporary password must have at least 10 characters').max(200),
        roleKey,
        regionCode,
      })
      .parse(Object.fromEntries(fd));
    return createUser(getDb(), actor, input);
  }, () => 'User created. Share the temporary password through a secure channel.');
}

const JOBS = ['history', 'grid', 'forecast', 'retention'] as const;

export async function runJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const job = z.enum(JOBS).parse(fd.get('job'));
    const db = getDb();
    if (job === 'forecast') {
      const user = await authorize('forecast:run');
      const r = await runForecast(db, { scenario: 'live', triggeredBy: `admin:${user.id}` });
      if (r.status === 'failed') throw new HttpError(502, `Forecast run failed: ${r.error ?? 'unknown error'}`);
      return `Live forecast run ${r.status} for ${r.regions} regions.`;
    }
    const user = await authorize('ingestion:run');
    if (job === 'retention') {
      const r = await applyRetention(db);
      await audit(db, { actor: user, action: 'retention.apply', entityType: 'system', after: r });
      return `Retention applied: ${r.notifications} notifications and ${r.forecastRuns} old forecast runs removed.`;
    }
    const r = job === 'history' ? await refreshRecentHistory(db, `admin:${user.id}`) : await refreshLiveGrid(db, `admin:${user.id}`);
    if (r.status === 'failed') throw new HttpError(502, `Ingestion failed: ${r.error}`);
    return `${r.job} ingestion ${r.status}: ${r.written} records written.`;
  }, (m) => m);
}

export async function updateConfigAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await authorize('config:edit');
    const input = z
      .object({
        'alerts.min_severity': z.enum(['moderate', 'high', 'extreme']),
        'alerts.min_confidence': z.coerce.number().min(0).max(1),
        'alerts.max_horizon_days': z.coerce.number().int().min(1).max(7),
        'alerts.cooldown_hours': z.coerce.number().int().min(0).max(168),
      })
      .parse(Object.fromEntries(fd));
    const db = getDb();
    const before = await db.select().from(appConfig);
    for (const [key, value] of Object.entries(input)) {
      await db.update(appConfig).set({ value, updatedAt: new Date(), updatedBy: user.id }).where(eq(appConfig.key, key));
    }
    await audit(db, { actor: user, action: 'config.update', entityType: 'app_config', before: Object.fromEntries(before.map((b) => [b.key, b.value])), after: input });
  }, () => 'Alert rules updated. They apply from the next forecast run.');
}

export async function updateThresholdAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await authorize('config:edit');
    const num = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().min(-10).max(60).nullable());
    const input = z.object({ id: z.coerce.number().int(), minTmaxC: num, minDepartureC: num, absoluteTmaxC: num }).parse(Object.fromEntries(fd));
    const db = getDb();
    const [before] = await db.select().from(severityThresholds).where(eq(severityThresholds.id, input.id));
    if (!before) throw new HttpError(404, 'Threshold not found');
    await db
      .update(severityThresholds)
      .set({ minTmaxC: input.minTmaxC, minDepartureC: input.minDepartureC, absoluteTmaxC: input.absoluteTmaxC, updatedAt: new Date() })
      .where(eq(severityThresholds.id, input.id));
    await audit(db, { actor: user, action: 'threshold.update', entityType: 'severity_threshold', entityId: input.id, before, after: input });
  }, () => 'Threshold saved. It applies from the next forecast run.');
}

export async function resetDemoAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    if (!env().DEMO_MODE) throw new HttpError(403, 'Demo reset is only available in demo mode');
    const user = await authorize('demo:reset');
    if (fd.get('confirm') !== RESET_PHRASE) throw new HttpError(400, `Type ${RESET_PHRASE} to confirm`);
    return resetDemo(getDb(), user);
  }, (r) => `Demo reset complete: removed ${Object.entries(r.removed).map(([k, v]) => `${v} ${k}`).join(', ')}; re-seeded ${r.reseeded.join(' and ')}.`);
}
