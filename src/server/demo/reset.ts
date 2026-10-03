/**
 * Safe demo reset.
 *  Removes: demo-flagged records (incidents → tasks/activities, advisories, alerts, notifications, simulated stations →
 *           observations) and records created by demo accounts during the demo; replay-scenario alerts.
 *  Restores: demo users' role assignments and active flags (from DEMO_USERS), then re-runs the `stations` and
 *           `operations` seed steps.
 *  Preserves: configuration and thresholds, climate history, forecast runs, non-demo users, the audit log.
 *  Only available when DEMO_MODE=true to users with `demo:reset`; requires the typed confirmation phrase.
 */
import { eq, inArray, like, or, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { advisories, alerts, incidents, notifications, roles, seedState, userRoles, users, weatherStations, regions } from '../db/schema';
import { DEMO_USERS } from '../db/seed/people';
import { runSeed, SEED_STEPS } from '../db/seed';
import { audit } from '../audit/log';

export const RESET_PHRASE = 'RESET DEMO';
const RESEEDED_STEPS = ['stations', 'operations'];

export async function resetDemo(db: DB, actor: { id: string; name: string }, log: (m: string) => void = () => {}) {
  const demoUsers = await db.select({ id: users.id }).from(users).where(eq(users.isDemo, true));
  const demoIds = demoUsers.map((u) => u.id);
  const byDemo = <T>(col: T) => (demoIds.length ? inArray(col as never, demoIds) : sql`false`);

  const removed: Record<string, number> = {};
  removed.notifications = (await db.delete(notifications).where(or(eq(notifications.isDemo, true), byDemo(notifications.userId))).returning({ id: notifications.id })).length;
  removed.incidents = (await db.delete(incidents).where(or(eq(incidents.isDemo, true), byDemo(incidents.openedBy))).returning({ id: incidents.id })).length;
  removed.alerts = (await db.delete(alerts).where(or(eq(alerts.isDemo, true), like(alerts.dedupKey, 'replay:%'))).returning({ id: alerts.id })).length;
  removed.advisories = (await db.delete(advisories).where(or(eq(advisories.isDemo, true), byDemo(advisories.generatedBy))).returning({ id: advisories.id })).length;
  removed.stations = (await db.delete(weatherStations).where(eq(weatherStations.isDemo, true)).returning({ id: weatherStations.id })).length;

  // Restore demo accounts' access exactly as seeded.
  if (demoIds.length) {
    await db.update(users).set({ isActive: true }).where(inArray(users.id, demoIds));
    await db.delete(userRoles).where(inArray(userRoles.userId, demoIds));
    const roleRows = await db.select().from(roles);
    const regionRows = await db.select({ id: regions.id, code: regions.code }).from(regions).where(inArray(regions.code, DEMO_USERS.map((u) => u.region).filter((c): c is string => !!c)));
    for (const d of DEMO_USERS) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email));
      if (!u) continue;
      await db
        .insert(userRoles)
        .values({ userId: u.id, roleId: roleRows.find((r) => r.key === d.role)!.id, regionId: d.region ? (regionRows.find((r) => r.code === d.region)?.id ?? null) : null })
        .onConflictDoNothing();
    }
  }

  await db.delete(seedState).where(inArray(seedState.step, RESEEDED_STEPS));
  await runSeed(db, { steps: SEED_STEPS.filter((s) => RESEEDED_STEPS.includes(s.key)), log });
  await audit(db, { actor, action: 'demo.reset', entityType: 'system', after: { removed, reseeded: RESEEDED_STEPS } });
  return { removed, reseeded: SEED_STEPS.filter((s) => RESEEDED_STEPS.includes(s.key)).map((s) => s.key) };
}

