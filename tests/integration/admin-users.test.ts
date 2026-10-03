import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { userRoles, users } from '@/server/db/schema';
import { seedReference } from '@/server/db/seed/reference';
import { seedGeography } from '@/server/db/seed/geography';
import { seedPeople } from '@/server/db/seed/people';
import { loadUser, type AppUser } from '@/server/auth/users';
import { createUser, grantRole, listManagedUsers, revokeAssignment, setUserActive } from '@/server/admin/users';

let db: DB;
let close: () => Promise<void>;
const byEmail = async (email: string) => {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await loadUser(db, u.id)) as AppUser;
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedReference(db);
  await seedGeography(db);
  await seedPeople(db);
});
afterAll(async () => close());

describe('user administration (anti-escalation)', () => {
  it('state admin cannot grant a more senior role', async () => {
    const actor = await byEmail('kavya.rathore@climatiq.demo');
    const target = await byEmail('arjun.singh@climatiq.demo');
    await expect(grantRole(db, actor, target.id, 'system_admin', 'IN-RJ')).rejects.toThrow(/more senior/);
  });

  it('state admin cannot grant outside their state or nationwide', async () => {
    const actor = await byEmail('kavya.rathore@climatiq.demo');
    const target = await byEmail('arjun.singh@climatiq.demo');
    await expect(grantRole(db, actor, target.id, 'response_team', 'IN-MH')).rejects.toThrow(/outside your administrative scope/);
    await expect(grantRole(db, actor, target.id, 'response_team', null)).rejects.toThrow(/nationwide/);
  });

  it('state admin can grant a junior role inside their state', async () => {
    const actor = await byEmail('kavya.rathore@climatiq.demo');
    const target = await byEmail('arjun.singh@climatiq.demo');
    await grantRole(db, actor, target.id, 'field_responder', 'IN-RJ-JAIPUR');
    const reloaded = await loadUser(db, target.id);
    expect(reloaded!.assignments.some((a) => a.roleKey === 'field_responder' && a.regionCode === 'IN-RJ-JAIPUR')).toBe(true);
  });

  it('state admin only sees users in their state', async () => {
    const actor = await byEmail('kavya.rathore@climatiq.demo');
    const list = await listManagedUsers(db, actor);
    const emails = list.map((u) => u.email);
    expect(emails).toContain('arjun.singh@climatiq.demo');
    expect(emails).not.toContain('rohan.kulkarni@climatiq.demo');
  });

  it('system admin can create users and cannot deactivate themselves', async () => {
    const admin = await byEmail('aarav.mehta@climatiq.demo');
    const id = await createUser(db, admin, { name: 'Test Officer', email: 'test.officer@example.org', password: 'a-long-password', roleKey: 'climate_analyst', regionCode: null });
    expect(id).toBeTruthy();
    await expect(createUser(db, admin, { name: 'Dup', email: 'TEST.officer@example.org', password: 'a-long-password', roleKey: 'public', regionCode: null })).rejects.toThrow(/already exists/);
    await expect(setUserActive(db, admin, admin.id, false)).rejects.toThrow(/own account/);
  });

  it('users cannot remove their own last role', async () => {
    const admin = await byEmail('aarav.mehta@climatiq.demo');
    const [a] = await db.select().from(userRoles).where(eq(userRoles.userId, admin.id));
    await expect(revokeAssignment(db, admin, a.id)).rejects.toThrow(/last role/);
  });
});
