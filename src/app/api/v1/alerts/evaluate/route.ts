import { getDb } from '@/server/db/client';
import { AuthError } from '@/server/auth/dal';
import { readJson, rateLimit } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { alertEvaluateInput } from '@/server/incidents/inputs';
import { evaluateAlerts } from '@/server/alerts/engine';
import { can } from '@/lib/rbac';

/**
 * POST /api/v1/alerts/evaluate — re-runs the alert rules on a forecast run. Body: { runId }.
 * A run covers the whole country, so this needs `alert:manage` with nationwide scope.
 */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  if (!can(user.assignments, 'alert:manage', 'IN')) throw new AuthError(403, 'Missing nationwide permission alert:manage');
  rateLimit(`alerts-evaluate:${user.id}`, 6, 60_000);
  const { runId } = alertEvaluateInput.parse(await readJson(req));
  const result = await evaluateAlerts(getDb(), runId, { actor: { id: user.id, name: user.name } });
  return Response.json({ data: { runId, ...result } });
});
