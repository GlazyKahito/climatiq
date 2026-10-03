import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/types';
import { regions, rolePermissions, roles, userRoles, users } from '../db/schema';
import type { Assignment, Permission, RoleKey } from '@/lib/rbac';

export type AppUser = {
  id: string;
  email: string;
  name: string;
  designation: string | null;
  isDemo: boolean;
  themePref: string;
  assignments: Assignment[];
  /** Union of permissions across assignments (module-level access only — use `can()` with a region for actions). */
  permissions: Permission[];
  /** Primary role = highest-ranked assignment. */
  primaryRole: RoleKey | null;
};

/** Loads a user with role assignments and region scopes. Driver-agnostic (usable in tests). */
export async function loadUser(db: DB, userId: string): Promise<AppUser | null> {
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.isActive, true))).limit(1);
  if (!u) return null;

  const rows = await db
    .select({
      roleId: roles.id,
      roleKey: roles.key,
      rank: roles.rank,
      regionId: userRoles.regionId,
      regionCode: regions.code,
      regionName: regions.name,
      regionPath: regions.path,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(regions, eq(regions.id, userRoles.regionId))
    .where(eq(userRoles.userId, userId));

  const perms = await db.select().from(rolePermissions);
  const permsByRole = new Map<number, Permission[]>();
  for (const p of perms) {
    const list = permsByRole.get(p.roleId) ?? [];
    list.push(p.permissionKey as Permission);
    permsByRole.set(p.roleId, list);
  }

  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const assignments: Assignment[] = sorted.map((r) => ({
    roleKey: r.roleKey as RoleKey,
    regionId: r.regionId,
    regionCode: r.regionCode,
    regionName: r.regionName,
    regionPath: r.regionPath,
    permissions: permsByRole.get(r.roleId) ?? [],
  }));

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    designation: u.designation,
    isDemo: u.isDemo,
    themePref: u.themePref,
    assignments,
    permissions: [...new Set(assignments.flatMap((a) => a.permissions))],
    primaryRole: assignments[0]?.roleKey ?? null,
  };
}
