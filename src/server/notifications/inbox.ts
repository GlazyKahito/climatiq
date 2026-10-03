import { and, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/types';
import { notifications, regions } from '../db/schema';
import type { Severity } from '@/lib/domain';

export type InboxItem = {
  id: string;
  kind: string;
  severity: 'low' | 'moderate' | 'high' | 'extreme' | null;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
};

/** Latest notifications for the top-bar menu (signature used by the app shell — keep stable). */
export async function inboxFor(db: DB, userId: string, limit = 8): Promise<{ unread: number; items: InboxItem[] }> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return {
    unread: Number(n),
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      body: r.body,
      link: r.link,
      createdAt: r.createdAt.toISOString(),
      read: r.readAt != null,
    })),
  };
}

/** Marks the user's own notifications read (ids are always constrained to the user). Signature kept stable. */
export async function markRead(db: DB, userId: string, ids: string[] | 'all') {
  if (ids === 'all') {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return;
  }
  if (!ids.length) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids), isNull(notifications.readAt)));
}

export async function markUnread(db: DB, userId: string, ids: string[]) {
  if (!ids.length) return;
  await db
    .update(notifications)
    .set({ readAt: null })
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
}

export type NotificationFilters = {
  status?: 'all' | 'unread' | 'read';
  severity?: Severity;
  kind?: 'alert' | 'advisory' | 'incident' | 'system';
  /** Region code; matches notifications for that region or any region below it. */
  region?: string;
  limit?: number;
  offset?: number;
};

export type NotificationRow = InboxItem & { regionCode: string | null; regionName: string | null; readAt: string | null };

/** Full notification list for the Notifications tab / API, newest first, with filters and counts. */
export async function listNotifications(db: DB, userId: string, f: NotificationFilters = {}) {
  const conds: SQL[] = [eq(notifications.userId, userId)];
  if (f.status === 'unread') conds.push(isNull(notifications.readAt));
  if (f.status === 'read') conds.push(isNotNull(notifications.readAt));
  if (f.severity) conds.push(eq(notifications.severity, f.severity));
  if (f.kind) conds.push(eq(notifications.kind, f.kind));
  if (f.region) {
    conds.push(sql`exists (select 1 from regions fr where fr.id = "notifications"."region_id" and (fr.code = ${f.region} or fr.path like '%/' || ${f.region} || '/%' or fr.path like '%/' || ${f.region}))`);
  }
  const where = and(...conds);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      severity: notifications.severity,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      regionCode: regions.code,
      regionName: regions.name,
    })
    .from(notifications)
    .leftJoin(regions, eq(regions.id, notifications.regionId))
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(Math.max(f.offset ?? 0, 0));
  const [{ total }] = await db.select({ total: count() }).from(notifications).where(where);
  const [{ unread }] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  const items: NotificationRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body,
    link: r.link,
    createdAt: r.createdAt.toISOString(),
    read: r.readAt != null,
    readAt: r.readAt?.toISOString() ?? null,
    regionCode: r.regionCode,
    regionName: r.regionName,
  }));
  return { items, total: Number(total), unread: Number(unread), limit, offset: Math.max(f.offset ?? 0, 0) };
}
