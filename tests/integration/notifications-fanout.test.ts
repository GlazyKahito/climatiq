import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { alerts, notifications, regions, roles, userRoles, users } from '@/server/db/schema';
import { seedReference } from '@/server/db/seed/reference';
import { InAppChannel, notifyUsers } from '@/server/notifications/channels';
import { permissionHolders, recipientsFor, usersWithPermissionOn } from '@/server/notifications/recipients';
import { inboxFor, listNotifications, markRead, markUnread } from '@/server/notifications/inbox';

let db: DB;
let close: () => Promise<void>;
const R: Record<string, { id: number; path: string }> = {};
const U: Record<string, string> = {};

async function region(code: string, level: 'country' | 'state' | 'district', parent: string | null) {
  const p = parent ? R[parent] : null;
  const [r] = await db
    .insert(regions)
    .values({ code, name: code, level, parentId: p?.id ?? null, path: p ? `${p.path}/${code}` : code, lat: 20, lon: 78, geoSource: 'test' })
    .returning({ id: regions.id, path: regions.path });
  R[code] = r;
}
async function user(key: string, role: string, regionCode: string | null, active = true) {
  const [u] = await db.insert(users).values({ email: `${key}@t.demo`, name: key, passwordHash: 'x', isActive: active }).returning({ id: users.id });
  const [ro] = await db.select().from(roles).where(eq(roles.key, role));
  await db.insert(userRoles).values({ userId: u.id, roleId: ro.id, regionId: regionCode ? R[regionCode].id : null });
  U[key] = u.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedReference(db);
  await region('IN', 'country', null);
  await region('IN-RJ', 'state', 'IN');
  await region('IN-RJ-JAIPUR', 'district', 'IN-RJ');
  await region('IN-RJ-JAIPURX', 'district', 'IN-RJ'); // prefix trap: must not match the JAIPUR scope
  await region('IN-OR', 'state', 'IN');
  await user('national', 'climate_analyst', null);
  await user('state', 'state_admin', 'IN-RJ');
  await user('district', 'district_admin', 'IN-RJ-JAIPUR');
  await user('field', 'field_responder', 'IN-RJ-JAIPUR');
  await user('odisha', 'response_team', 'IN-OR');
  await user('citizen', 'public', null);
  await user('inactive', 'system_admin', null, false);
});
afterAll(async () => close());

describe('recipient resolution', () => {
  it('matches assignment scopes equal to or above the region, skipping public and inactive users', async () => {
    const ids = await usersWithPermissionOn(db, 'alert:view', R['IN-RJ-JAIPUR'].path);
    const names = Object.entries(U).filter(([, id]) => ids.includes(id)).map(([k]) => k).sort();
    expect(names).toEqual(['district', 'field', 'national', 'state']);
  });

  it('does not treat sibling regions sharing a code prefix as within scope', async () => {
    const ids = await usersWithPermissionOn(db, 'alert:view', R['IN-RJ-JAIPURX'].path);
    expect(ids).not.toContain(U.district);
    expect(ids).not.toContain(U.field);
    expect(ids).toContain(U.state);
  });

  it('a state-level region does not reach district-scoped users', async () => {
    const holders = await permissionHolders(db, 'alert:view');
    const ids = recipientsFor(holders, R['IN-RJ'].path);
    expect(ids).toContain(U.state);
    expect(ids).not.toContain(U.district);
    expect(recipientsFor(holders, R['IN-OR'].path, [U.national])).toEqual([U.odisha]);
  });
});

describe('in-app channel', () => {
  it('stores at most one notification per (user, alert)', async () => {
    const [a] = await db
      .insert(alerts)
      .values({ regionId: R['IN-RJ-JAIPUR'].id, severity: 'high', title: 'High heat', message: 'm', targetDate: '2024-05-27', dedupKey: 'replay:J:1:high', confidenceScore: 0.6 })
      .returning();
    const ch = new InAppChannel();
    const first = await ch.deliver(db, [U.state, U.field, U.field], { kind: 'alert', severity: 'high', title: 'A', body: 'b', alertId: a.id, regionId: R['IN-RJ-JAIPUR'].id, link: `/alerts/${a.id}` });
    expect(first).toMatchObject({ delivered: 2, skipped: 0 });
    const again = await notifyUsers(db, [U.state, U.field, U.district], { kind: 'alert', severity: 'high', title: 'A', body: 'b', alertId: a.id, regionId: R['IN-RJ-JAIPUR'].id });
    expect(again[0]).toMatchObject({ channel: 'in_app', delivered: 1, skipped: 2 });
    expect((await db.select().from(notifications).where(eq(notifications.alertId, a.id))).length).toBe(3);
  });

  it('allows repeated non-alert notifications', async () => {
    await notifyUsers(db, [U.field], { kind: 'incident', title: 'Task', body: 'x' });
    await notifyUsers(db, [U.field], { kind: 'incident', title: 'Task', body: 'y' });
    const inbox = await inboxFor(db, U.field);
    expect(inbox.items.filter((i) => i.kind === 'incident')).toHaveLength(2);
  });
});

describe('inbox & notification list', () => {
  it('filters, counts and marks read/unread only for the owner', async () => {
    const list = await listNotifications(db, U.field, { status: 'unread' });
    expect(list.unread).toBe(3);
    expect(list.items.every((i) => !i.read)).toBe(true);
    const alertsOnly = await listNotifications(db, U.field, { kind: 'alert', severity: 'high' });
    expect(alertsOnly.total).toBe(1);
    expect(alertsOnly.items[0].regionCode).toBe('IN-RJ-JAIPUR');
    const byRegion = await listNotifications(db, U.field, { region: 'IN-RJ' });
    expect(byRegion.total).toBe(1);

    // Another user cannot mark this user's notifications.
    await markRead(db, U.state, [alertsOnly.items[0].id]);
    expect((await listNotifications(db, U.field, { status: 'unread' })).unread).toBe(3);

    await markRead(db, U.field, [alertsOnly.items[0].id]);
    expect((await inboxFor(db, U.field)).unread).toBe(2);
    await markUnread(db, U.field, [alertsOnly.items[0].id]);
    expect((await inboxFor(db, U.field)).unread).toBe(3);
    await markRead(db, U.field, 'all');
    expect((await inboxFor(db, U.field)).unread).toBe(0);
    expect((await listNotifications(db, U.field, { status: 'read' })).total).toBe(3);
  });
});
