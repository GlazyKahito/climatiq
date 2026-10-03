import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { requireApiUser, route } from '@/server/alerts/api';
import { getAdvisory } from '@/server/advisories/service';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/advisories/{id} — full advisory with provenance, regions, input bundle and allowed actions. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const id = z.string().uuid().parse((await ctx.params).id);
  return Response.json({ data: await getAdvisory(getDb(), user, id) });
});
