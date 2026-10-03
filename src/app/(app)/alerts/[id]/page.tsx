import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, LineChart, Siren, Sparkles } from 'lucide-react';
import { EmptyState, ErrorState, LinkButton, MetricCard, PageHeader, Panel } from '@/components/ui/primitives';
import { ConfidenceBadge, DemoTag, OriginTag, ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { AlertStatusBadge, ScenarioBadge } from '@/components/advisories/badges';
import { OfficialWarningsNotice } from '@/components/advisories/provenance';
import { IncidentStatusBadge, PriorityBadge } from '@/components/crm/badges';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { DomainError } from '@/server/alerts/errors';
import { getAlert } from '@/server/alerts/service';
import { officialWarningsFor } from '@/server/advisories/service';
import { fmtDate, fmtDateTime, fmtDelta, fmtTemp, type DataKind } from '@/lib/domain';
import { can } from '@/lib/rbac';
import { AlertActions } from '../../advisories/_components/alert-actions';

export const metadata: Metadata = { title: 'Alert' };

export default async function AlertPage({ params }: PageProps<'/alerts/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requirePagePermission('alert:view');
  const db = getDb();
  let a: Awaited<ReturnType<typeof getAlert>>;
  try {
    a = await getAlert(db, user, id);
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof DomainError && e.status === 403)
      return <ErrorState title="This alert is outside your assigned regions">Alerts are visible to users whose role covers the alert’s region.</ErrorState>;
    throw e;
  }
  const official = await officialWarningsFor(db, [a.regionId]);
  const f = a.forecast;
  const rule = a.rule as { thresholds?: { minSeverity: string; minConfidence: number; maxHorizonDays: number; cooldownHours: number }; granularity?: string; qualifyingDays?: number; horizonDay?: number };
  const canAck = a.status === 'active' && can(user.assignments, 'alert:acknowledge', a.regionPath);
  const canResolve = (a.status === 'active' || a.status === 'acknowledged') && can(user.assignments, 'alert:manage', a.regionPath);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="CLIMATIQ alert"
        title={a.title}
        actions={
          <LinkButton href="/advisories?tab=alerts" variant="secondary" size="sm">
            <ArrowLeft aria-hidden className="size-3.5" /> All alerts
          </LinkButton>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <OriginTag origin="climatiq" />
        <SeverityBadge severity={a.severity} size="lg" />
        <AlertStatusBadge status={a.status} />
        <ScenarioBadge scenario={a.scenario} />
        {a.isDemo && <DemoTag label="Demo data" />}
      </div>
      <OfficialWarningsNotice warnings={official} compact />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          <Panel title="Alert" description={`${a.regionName}${a.parentName ? `, ${a.parentName}` : ''} · target day ${fmtDate(a.targetDate)}`}>
            <p className="text-sm leading-relaxed">{a.message}</p>
          </Panel>

          {f ? (
            <Panel
              title="Source forecast"
              description={`Forecast day D+${f.horizonDay} · ${f.resolution}`}
              actions={<ProvenanceBadge kind="model_forecast" source={`run ${f.runId.slice(0, 8)}`} />}
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard label="Predicted Tmax" value={fmtTemp(f.predictedTmaxC)} hint={`Band ${fmtTemp(f.lowerC)} – ${fmtTemp(f.upperC)}`} />
                <MetricCard label="Reference normal" value={fmtTemp(f.normalTmaxC)} hint="5-year ERA5 climatology" />
                <MetricCard label="Departure" value={fmtDelta(f.departureC)} hint={f.imdCategory === 'none' ? 'Below IMD heatwave criteria' : `Meets IMD ${f.imdCategory.replace('_', ' ')} criteria (as evaluated)`} />
                <MetricCard label="Spell" value={`${f.durationDays} d`} hint="Days at High or above from target day" />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <ConfidenceBadge confidence={f.confidence} score={f.confidenceScore} />
                <span className="flex flex-wrap gap-1.5">
                  {f.inputKinds
                    .filter((k) => k !== 'climatology')
                    .map((k) => (
                      <ProvenanceBadge key={k} kind={k as DataKind} />
                    ))}
                </span>
              </div>
              {f.factors.length > 0 && (
                <ul className="mt-4 flex flex-col gap-2">
                  {f.factors.map((x) => (
                    <li key={x.key} className="rounded-xl border border-line px-3 py-2 text-sm">
                      <span className="font-medium">{x.label}</span> <span className="text-fg-muted">· {x.value}</span>
                      <p className="text-xs text-fg-muted">{x.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : (
            <Panel title="Source forecast">
              <EmptyState title="The source forecast is no longer available">The forecast run may have been pruned by retention.</EmptyState>
            </Panel>
          )}

          <Panel title="Linked incidents">
            {a.incidents.length === 0 ? (
              <p className="text-sm text-fg-muted">No response incident has been opened for this alert.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {a.incidents.map((i) => (
                  <li key={i.ref} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/response/incidents/${i.ref}`} className="font-mono font-semibold text-accent hover:underline">
                      {i.ref}
                    </Link>
                    <span className="min-w-0 flex-1">{i.title}</span>
                    <PriorityBadge priority={i.priority} />
                    <IncidentStatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Actions">
            <div className="flex flex-col gap-3">
              <AlertActions id={a.id} canAck={canAck} canResolve={canResolve} size="md" />
              <div className="flex flex-col gap-1.5">
                {can(user.assignments, 'incident:create', a.regionPath) && (
                  <LinkButton href={`/response/incidents/new?alert=${a.id}`} size="sm">
                    <Siren aria-hidden className="size-3.5" /> Create incident
                  </LinkButton>
                )}
                {can(user.assignments, 'advisory:generate', a.regionPath) && (
                  <LinkButton href={`/advisories/new?region=${a.regionCode}`} variant="secondary" size="sm">
                    <Sparkles aria-hidden className="size-3.5" /> Generate advisory
                  </LinkButton>
                )}
                <LinkButton href={`/forecasts/${a.regionCode}`} variant="ghost" size="sm">
                  <LineChart aria-hidden className="size-3.5" /> Open forecast
                </LinkButton>
                {a.advisory && (
                  <LinkButton href={`/advisories/${a.advisory.id}`} variant="ghost" size="sm">
                    <FileText aria-hidden className="size-3.5" /> Linked advisory
                  </LinkButton>
                )}
              </div>
            </div>
          </Panel>
          <Panel title="Timeline">
            <ol className="flex flex-col gap-2 text-sm">
              <li>
                <span className="font-medium">Raised automatically</span>
                <span className="block text-xs text-fg-muted">{fmtDateTime(a.createdAt)}</span>
              </li>
              {a.acknowledgedAt && (
                <li>
                  <span className="font-medium">Acknowledged{a.acknowledgedBy ? ` by ${a.acknowledgedBy}` : ''}</span>
                  <span className="block text-xs text-fg-muted">{fmtDateTime(a.acknowledgedAt)}</span>
                </li>
              )}
              {a.resolvedAt && (
                <li>
                  <span className="font-medium">Resolved</span>
                  <span className="block text-xs text-fg-muted">{fmtDateTime(a.resolvedAt)}</span>
                </li>
              )}
              {a.status === 'expired' && <li className="font-medium text-fg-muted">Expired — the target day has passed.</li>}
            </ol>
          </Panel>
          {rule.thresholds && (
            <Panel title="Rule snapshot" description="Thresholds in force when the alert was raised.">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-xs text-fg-subtle">Min. severity</dt>
                <dd className="capitalize">{rule.thresholds.minSeverity}</dd>
                <dt className="text-xs text-fg-subtle">Min. confidence</dt>
                <dd>{rule.thresholds.minConfidence}</dd>
                <dt className="text-xs text-fg-subtle">Max. horizon</dt>
                <dd>{rule.thresholds.maxHorizonDays} days</dd>
                <dt className="text-xs text-fg-subtle">Cooldown</dt>
                <dd>{rule.thresholds.cooldownHours} h</dd>
                <dt className="text-xs text-fg-subtle">Granularity</dt>
                <dd className="capitalize">{rule.granularity ?? '—'}</dd>
                <dt className="text-xs text-fg-subtle">Qualifying days</dt>
                <dd>{rule.qualifyingDays ?? '—'}</dd>
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
