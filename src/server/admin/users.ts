/**
 * User & access management with anti-escalation rules:
 *  - the actor needs `admin:users` on the target region (or nationwide for nationwide assignments);
 *  - the actor can only grant roles ranked at or below their own best rank (system admin = rank 1 can grant all);
 *  - nationwide (no-region) assignments can only be granted by a nationwide `admin:users` holder;
 *  - users cannot remove their own last admin assignment or deactivate themselves.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { regions, roles, userRoles, users } from '../db/schema';
import { can, pathWithin, scopesFor, ROLES, type RoleKey } from '@/lib/rbac';
import type { AppUser } from '../auth/users';
import { hashPassword } from '../auth/password';
import { audit } from '../audit/log';
import { HttpError } from '../http';

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  isDemo: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  assignments: { id: number; roleKey: RoleKey; roleName: string; regionId: number | null; regionName: string | null; regionPath: string | null }[];
};

function bestRank(actor: AppUser) {
  return Math.min(...actor.assignments.filter((a) => a.permissions.includes('admin:users')).map((a) => ROLES[a.roleKey]?.rank ?? 99), 99);
}

/** Users visible to the actor: those with at least one assignment inside the actor's admin scopes (or none, for nationwide admins). */
export async function listManagedUsers(db: DB, actor: AppUser): Promise<ManagedUser[]> {
  const scopes = scopesFor(actor.assignments, 'admin:users');
  const nationwide = scopes.includes(null);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      designation: users.designation,
      isDemo: users.isDemo,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      urId: userRoles.id,
      roleKey: roles.key,
      roleName: roles.name,
      regionId: userRoles.regionId,
      regionName: regions.name,
      regionPath: regions.path,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(regions, eq(regions.id, userRoles.regionId))
    .orderBy(asc(users.name));
  const map = new Map<string, ManagedUser>();
  for (const r of rows) {
    const u = map.get(r.id) ?? {
      id: r.id,
      name: r.name,
      email: r.email,
      designation: r.designation,
      isDemo: r.isDemo,
      isActive: r.isActive,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      assignments: [],
    };
    if (r.urId != null && r.roleKey) {
      u.assignments.push({ id: r.urId, roleKey: r.roleKey as RoleKey, roleName: r.roleName ?? r.roleKey, regionId: r.regionId, regionName: r.regionName, regionPath: r.regionPath });
    }
    map.set(r.id, u);
  }
  const all = [...map.values()];
  if (nationwide) return all;
  return all.filter((u) => u.assignments.some((a) => a.regionPath && scopes.some((s) => pathWithin(a.regionPath!, s))));
}

async function regionPathById(db: DB, regionId: number | null) {
  if (regionId == null) return null;
  const [r] = await db.select({ path: regions.path }).from(regions).where(eq(regions.id, regionId));
  if (!r) throw new HttpError(404, 'Unknown region');
  return r.path;
}

function assertCanGrant(actor: AppUser, roleKey: RoleKey, regionPath: string | null) {
  if (regionPath === null && !scopesFor(actor.assignments, 'admin:users').includes(null)) throw new HttpError(403, 'Only nationwide administrators can grant nationwide roles');
  if (regionPath !== null && !can(actor.assignments, 'admin:users', regionPath)) throw new HttpError(403, 'Region is outside your administrative scope');
  const rank = ROLES[roleKey]?.rank;
  if (rank == null) throw new HttpError(400, 'Unknown role');
  if (rank < bestRank(actor)) throw new HttpError(403, 'You cannot grant a role more senior than your own');
}

export async function grantRole(db: DB, actor: AppUser, userId: string, roleKey: RoleKey, regionCode: string | null) {
  const regionId = regionCode ? (await db.select({ id: regions.id }).from(regions).where(eq(regions.code, regionCode)))[0]?.id : null;
  if (regionCode && !regionId) throw new HttpError(404, 'Unknown region code');
  const path = await regionPathById(db, regionId ?? null);
  assertCanGrant(actor, roleKey, path);
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey));
  await db.insert(userRoles).values({ userId, roleId: role.id, regionId: regionId ?? null }).onConflictDoNothing();
  await audit(db, { actor, action: 'user.role_grant', entityType: 'user', entityId: userId, regionId: regionId ?? null, after: { roleKey, regionCode } });
}

export async function revokeAssignment(db: DB, actor: AppUser, assignmentId: number) {
  const [a] = await db
    .select({ id: userRoles.id, userId: userRoles.userId, regionId: userRoles.regionId, roleKey: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.id, assignmentId));
  if (!a) throw new HttpError(404, 'Assignment not found');
  assertCanGrant(actor, a.roleKey as RoleKey, await regionPathById(db, a.regionId));
  if (a.userId === actor.id) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(and(eq(userRoles.userId, actor.id)));
    if (n <= 1) throw new HttpError(409, 'You cannot remove your own last role');
  }
  await db.delete(userRoles).where(eq(userRoles.id, assignmentId));
  await audit(db, { actor, action: 'user.role_revoke', entityType: 'user', entityId: a.userId, regionId: a.regionId, before: { roleKey: a.roleKey } });
}

export async function setUserActive(db: DB, actor: AppUser, userId: string, active: boolean) {
  if (userId === actor.id) throw new HttpError(409, 'You cannot deactivate your own account');
  const visible = await listManagedUsers(db, actor);
  if (!visible.some((u) => u.id === userId)) throw new HttpError(403, 'User is outside your administrative scope');
  await db.update(users).set({ isActive: active }).where(eq(users.id, userId));
  await audit(db, { actor, action: active ? 'user.activate' : 'user.deactivate', entityType: 'user', entityId: userId });
}

export async function createUser(
  db: DB,
  actor: AppUser,
  input: { name: string; email: string; designation?: string | null; password: string; roleKey: RoleKey; regionCode: string | null },
) {
  const regionId = input.regionCode ? (await db.select({ id: regions.id }).from(regions).where(eq(regions.code, input.regionCode)))[0]?.id : null;
  if (input.regionCode && !regionId) throw new HttpError(404, 'Unknown region code');
  assertCanGrant(actor, input.roleKey, await regionPathById(db, regionId ?? null));
  const existing = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, input.email.toLowerCase()));
  if (existing.length) throw new HttpError(409, 'A user with this email already exists');
  const [u] = await db
    .insert(users)
    .values({ name: input.name, email: input.email.toLowerCase(), designation: input.designation ?? null, passwordHash: await hashPassword(input.password) })
    .returning({ id: users.id });
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, input.roleKey));
  await db.insert(userRoles).values({ userId: u.id, roleId: role.id, regionId: regionId ?? null });
  await audit(db, { actor, action: 'user.create', entityType: 'user', entityId: u.id, regionId: regionId ?? null, after: { email: input.email, roleKey: input.roleKey, regionCode: input.regionCode } });
  return u.id;
}

export async function grantableRoles(actor: AppUser) {
  const rank = bestRank(actor);
  return (Object.keys(ROLES) as RoleKey[]).filter((k) => ROLES[k].rank >= rank).map((k) => ({ key: k, name: ROLES[k].name }));
}

