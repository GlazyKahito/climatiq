import { getDb } from '@/server/db/client';
import { rateLimit, readJson } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { incidentCreateInput, incidentListQuery } from '@/server/incidents/inputs';
import { createIncident, listIncidents } from '@/server/incidents/service';

/**
 * GET /api/v1/incidents — incidents in the caller's `incident:view` scope.
 * Query: status (active|all|<status>), priority, severity, region, teamId, mine, overdue, q, limit, offset.
 */
export const GET = route(async (req: Request) => {
  const user = await requireApiUser();
  const q = incidentListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { items, total } = await listIncidents(getDb(), user, { ...q, mine: q.mine === 'true', overdue: q.overdue === 'true' });
  return Response.json({ data: items, meta: { total, limit: q.limit ?? 50, offset: q.offset ?? 0 } });
});

/** POST /api/v1/incidents — create an incident (`incident:create` on the region; assignment needs `incident:assign`). */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  rateLimit(`incident-create:${user.id}`, 20, 60_000);
  const body = incidentCreateInput.parse(await readJson(req));
  const created = await createIncident(getDb(), user, { ...body, dueAt: body.dueAt ?? null });
  return Response.json({ data: created }, { status: 201, headers: { Location: `/api/v1/incidents/${created.ref}` } });
});
