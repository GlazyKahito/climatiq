import { getDb } from '@/server/db/client';
import { rateLimit, readJson } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { incidentPatchInput, incidentRef } from '@/server/incidents/inputs';
import { assignIncident, getIncident, updateIncident } from '@/server/incidents/service';

type Ctx = { params: Promise<{ ref: string }> };

/** GET /api/v1/incidents/{ref} — incident detail with tasks, activity timeline, links and allowed transitions. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const ref = incidentRef.parse((await ctx.params).ref);
  return Response.json({ data: await getIncident(getDb(), user, ref) });
});

/**
 * PATCH /api/v1/incidents/{ref} — update fields (`incident:update`) and/or assignment (`incident:assign`).
 * Body: { title?, description?, priority?, severity?, dueAt?, teamId?, ownerId? }.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  rateLimit(`incident-update:${user.id}`, 60, 60_000);
  const ref = incidentRef.parse((await ctx.params).ref);
  const body = incidentPatchInput.parse(await readJson(req));
  const db = getDb();
  const { teamId, ownerId, ...fields } = body;
  if (Object.values(fields).some((v) => v !== undefined)) await updateIncident(db, user, ref, fields);
  if (teamId !== undefined || ownerId !== undefined) await assignIncident(db, user, ref, { teamId, ownerId });
  return Response.json({ data: await getIncident(db, user, ref) });
});
