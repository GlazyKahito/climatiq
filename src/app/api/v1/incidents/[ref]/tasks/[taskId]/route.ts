import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { rateLimit, readJson } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { incidentRef, taskPatchInput } from '@/server/incidents/inputs';
import { deleteTask, updateTask } from '@/server/incidents/service';

type Ctx = { params: Promise<{ ref: string; taskId: string }> };

/**
 * PATCH /api/v1/incidents/{ref}/tasks/{taskId} — body { title?, status?, priority?, assigneeId?, dueAt? }.
 * Managers (`incident:update` + `task:update`) may change anything; assignees with `task:update` may change the status only.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  rateLimit(`task-update:${user.id}`, 120, 60_000);
  const p = await ctx.params;
  const ref = incidentRef.parse(p.ref);
  const taskId = z.string().uuid().parse(p.taskId);
  const body = taskPatchInput.parse(await readJson(req));
  return Response.json({ data: await updateTask(getDb(), user, ref, taskId, body) });
});

/** DELETE /api/v1/incidents/{ref}/tasks/{taskId} — needs `task:update` + `incident:update`. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const user = await requireApiUser();
  const p = await ctx.params;
  const ref = incidentRef.parse(p.ref);
  const taskId = z.string().uuid().parse(p.taskId);
  return Response.json({ data: await deleteTask(getDb(), user, ref, taskId) });
});
