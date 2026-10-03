import { getDb } from '@/server/db/client';
import { rateLimit, readJson } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { incidentRef, incidentTransitionInput } from '@/server/incidents/inputs';
import { transitionIncident } from '@/server/incidents/service';

type Ctx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/incidents/{ref}/transition — body { to, resolutionSummary?, note? }.
 * Validated server-side: reported → triaged → in_progress ⇄ monitoring → resolved → closed (+ reopen);
 * resolving/closing/reopening needs `incident:close` and a resolution summary.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  rateLimit(`incident-transition:${user.id}`, 60, 60_000);
  const ref = incidentRef.parse((await ctx.params).ref);
  const body = incidentTransitionInput.parse(await readJson(req));
  return Response.json({ data: await transitionIncident(getDb(), user, ref, body.to, body) });
});
