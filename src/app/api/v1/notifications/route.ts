import { getDb } from '@/server/db/client';
import { requireApiUser, route } from '@/server/alerts/api';
import { notificationListQuery } from '@/server/incidents/inputs';
import { listNotifications } from '@/server/notifications/inbox';

/** GET /api/v1/notifications — the caller's in-app notifications (newest first). Query: status, severity, kind, region, limit, offset. */
export const GET = route(async (req: Request) => {
  const user = await requireApiUser();
  const q = notificationListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const res = await listNotifications(getDb(), user.id, q);
  return Response.json({ data: res.items, meta: { total: res.total, unread: res.unread, limit: res.limit, offset: res.offset } });
});
