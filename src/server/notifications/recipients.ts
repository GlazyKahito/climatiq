/**
 * Recipient resolution: who holds a permission on a region (assignment scope equal to or an ancestor of the region).
 * The `public` role never receives operational notifications.
 */
import { and, eq, ne } from 'drizzle-orm';
import type { DB } from '../db/types';
import { regions, rolePermissions, roles, userRoles, users } from '../db/schema';
import { pathWithin, type Permission } from '@/lib/rbac';

export type PermissionHolder = { userId: string; scopePath: string | null };

/** All active users holding `perm`, with each assignment's scope path (null = nationwide). */
export async function permissionHolders(db: DB, perm: Permission): Promise<PermissionHolder[]> {
  const rows = await db
    .select({ userId: users.id, scopePath: regions.path })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.permissionKey, perm)))
    .leftJoin(regions, eq(regions.id, userRoles.regionId))
    .where(and(eq(users.isActive, true), ne(roles.key, 'public')));
  return rows.map((r) => ({ userId: r.userId, scopePath: r.scopePath ?? null }));
}

/** Users among `holders` whose scope covers `regionPath`. */
export function recipientsFor(holders: PermissionHolder[], regionPath: string, exclude: string[] = []): string[] {
  const out = new Set<string>();
  for (const h of holders) if (pathWithin(regionPath, h.scopePath)) out.add(h.userId);
  for (const x of exclude) out.delete(x);
  return [...out];
}

export async function usersWithPermissionOn(db: DB, perm: Permission, regionPath: string, exclude: string[] = []) {
  return recipientsFor(await permissionHolders(db, perm), regionPath, exclude);
}
