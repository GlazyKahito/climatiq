'use server';

import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { createSession, deleteSession } from '@/server/auth/session';
import { dummyHash, verifyPassword } from '@/server/auth/password';
import { env } from '@/server/config/env';
import { audit } from '@/server/audit/log';
import { getCurrentUser } from '@/server/auth/dal';
import { rateLimit } from '@/server/http';

export type LoginState = { error?: string; email?: string } | undefined;

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
  next: z.string().optional(),
});

function safeNext(next: string | undefined) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/command';
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email: String(formData.get('email') ?? '') };
  const { email, password, next } = parsed.data;
  try {
    rateLimit(`login:${email.toLowerCase()}`, 8, 60_000);
  } catch {
    return { error: 'Too many attempts. Please wait a minute and try again.', email };
  }
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  // Constant-ish failure path: always run a bcrypt compare to avoid user enumeration by timing.
  const ok = await verifyPassword(password, u?.passwordHash ?? dummyHash());
  if (!u || !ok || !u.isActive) return { error: 'Email or password is incorrect.', email };
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await createSession(u.id, false);
  await audit(db, { actor: { id: u.id, name: u.name }, action: 'auth.login', entityType: 'user', entityId: u.id });
  redirect(safeNext(next));
}

/** One-click demo sign-in. Only available when DEMO_MODE=true, and only for accounts flagged as demo accounts. */
export async function demoLogin(formData: FormData) {
  if (!env().DEMO_MODE) throw new Error('Demo mode is disabled');
  const userId = z.string().uuid().parse(formData.get('userId'));
  const next = safeNext(formData.get('next')?.toString());
  const db = getDb();
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.isDemo, true), eq(users.isActive, true))).limit(1);
  if (!u) throw new Error('Unknown demo account');
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await createSession(u.id, true);
  await audit(db, { actor: { id: u.id, name: u.name }, action: 'auth.demo_login', entityType: 'user', entityId: u.id });
  redirect(next);
}

export async function logout() {
  const user = await getCurrentUser();
  await deleteSession();
  if (user) await audit(getDb(), { actor: { id: user.id, name: user.name }, action: 'auth.logout', entityType: 'user', entityId: user.id });
  redirect('/login');
}

export async function setTheme(theme: 'light' | 'dark' | 'system') {
  const value = z.enum(['light', 'dark', 'system']).parse(theme);
  (await cookies()).set('cq_theme', value, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  const user = await getCurrentUser();
  if (user) await getDb().update(users).set({ themePref: value }).where(eq(users.id, user.id));
}

export async function setScenario(scenario: 'live' | 'replay') {
  const value = z.enum(['live', 'replay']).parse(scenario);
  (await cookies()).set('cq_scenario', value, { path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'lax' });
}
