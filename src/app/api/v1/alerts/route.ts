import { getDb } from '@/server/db/client';
import { requireApiUser, route } from '@/server/alerts/api';
import { alertListQuery } from '@/server/incidents/inputs';
import { listAlerts } from '@/server/alerts/service';
import { AuthError } from '@/server/auth/dal';
import { can } from '@/lib/rbac';

/**
 * GET /api/v1/alerts — CLIMATIQ alerts in the caller's `alert:view` scope.
 * Query: status (open|active|acknowledged|resolved|expired|all, default open), severity, region, scenario, limit, offset.
 */
export const GET = route(async (req: Request) => {
  const user = await requireApiUser();
  if (!can(user.assignments, 'alert:view')) throw new AuthError(403, 'Missing permission alert:view');
  const q = alertListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { items, total } = await listAlerts(getDb(), user, q);
  return Response.json({ data: items, meta: { total, limit: q.limit ?? 50, offset: q.offset ?? 0 } });
});
