import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BellRing, CalendarClock, FileText, MapPin, UserRound, Users } from 'lucide-react';
import { ErrorState, LinkButton, PageHeader, Panel } from '@/components/ui/primitives';
import { DemoTag, SeverityBadge } from '@/components/ui/badges';
import { AdvisoryStatusBadge, AlertStatusBadge } from '@/components/advisories/badges';
import { IncidentStatusBadge, OverdueChip, PriorityBadge } from '@/components/crm/badges';
import { ActivityTimeline } from '@/components/crm/timeline';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { DomainError } from '@/server/alerts/errors';
import { assignmentOptions, getIncident } from '@/server/incidents/service';
import { INCIDENT_STATUS_META, fmtDate, fmtDateTime, type IncidentStatus } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { TransitionPanel } from '../../_components/transition-panel';
import { AssignForm, FieldsForm, NoteForm } from '../../_components/details-forms';
import { TaskList } from '../../_components/task-list';

export async function generateMetadata({ params }: PageProps<'/response/incidents/[ref]'>): Promise<Metadata> {
  return { title: (await params).ref };
}

const FLOW: IncidentStatus[] = ['reported', 'triaged', 'in_progress', 'monitoring', 'resolved', 'closed'];

export default async function IncidentPage({ params }: PageProps<'/response/incidents/[ref]'>) {
  const { ref } = await params;
  if (!/^INC-\d{4}-\d{4,6}$/.test(ref)) notFound();
  const user = await requirePagePermission('incident:view');
  const db = getDb();
  let inc: Awaited<ReturnType<typeof getIncident>>;
  try {
    inc = await getIncident(db, user, ref);
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof DomainError && e.status === 403)
      return <ErrorState title="This incident is outside your assigned regions">Incidents are visible to response roles assigned to the incident’s region.</ErrorState>;
    throw e;
  }
  const opts = inc.permissions.assign || inc.permissions.manageTasks ? await assignmentOptions(db, inc.region.path) : { teams: [], owners: [], assignees: [] };
  const stepIndex = FLOW.indexOf(inc.status);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`Incident · ${inc.ref}`}
        title={inc.title}
        actions={
          <LinkButton href="/response/incidents" variant="secondary" size="sm">
            <ArrowLeft aria-hidden className="size-3.5" /> Incidents
          </LinkButton>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <IncidentStatusBadge status={inc.status} />
        <PriorityBadge priority={inc.priority} long />
        <SeverityBadge severity={inc.severity} />
        {inc.overdue && <OverdueChip />}
        {inc.isDemo && <DemoTag label="Fictional demo incident" />}
        <span className="inline-flex items-center gap-1 text-sm text-fg-muted">
          <MapPin aria-hidden className="size-3.5" />
          <span>
            <Link href={`/forecasts/${inc.region.code}`} className="hover:text-accent hover:underline">
              {inc.region.name}
            </Link>
            {inc.region.parentName ? `, ${inc.region.parentName}` : ''}
          </span>
        </span>
      </div>

      <section className="glass flex flex-col gap-4 rounded-[var(--radius-glass)] p-5" aria-label="Workflow">
        <ol className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label="Incident status">
          {FLOW.map((s, i) => (
            <li
              key={s}
              aria-current={i === stepIndex ? 'step' : undefined}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-center text-[11px] font-semibold',
                i === stepIndex ? 'border-accent bg-wine text-sand dark:bg-accent dark:text-accent-fg' : i < stepIndex ? 'border-accent/40 text-accent' : 'border-line text-fg-subtle',
              )}
            >
              {INCIDENT_STATUS_META[s].label}
            </li>
          ))}
        </ol>
        <TransitionPanel incidentRef={inc.ref} transitions={inc.transitions} existingSummary={inc.resolutionSummary} />
        {inc.resolutionSummary && (
          <p className="rounded-xl border border-line px-3 py-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Resolution summary</span>
            <span className="mt-0.5 block">{inc.resolutionSummary}</span>
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          <Panel title="Situation">
            <p className="whitespace-pre-line text-sm leading-relaxed">{inc.description}</p>
            {(inc.alert || inc.advisory) && (
              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                {inc.alert && (
                  <Link href={`/alerts/${inc.alert.id}`} className="flex flex-col gap-1 rounded-xl border border-line p-3 hover:bg-accent-soft">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-fg-subtle">
                      <BellRing aria-hidden className="size-3.5" /> Linked alert
                    </span>
                    <span className="text-sm font-medium">{inc.alert.title}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <SeverityBadge severity={inc.alert.severity} size="sm" />
                      <AlertStatusBadge status={inc.alert.status} />
                    </span>
                  </Link>
                )}
                {inc.advisory && (
                  <Link href={`/advisories/${inc.advisory.id}`} className="flex flex-col gap-1 rounded-xl border border-line p-3 hover:bg-accent-soft">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-fg-subtle">
                      <FileText aria-hidden className="size-3.5" /> Linked advisory
                    </span>
                    <span className="text-sm font-medium">{inc.advisory.title}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <SeverityBadge severity={inc.advisory.severity} size="sm" />
                      <AdvisoryStatusBadge status={inc.advisory.status} />
                    </span>
                  </Link>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Tasks" description={`${inc.tasks.filter((t) => t.status !== 'done').length} open of ${inc.tasks.length}`}>
            <TaskList incidentRef={inc.ref} tasks={inc.tasks} assignees={opts.assignees} manage={inc.permissions.manageTasks} currentUserId={user.id} />
          </Panel>

          <Panel title="Activity">
            <div className="flex flex-col gap-4">
              {inc.permissions.note && <NoteForm incidentRef={inc.ref} />}
              <ActivityTimeline items={inc.activities} />
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Details">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex gap-2">
                <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div>
                  <dt className="text-xs text-fg-subtle">Team</dt>
                  <dd>{inc.teamName ?? 'Not assigned'}</dd>
                </div>
              </div>
              <div className="flex gap-2">
                <UserRound aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div>
                  <dt className="text-xs text-fg-subtle">Owner</dt>
                  <dd>{inc.ownerName ?? 'Not assigned'}</dd>
                </div>
              </div>
              <div className="flex gap-2">
                <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div>
                  <dt className="text-xs text-fg-subtle">Due</dt>
                  <dd className={inc.overdue ? 'font-semibold text-accent' : undefined}>{inc.dueAt ? fmtDate(inc.dueAt) : 'No due date'}</dd>
                </div>
              </div>
              <div>
                <dt className="text-xs text-fg-subtle">Reported</dt>
                <dd>
                  {fmtDateTime(inc.openedAt)}
                  {inc.openedByName ? ` · ${inc.openedByName}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-subtle">Last update</dt>
                <dd>{fmtDateTime(inc.updatedAt)}</dd>
              </div>
              {inc.resolvedAt && (
                <div>
                  <dt className="text-xs text-fg-subtle">Resolved</dt>
                  <dd>{fmtDateTime(inc.resolvedAt)}</dd>
                </div>
              )}
              {inc.closedAt && (
                <div>
                  <dt className="text-xs text-fg-subtle">Closed</dt>
                  <dd>{fmtDateTime(inc.closedAt)}</dd>
                </div>
              )}
            </dl>
          </Panel>
          {inc.permissions.assign && (
            <Panel title="Assignment" description="Assignees are notified in-app.">
              <AssignForm incidentRef={inc.ref} teamId={inc.teamId} ownerId={inc.ownerId} teams={opts.teams} owners={opts.owners} />
            </Panel>
          )}
          {inc.permissions.update && (
            <Panel title="Priority & due date">
              <FieldsForm incidentRef={inc.ref} priority={inc.priority} severity={inc.severity} dueAt={inc.dueAt} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
