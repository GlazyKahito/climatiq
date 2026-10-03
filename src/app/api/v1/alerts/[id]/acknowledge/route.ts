import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { rateLimit } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { acknowledgeAlert } from '@/server/alerts/service';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/alerts/{id}/acknowledge — `alert:acknowledge` on the alert's region. */
export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  rateLimit(`alert-ack:${user.id}`, 60, 60_000);
  const id = z.string().uuid().parse((await ctx.params).id);
  return Response.json({ data: await acknowledgeAlert(getDb(), user, id) });
});
