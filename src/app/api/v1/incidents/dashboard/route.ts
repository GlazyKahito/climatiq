import { getDb } from '@/server/db/client';
import { AuthError } from '@/server/auth/dal';
import { requireApiUser, route } from '@/server/alerts/api';
import { dashboard } from '@/server/incidents/service';
import { can } from '@/lib/rbac';

/** GET /api/v1/incidents/dashboard — CRM summary (status/region/priority mix, workload, overdue, recent activity) in scope. */
export const GET = route(async () => {
  const user = await requireApiUser();
  if (!can(user.assignments, 'incident:view')) throw new AuthError(403, 'Missing permission incident:view');
  return Response.json({ data: await dashboard(getDb(), user) });
});
