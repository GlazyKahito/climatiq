'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { requireUser } from '@/server/auth/dal';
import { markRead, markUnread } from '@/server/notifications/inbox';

/** Used by the top bar and the Notifications tab. Only the caller's own notifications are affected. */
export async function markNotificationsRead(ids: string[] | 'all') {
  const user = await requireUser();
  const parsed = ids === 'all' ? 'all' : z.array(z.string().uuid()).max(200).parse(ids);
  await markRead(getDb(), user.id, parsed);
  revalidatePath('/', 'layout');
}

export async function markNotificationsUnread(ids: string[]) {
  const user = await requireUser();
  await markUnread(getDb(), user.id, z.array(z.string().uuid()).min(1).max(200).parse(ids));
  revalidatePath('/', 'layout');
}
