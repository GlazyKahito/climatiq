import { getDb } from '@/server/db/client';
import { readJson, rateLimit, HttpError } from '@/server/http';
import { requireApiUser, route } from '@/server/alerts/api';
import { advisoryGenerateInput, advisoryListQuery } from '@/server/incidents/inputs';
import { generateAdvisory, listAdvisories, previewAdvisory } from '@/server/advisories/service';
import { latestRun } from '@/server/forecasting/queries';
import { currentScenario } from '@/server/scenario';

/** GET /api/v1/advisories — advisories visible to the caller (published public ones for everyone; internal ones by region scope). */
export const GET = route(async (req: Request) => {
  const user = await requireApiUser();
  const q = advisoryListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { items, total } = await listAdvisories(getDb(), user, q);
  return Response.json({ data: items, meta: { total, limit: q.limit ?? 50, offset: q.offset ?? 0 } });
});

/**
 * POST /api/v1/advisories — generate an advisory draft from a forecast run (`advisory:generate` on every region).
 * Body: { regionCodes[], audience, runId? (default: latest run of `scenario` or the current scenario), dryRun? }.
 * `dryRun: true` returns the preview without storing it.
 */
export const POST = route(async (req: Request) => {
  const user = await requireApiUser();
  rateLimit(`advisory-generate:${user.id}`, 10, 60_000);
  const body = advisoryGenerateInput.parse(await readJson(req));
  const db = getDb();
  const runId = body.runId ?? (await latestRun(db, body.scenario ?? (await currentScenario())))?.id;
  if (!runId) throw new HttpError(409, 'No completed forecast run is available for this scenario');
  const input = { runId, regionCodes: body.regionCodes, audience: body.audience };
  if (body.dryRun) {
    const preview = await previewAdvisory(db, user, input);
    return Response.json({ data: preview });
  }
  const { id, preview } = await generateAdvisory(db, user, input);
  return Response.json(
    {
      data: {
        id,
        status: 'draft',
        title: preview.title,
        provider: preview.provider,
        modelName: preview.modelName,
        promptVersion: preview.promptVersion,
        fallbackReason: preview.fallbackReason,
        content: preview.content,
        sourceRefs: preview.sourceRefs,
      },
    },
    { status: 201, headers: { Location: `/api/v1/advisories/${id}` } },
  );
});
