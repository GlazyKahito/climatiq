import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarRange, Hourglass, MapPin, Siren, Users } from 'lucide-react';
import { ErrorState, LinkButton, PageHeader, Panel } from '@/components/ui/primitives';
import { ConfidenceBadge, DemoTag, OriginTag, SeverityBadge } from '@/components/ui/badges';
import { AdvisoryStatusBadge, AudienceBadge, ScenarioBadge } from '@/components/advisories/badges';
import { AdvisoryContentView } from '@/components/advisories/advisory-content';
import { BundleInspector, OfficialWarningsNotice, ProvenanceList, SourceRefs } from '@/components/advisories/provenance';
import { requireUser } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { DomainError } from '@/server/alerts/errors';
import { getAdvisory, officialWarningsFor } from '@/server/advisories/service';
import { AUDIENCE_META, fmtDate, fmtDateTime } from '@/lib/domain';
import { can } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { WorkflowButtons } from '../_components/workflow-buttons';

export const metadata: Metadata = { title: 'Advisory' };

const STEPS = ['draft', 'approved', 'published'] as const;
const ACTION_LABEL: Record<string, string> = {
  'advisory.generate': 'Generated (draft)',
  'advisory.approve': 'Approved',
  'advisory.publish': 'Published',
  'advisory.archive': 'Archived',
};

export default async function AdvisoryPage({ params }: PageProps<'/advisories/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireUser();
  const db = getDb();
  let adv: Awaited<ReturnType<typeof getAdvisory>>;
  try {
    adv = await getAdvisory(db, user, id);
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof DomainError && e.status === 403) {
      return (
        <div className="flex flex-col gap-5">
          <PageHeader eyebrow="Advisory" title="Not available" />
          <ErrorState title="This advisory is not visible for your role or region">Internal advisories are shown to officials assigned to the advisory’s regions.</ErrorState>
        </div>
      );
    }
    throw e;
  }
  const official = await officialWarningsFor(db, adv.regions.map((r) => r.id));
  const stepIndex = adv.status === 'archived' ? -1 : STEPS.indexOf(adv.status);
  const firstRegion = adv.regions[0];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Advisory"
        title={adv.title}
        actions={
          <>
            <LinkButton href="/advisories" variant="secondary" size="sm">
              <ArrowLeft aria-hidden className="size-3.5" /> All advisories
            </LinkButton>
            {firstRegion && can(user.assignments, 'incident:create', firstRegion.path) && (
              <LinkButton href={`/response/incidents/new?advisory=${adv.id}`} variant="secondary" size="sm">
                <Siren aria-hidden className="size-3.5" /> Create incident
              </LinkButton>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <OriginTag origin="climatiq" />
        <SeverityBadge severity={adv.severity} size="lg" />
        <AdvisoryStatusBadge status={adv.status} />
        <AudienceBadge audience={adv.audience} />
        <ScenarioBadge scenario={adv.scenario} />
        {adv.isDemo && <DemoTag label="Demo data" />}
      </div>

      {adv.scenario === 'replay' && (
        <p className="rounded-xl border border-dashed border-[var(--prov-reanalysis)] px-3 py-2 text-sm text-fg-muted">
          <strong className="text-fg">Historical replay.</strong> Based on CLIMATIQ hindcasts issued as of {adv.issuedFor ? fmtDate(adv.issuedFor) : '26 May 2024'} for the late-May 2024 heatwave. It does not describe a current situation.
        </p>
      )}

      <OfficialWarningsNotice warnings={official} />

      <section className="glass flex flex-col gap-4 rounded-[var(--radius-glass)] p-5 lg:flex-row lg:items-center lg:justify-between" data-tour="advisory-workflow" aria-label="Review workflow">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Human review</h2>
          <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Workflow progress">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-1 font-semibold capitalize',
                    adv.status === 'archived' ? 'border-dashed border-line-strong text-fg-subtle' : i <= stepIndex ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-subtle',
                  )}
                  aria-current={i === stepIndex ? 'step' : undefined}
                >
                  {s}
                </span>
                {i < STEPS.length - 1 && <span aria-hidden className="h-px w-4 bg-line-strong" />}
              </li>
            ))}
            {adv.status === 'archived' && <li className="rounded-full border border-dashed border-line-strong px-2.5 py-1 font-semibold text-fg-muted">archived</li>}
          </ol>
          <p className="text-xs text-fg-muted">
            {adv.status === 'draft' && 'Draft — review the content, uncertainty and inputs, then approve.'}
            {adv.status === 'approved' && 'Approved — publish to make it the current advisory for its audience.'}
            {adv.status === 'published' && (adv.audience === 'public' ? 'Published — visible on the public portal, labelled as CLIMATIQ-generated.' : 'Published to internal users in these regions.')}
            {adv.status === 'archived' && 'Archived — kept for the record, no longer current.'}
          </p>
        </div>
        <div className="lg:max-w-md">
          <WorkflowButtons id={adv.id} actions={adv.actions} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="Advisory" description={`Written for: ${AUDIENCE_META[adv.audience].label}`}>
          <AdvisoryContentView content={adv.content} />
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Key facts">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex gap-2">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div>
                  <dt className="text-xs text-fg-subtle">Regions</dt>
                  <dd className="flex flex-wrap gap-x-2 gap-y-1">
                    {adv.regions.map((r) => (
                      <Link key={r.code} href={`/forecasts/${r.code}`} className="font-medium hover:text-accent hover:underline">
                        {r.name}
                        <span className="ml-0.5 text-xs font-normal capitalize text-fg-subtle">({r.level})</span>
                      </Link>
                    ))}
                  </dd>
                </div>
              </div>
              <div className="flex gap-2">
                <CalendarRange aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div>
                  <dt className="text-xs text-fg-subtle">Validity</dt>
                  <dd>
                    {fmtDate(adv.validFrom)} – {fmtDate(adv.validTo)}
                  </dd>
                </div>
              </div>
              <div className="flex gap-2">
                <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div>
                  <dt className="text-xs text-fg-subtle">Expected duration</dt>
                  <dd>{adv.expectedDurationDays > 0 ? `Up to ${adv.expectedDurationDays} consecutive day(s) at High or above` : 'No day at High or above'}</dd>
                </div>
              </div>
              <div className="flex gap-2">
                <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div>
                  <dt className="text-xs text-fg-subtle">Intended audience</dt>
                  <dd>{AUDIENCE_META[adv.audience].label}</dd>
                </div>
              </div>
              <div>
                <dt className="text-xs text-fg-subtle">Confidence (heuristic, not a probability)</dt>
                <dd className="mt-1">
                  <ConfidenceBadge confidence={adv.confidence} />
                </dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Provenance" description="How this advisory was produced.">
            <ProvenanceList p={adv} />
          </Panel>
          <Panel title="Data sources" description="Attached by the server — never by the model.">
            <SourceRefs refs={adv.sourceRefs} />
          </Panel>
          <Panel title="History">
            <ol className="flex flex-col gap-2 text-sm">
              {adv.history.map((h, i) => (
                <li key={i} className="flex flex-col">
                  <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                  <span className="text-xs text-fg-muted">
                    {h.actor} · {fmtDateTime(h.at)}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <BundleInspector bundle={adv.bundle} />
    </div>
  );
}
