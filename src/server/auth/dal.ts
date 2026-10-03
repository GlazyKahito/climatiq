import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { regions } from '../db/schema';
import { readSession } from './session';
import { loadUser, type AppUser } from './users';
import { can, type Permission } from '@/lib/rbac';

export type { AppUser };

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/** Current user for this request (memoised per request). Re-reads roles from the database every request. */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const session = await readSession();
  if (!session) return null;
  return loadUser(getDb(), session.uid);
});

/** For pages: redirect to /login when signed out. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** For pages: render 403 state instead of the module when the permission is missing. */
export async function requirePagePermission(perm: Permission): Promise<AppUser> {
  const user = await requireUser();
  if (!can(user.assignments, perm)) redirect(`/forbidden?need=${encodeURIComponent(perm)}`);
  return user;
}

const regionPathCache = new Map<number, string>();

export async function regionPath(regionId: number): Promise<string | null> {
  const hit = regionPathCache.get(regionId);
  if (hit) return hit;
  const [r] = await getDb().select({ path: regions.path }).from(regions).where(eq(regions.id, regionId)).limit(1);
  if (r) regionPathCache.set(regionId, r.path);
  return r?.path ?? null;
}

/**
 * Server-side authorisation for actions and API routes. Throws AuthError (401/403).
 * When `regionId` is given, the user must hold `perm` on that region or an ancestor.
 */
export async function authorize(perm: Permission, regionId?: number | null): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, 'Sign-in required');
  const path = regionId != null ? await regionPath(regionId) : null;
  if (regionId != null && !path) throw new AuthError(403, 'Unknown region');
  if (!can(user.assignments, perm, path)) throw new AuthError(403, `Missing permission ${perm}`);
  return user;
}
