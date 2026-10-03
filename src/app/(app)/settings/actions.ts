'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { requireUser } from '@/server/auth/dal';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { audit } from '@/server/audit/log';

export type FormState = { ok?: string; error?: string } | undefined;

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name must have at least 2 characters').max(80),
  designation: z.string().trim().max(120).optional().transform((v) => v || null),
});

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const db = getDb();
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  await audit(db, { actor: user, action: 'user.profile_update', entityType: 'user', entityId: user.id, before: { name: user.name, designation: user.designation }, after: parsed.data });
  revalidatePath('/', 'layout');
  return { ok: 'Profile updated.' };
}

const passwordSchema = z
  .object({
    current: z.string().min(1, 'Enter your current password'),
    next: z.string().min(10, 'Use at least 10 characters').max(200),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: 'The new passwords do not match', path: ['confirm'] });

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (user.isDemo) return { error: 'Demo accounts share a published password, so it cannot be changed.' };
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const db = getDb();
  const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(parsed.data.current, row.hash))) return { error: 'Current password is incorrect.' };
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.next) }).where(eq(users.id, user.id));
  await audit(db, { actor: user, action: 'user.password_change', entityType: 'user', entityId: user.id });
  return { ok: 'Password changed.' };
}
