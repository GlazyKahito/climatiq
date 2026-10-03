import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { requireApiUser, route } from '@/server/alerts/api';
import { getAlert } from '@/server/alerts/service';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/alerts/{id} — alert with its source forecast, rule snapshot and linked incidents. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const id = z.string().uuid().parse((await ctx.params).id);
  return Response.json({ data: await getAlert(getDb(), user, id) });
});
