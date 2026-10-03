import type { Metadata } from 'next';
import { eq, inArray } from 'drizzle-orm';
import { ArrowLeft } from 'lucide-react';
import { EmptyState, LinkButton, PageHeader, Panel } from '@/components/ui/primitives';
import { ProvenanceBadge } from '@/components/ui/badges';
import { ScenarioBadge } from '@/components/advisories/badges';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { regions } from '@/server/db/schema';
import { env } from '@/server/config/env';
import { currentScenario } from '@/server/scenario';
import { latestRun, peakSeverityByRegion, SEVERITY_FROM_RANK } from '@/server/forecasting/queries';
import { ADVISORY_HORIZON_DAYS } from '@/server/advisories/bundle';
import { AUDIENCE_BRIEFS } from '@/server/advisories/prompt';
import { can } from '@/lib/rbac';
import { fmtDate, fmtDateTime } from '@/lib/domain';
import { GenerateForm, type RegionOption } from './generate-form';

export const metadata: Metadata = { title: 'Generate advisory' };

export default async function NewAdvisoryPage({ searchParams }: PageProps<'/advisories/new'>) {
  const user = await requirePagePermission('advisory:generate');
  const sp = await searchParams;
  const db = getDb();
  const scenario = await currentScenario();
  const run = await latestRun(db, scenario);

  const header = (
    <PageHeader
      eyebrow="Advisories · generate"
      title="Generate a heat advisory"
      description="Pick regions from the latest CLIMATIQ forecast run and an audience. The provider only sees a validated forecast bundle; you review the preview, then save it as a draft for approval."
      actions={
        <LinkButton href="/advisories" variant="secondary" size="sm">
          <ArrowLeft aria-hidden className="size-3.5" /> Advisories
        </LinkButton>
      }
    />
  );

  if (!run) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Panel>
          <EmptyState title="No forecast run is available for this scenario">
            {scenario === 'live'
              ? 'There is no completed live run yet. Switch the scenario to the May 2024 replay in the top bar, or ask an analyst to run a live forecast.'
              : 'The replay run has not been seeded yet.'}
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const peaks = await peakSeverityByRegion(db, run.id, ADVISORY_HORIZON_DAYS);
  const regionRows = peaks.length
    ? await db
        .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level, parentId: regions.parentId, path: regions.path })
        .from(regions)
        .where(inArray(regions.id, peaks.map((p) => p.regionId)))
    : [];
  const stateName = new Map(regionRows.filter((r) => r.level === 'state').map((r) => [r.id, r.name]));
  const options: RegionOption[] = regionRows
    .filter((r) => can(user.assignments, 'advisory:generate', r.path))
    .map((r) => {
      const p = peaks.find((x) => x.regionId === r.id)!;
      return {
        code: r.code,
        name: r.name,
        level: r.level as 'state' | 'district',
        stateName: r.level === 'state' ? r.name : (stateName.get(r.parentId ?? -1) ?? ''),
        severity: SEVERITY_FROM_RANK[Number(p.peakRank)] ?? 'low',
        maxTmax: Number(p.maxTmax),
      };
    });

  // Preselect ?region=<code> (cities resolve to their district — forecasts are district-level).
  const wanted = typeof sp.region === 'string' ? sp.region.split(',').filter((c) => /^[A-Z0-9-]+$/.test(c)).slice(0, 12) : [];
  const initial: string[] = [];
  for (const code of wanted) {
    if (options.some((o) => o.code === code)) initial.push(code);
    else {
      const [r] = await db.select({ parentId: regions.parentId, level: regions.level }).from(regions).where(eq(regions.code, code)).limit(1);
      if (r?.level === 'city' && r.parentId) {
        const [d] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, r.parentId)).limit(1);
        if (d && options.some((o) => o.code === d.code)) initial.push(d.code);
      }
    }
  }

  const e = env();
  const providerLabel =
    e.AI_PROVIDER === 'gemini'
      ? e.GEMINI_API_KEY
        ? `Gemini · ${e.GEMINI_MODEL} (falls back to the deterministic template on error)`
        : 'Gemini selected but no API key — the deterministic template will be used'
      : e.AI_PROVIDER === 'anthropic'
        ? e.ANTHROPIC_API_KEY
          ? `Claude · ${e.ANTHROPIC_MODEL} (falls back to the deterministic template on error)`
          : 'Claude selected but no API key — the deterministic template will be used'
        : 'Deterministic CLIMATIQ template (no AI provider configured)';

  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-sm">
        <span className="font-semibold">Forecast run</span>
        <ScenarioBadge scenario={run.scenario} />
        <ProvenanceBadge kind="model_forecast" source={`${run.modelKey} · issued for ${fmtDate(run.issuedFor)}`} updated={fmtDateTime(run.createdAt)} />
        <span className="text-xs text-fg-muted">Advisories use forecast days 1–{ADVISORY_HORIZON_DAYS} of this run.</span>
      </div>
      {options.length === 0 ? (
        <Panel>
          <EmptyState title="No regions in your scope have forecasts in this run" />
        </Panel>
      ) : (
        <GenerateForm
          options={options}
          initial={initial}
          providerLabel={providerLabel}
          userName={user.name}
          audiences={Object.entries(AUDIENCE_BRIEFS).map(([key, a]) => ({ key: key as keyof typeof AUDIENCE_BRIEFS, label: a.label, brief: a.brief }))}
        />
      )}
    </div>
  );
}
