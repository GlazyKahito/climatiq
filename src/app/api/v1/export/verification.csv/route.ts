import { z } from 'zod';
import { api, HttpError, rateLimit } from '@/server/http';
import { authorize } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { audit } from '@/server/audit/log';
import { scopesFor } from '@/lib/rbac';
import { csvResponse } from '@/server/analytics/csv';
import { verificationCsv } from '@/server/analytics/exports';
import { runParam } from '@/server/analytics/params';

const query = z.object({ run: runParam });

/**
 * GET /api/v1/export/verification.csv?run=<uuid> — forecast vs. truth pairs (truth = ERA5 reanalysis) for a run.
 * Requires `analytics:export`; rows are limited to the caller's geographic scope.
 */
export const GET = api(async (req: Request) => {
  const user = await authorize('analytics:export');
  rateLimit(`export:${user.id}`, 20, 60_000);
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = getDb();
  const file = await verificationCsv(db, q.run, scopesFor(user.assignments, 'analytics:export'));
  if (!file) throw new HttpError(404, 'Unknown forecast run');
  await audit(db, { actor: { id: user.id, name: user.name }, action: 'export.verification_csv', entityType: 'forecast_run', entityId: q.run, after: { rows: file.rows } });
  return csvResponse(file.body, file.filename);
});
