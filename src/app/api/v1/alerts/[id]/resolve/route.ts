import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { rateLimit, readJson } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { alertResolveInput } from '@/server/incidents/inputs';
import { resolveAlert } from '@/server/alerts/service';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/alerts/{id}/resolve — `alert:manage` on the alert's region. Body (optional): { note }. */
export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  rateLimit(`alert-resolve:${user.id}`, 60, 60_000);
  const id = z.string().uuid().parse((await ctx.params).id);
  const { note } = alertResolveInput.parse(await readJson(req));
  return Response.json({ data: await resolveAlert(getDb(), user, id, note) });
});
