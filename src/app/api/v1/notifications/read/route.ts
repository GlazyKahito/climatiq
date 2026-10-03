import { getDb } from '@/server/db/client';
import { rateLimit, readJson } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { notificationReadInput } from '@/server/incidents/inputs';
import { inboxFor, markRead, markUnread } from '@/server/notifications/inbox';

/** POST /api/v1/notifications/read — body { all: true } or { ids: [...], unread?: true }. Only the caller's notifications change. */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  rateLimit(`notifications-read:${user.id}`, 120, 60_000);
  const body = notificationReadInput.parse(await readJson(req));
  const db = getDb();
  if ('all' in body) await markRead(db, user.id, 'all');
  else if (body.unread) await markUnread(db, user.id, body.ids);
  else await markRead(db, user.id, body.ids);
  const { unread } = await inboxFor(db, user.id, 0);
  return Response.json({ data: { unread } });
});
