import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { rateLimit } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { advisoryAction } from '@/server/incidents/inputs';
import { transitionAdvisory } from '@/server/advisories/service';

type Ctx = { params: Promise<{ id: string; action: string }> };

/** POST /api/v1/advisories/{id}/approve|publish|archive — human-in-the-loop workflow (`advisory:approve` on every region). */
export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  rateLimit(`advisory-transition:${user.id}`, 30, 60_000);
  const p = await ctx.params;
  const id = z.string().uuid().parse(p.id);
  const action = advisoryAction.parse(p.action);
  return Response.json({ data: await transitionAdvisory(getDb(), user, id, action) });
});
