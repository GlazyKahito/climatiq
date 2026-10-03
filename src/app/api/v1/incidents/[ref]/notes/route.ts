import { getDb } from '@/server/db/client';
import { rateLimit, readJson } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { incidentRef, noteInput } from '@/server/incidents/inputs';
import { addNote } from '@/server/incidents/service';

type Ctx = { params: Promise<{ ref: string }> };

/** POST /api/v1/incidents/{ref}/notes — body { body }. `incident:update`, or `task:update` for users with a task on the incident. */
export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  rateLimit(`incident-note:${user.id}`, 60, 60_000);
  const ref = incidentRef.parse((await ctx.params).ref);
  const { body } = noteInput.parse(await readJson(req));
  return Response.json({ data: await addNote(getDb(), user, ref, body) }, { status: 201 });
});
