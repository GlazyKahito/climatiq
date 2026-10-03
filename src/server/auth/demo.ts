import { asc, eq } from 'drizzle-orm';
import type { DB } from '../db/types';
import { regions, roles, userRoles, users } from '../db/schema';
import { ROLES, type Assignment, type RoleKey } from '@/lib/rbac';

export type DemoAccount = { id: string; name: string; email: string; designation: string | null; roleKey: RoleKey; roleLabel: string; scopeLabel: string; rank: number };

/** Lists seeded fictional demo accounts (one per role/scope) for the one-click demo and role switcher. */
export async function listDemoAccounts(db: DB): Promise<DemoAccount[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      designation: users.designation,
      roleKey: roles.key,
      rank: roles.rank,
      regionName: regions.name,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(regions, eq(regions.id, userRoles.regionId))
    .where(eq(users.isDemo, true))
    .orderBy(asc(roles.rank), asc(users.name));
  const seen = new Set<string>();
  const out: DemoAccount[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      name: r.name,
      email: r.email,
      designation: r.designation,
      roleKey: r.roleKey as RoleKey,
      roleLabel: ROLES[r.roleKey as RoleKey]?.name ?? r.roleKey,
      scopeLabel: r.regionName ?? 'All India',
      rank: r.rank,
    });
  }
  return out;
}

export function describeScope(assignments: Assignment[]) {
  const a = assignments[0];
  if (!a) return { roleLabel: 'No role assigned', scopeLabel: '—' };
  return { roleLabel: ROLES[a.roleKey]?.name ?? a.roleKey, scopeLabel: a.regionName ?? 'All India' };
}
