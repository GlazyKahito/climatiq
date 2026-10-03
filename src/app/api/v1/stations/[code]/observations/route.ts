import { z } from 'zod';
import { api, clientKey, HttpError, rateLimit, readJson } from '@/server/http';
import { getDb } from '@/server/db/client';
import { authorize } from '@/server/auth/dal';
import { authenticateStation, ingestObservations } from '@/server/stations/ingest';
import { getStation, stationObservationsBetween } from '@/server/stations/queries';

type Ctx = { params: Promise<{ code: string }> };

/**
 * POST /api/v1/stations/{code}/observations — IoT ingestion (station API key, `Authorization: Bearer <key>`).
 * Body: one observation object or `{ observations: [...] }` (≤ 500). See docs/API.md → "Stations & IoT ingestion".
 */
export const POST = api(async (req: Request, ctx: Ctx) => {
  const { code } = await ctx.params;
  rateLimit(`iot-ip:${clientKey(req)}`, 240, 60_000);
  const db = getDb();
  const station = await authenticateStation(db, code, req.headers.get('authorization'));
  rateLimit(`iot:${station.code}`, 60, 60_000);
  const body = await readJson(req, 512 * 1024);
  const result = await ingestObservations(db, station, body);
  if (result.accepted === 0 && result.duplicates === 0 && result.rejected.length > 0) {
    throw new HttpError(422, 'No observation in the request could be accepted.', {
      ingestionRunId: result.ingestionRunId,
      received: result.received,
      rejected: result.rejected,
    });
  }
  return Response.json({ data: result });
});

const dateOrDateTime = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);
const query = z.object({
  from: dateOrDateTime.optional(),
  to: dateOrDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

const MAX_RANGE_MS = 31 * 86_400_000;

/** GET /api/v1/stations/{code}/observations?from&to&limit — observations of one station (signed-in, `station:view`). */
export const GET = api(async (req: Request, ctx: Ctx) => {
  const user = await authorize('station:view');
  rateLimit(`stations-read:${user.id}`, 120, 60_000);
  const { code } = await ctx.params;
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const to = q.to ? new Date(q.to.length === 10 ? `${q.to}T23:59:59.999+05:30` : q.to) : new Date();
  const from = q.from ? new Date(q.from.length === 10 ? `${q.from}T00:00:00+05:30` : q.from) : new Date(to.getTime() - 7 * 86_400_000);
  if (from > to) throw new HttpError(400, '`from` must be before `to`');
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new HttpError(400, 'The requested range may span at most 31 days');

  const db = getDb();
  const station = await getStation(db, code);
  if (!station) throw new HttpError(404, 'Station not found');
  const rows = await stationObservationsBetween(db, station.id, { from, to, limit: q.limit, order: 'desc' });
  return Response.json({
    data: rows,
    meta: {
      station: { code: station.code, name: station.name, stationType: station.stationType, isSimulated: station.isSimulated, status: station.status },
      from: from.toISOString(),
      to: to.toISOString(),
      count: rows.length,
      truncated: rows.length === q.limit,
      provenance: station.isSimulated
        ? 'SIMULATED demo station — synthetic values, not real measurements.'
        : 'IoT station observations — quality is "unverified" or "suspect" until reviewed; never auto-verified.',
    },
  });
});
