import { getDb } from '@/server/db/client';
import { rateLimit, readJson } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { incidentRef, taskCreateInput } from '@/server/incidents/inputs';
import { createTask, getIncident } from '@/server/incidents/service';

type Ctx = { params: Promise<{ ref: string }> };

/** GET /api/v1/incidents/{ref}/tasks — tasks of an incident. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const ref = incidentRef.parse((await ctx.params).ref);
  return Response.json({ data: (await getIncident(getDb(), user, ref)).tasks });
});

/** POST /api/v1/incidents/{ref}/tasks — body { title, priority?, assigneeId?, dueAt? }. Needs `task:update` + `incident:update`. */
export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  rateLimit(`task-create:${user.id}`, 60, 60_000);
  const ref = incidentRef.parse((await ctx.params).ref);
  const body = taskCreateInput.parse(await readJson(req));
  return Response.json({ data: await createTask(getDb(), user, ref, { ...body, dueAt: body.dueAt ?? null }) }, { status: 201 });
});
