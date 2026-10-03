import type { Metadata } from 'next';
import Link from 'next/link';
import { AlarmClock, ArrowRight, ListChecks, Plus, Siren } from 'lucide-react';
import { EmptyState, LinkButton, MetricCard, PageHeader, Panel } from '@/components/ui/primitives';
import { DemoTag, SeverityBadge } from '@/components/ui/badges';
import { BarList } from '@/components/crm/bar-list';
import { ActivityTimeline } from '@/components/crm/timeline';
import { IncidentStatusBadge, OverdueChip, PriorityBadge } from '@/components/crm/badges';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { dashboard, listIncidents } from '@/server/incidents/service';
import { INCIDENT_STATUS_META, PRIORITY_META, fmtDate, fmtRelative, type IncidentStatus, type Priority } from '@/lib/domain';
import { can } from '@/lib/rbac';

export const metadata: Metadata = { title: 'Response CRM' };

export default async function ResponsePage() {
  const user = await requirePagePermission('incident:view');
  const db = getDb();
  const [d, active] = await Promise.all([dashboard(db, user), listIncidents(db, user, { status: 'active', limit: 8 })]);
  const canCreate = can(user.assignments, 'incident:create');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Response CRM"
        title="Heatwave response"
        description="Incidents, tasks and team coordination for your assigned regions. Demo incidents are fictional scenarios built on the May 2024 replay."
        actions={
          <>
            <LinkButton href="/response/incidents" variant="secondary" size="sm">
              <ListChecks aria-hidden className="size-3.5" /> All incidents
            </LinkButton>
            {canCreate && (
              <LinkButton href="/response/incidents/new" size="sm">
                <Plus aria-hidden className="size-3.5" /> New incident
              </LinkButton>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-5" data-tour="crm">
        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <MetricCard label="Active incidents" value={d.totals.active} hint={`${d.totals.total} in total`} />
          <MetricCard label="High priority" value={d.totals.highPriorityActive} hint="Active P1 + P2" />
          <MetricCard label="Overdue incidents" value={d.totals.overdueIncidents} hint="Past due, still active" />
          <MetricCard label="Open tasks" value={d.totals.openTasks} hint={`${d.totals.overdueTasks} overdue · ${d.totals.blockedTasks} blocked`} />
          <MetricCard label="My open tasks" value={d.totals.myOpenTasks} hint={d.totals.unassignedTasks ? `${d.totals.unassignedTasks} unassigned in scope` : 'Assigned to you'} className="col-span-2 md:col-span-1" />
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Panel title="By status" description="All incidents in your regions.">
            <BarList
              unit="incidents"
              items={(Object.keys(INCIDENT_STATUS_META) as IncidentStatus[]).map((s) => ({
                key: s,
                label: INCIDENT_STATUS_META[s].label,
                value: d.byStatus[s],
                href: `/response/incidents?status=${s}`,
              }))}
            />
          </Panel>
          <Panel title="Active by priority" description="P1 critical → P4 low.">
            <BarList
              unit="active incidents"
              items={(Object.keys(PRIORITY_META) as Priority[]).map((p) => ({ key: p, label: PRIORITY_META[p].label, value: d.byPriority[p], href: `/response/incidents?priority=${p}` }))}
            />
          </Panel>
          <Panel title="By state" description="Active, with total in lighter tone.">
            <BarList
              unit="active"
              secondaryLabel="total"
              emptyText="No incidents in your regions."
              items={d.byRegion.map((r) => ({ key: r.code, label: r.name, value: r.active, secondary: r.total, href: `/response/incidents?region=${r.code}&status=all` }))}
            />
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Panel
            title="Active incidents"
            description="Highest priority and nearest due date first."
            actions={
              <Link href="/response/incidents" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                View all <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            }
          >
            {active.items.length === 0 ? (
              <EmptyState title="No active incidents">Incidents opened from alerts or advisories appear here.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {active.items.map((i) => (
                  <li key={i.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/response/incidents/${i.ref}`} className="font-mono text-xs font-semibold text-accent hover:underline">
                          {i.ref}
                        </Link>
                        <PriorityBadge priority={i.priority} />
                        <IncidentStatusBadge status={i.status} />
                        {i.overdue && <OverdueChip />}
                        {i.isDemo && <DemoTag label="Demo" />}
                      </p>
                      <Link href={`/response/incidents/${i.ref}`} className="mt-0.5 block truncate text-sm font-medium hover:text-accent">
                        {i.title}
                      </Link>
                      <p className="text-xs text-fg-subtle">
                        {i.regionName} · {i.teamName ?? 'Unassigned team'} · {i.openTasks}/{i.totalTasks} tasks open{i.dueAt ? ` · due ${fmtDate(i.dueAt)}` : ''}
                      </p>
                    </div>
                    <SeverityBadge severity={i.severity} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Team workload" description="Active incidents assigned to the team and open tasks held by its members.">
            {d.teamWorkload.length === 0 ? (
              <p className="text-sm text-fg-muted">No teams in your regions.</p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[20rem] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                      <th scope="col" className="px-1 py-1.5 font-semibold">
                        Team
                      </th>
                      <th scope="col" className="px-1 py-1.5 text-right font-semibold">
                        Incidents
                      </th>
                      <th scope="col" className="px-1 py-1.5 text-right font-semibold">
                        Open tasks
                      </th>
                      <th scope="col" className="px-1 py-1.5 text-right font-semibold">
                        Overdue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.teamWorkload.map((t) => (
                      <tr key={t.id}>
                        <th scope="row" className="px-1 py-2 text-left font-medium">
                          <Link href={`/response/incidents?teamId=${t.id}&status=active`} className="hover:text-accent hover:underline">
                            {t.name}
                          </Link>
                          <span className="block text-xs font-normal text-fg-subtle">{t.regionName}</span>
                        </th>
                        <td className="px-1 py-2 text-right tabular">{t.activeIncidents}</td>
                        <td className="px-1 py-2 text-right tabular">{t.openTasks}</td>
                        <td className={`px-1 py-2 text-right tabular ${t.overdueTasks ? 'font-semibold text-accent' : 'text-fg-muted'}`}>{t.overdueTasks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Panel title="Overdue & high-priority work" description="Needs attention first.">
            <div className="flex flex-col gap-4">
              <section aria-label="Overdue incidents">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-accent">
                  <AlarmClock aria-hidden className="size-3.5" /> Overdue incidents ({d.overdueIncidents.length})
                </h3>
                {d.overdueIncidents.length === 0 ? (
                  <p className="text-sm text-fg-muted">None.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {d.overdueIncidents.map((o) => (
                      <li key={o.ref} className="text-sm">
                        <Link href={`/response/incidents/${o.ref}`} className="font-mono text-xs font-semibold text-accent hover:underline">
                          {o.ref}
                        </Link>{' '}
                        {o.title} <span className="text-xs text-fg-subtle">· due {o.dueAt ? fmtRelative(o.dueAt) : '—'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-label="Overdue tasks">
                <h3 className="mb-1.5 text-xs font-semibold text-fg-muted">Overdue tasks ({d.overdueTasks.length})</h3>
                {d.overdueTasks.length === 0 ? (
                  <p className="text-sm text-fg-muted">None.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {d.overdueTasks.map((t) => (
                      <li key={t.id} className="text-sm">
                        {t.title}{' '}
                        <span className="text-xs text-fg-subtle">
                          ·{' '}
                          <Link href={`/response/incidents/${t.ref}`} className="font-mono text-accent hover:underline">
                            {t.ref}
                          </Link>{' '}
                          · {t.assigneeName ?? 'unassigned'} · due {t.dueAt ? fmtRelative(t.dueAt) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-label="High-priority incidents">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
                  <Siren aria-hidden className="size-3.5" /> Active P1/P2 ({d.highPriority.length})
                </h3>
                {d.highPriority.length === 0 ? (
                  <p className="text-sm text-fg-muted">None.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {d.highPriority.map((h) => (
                      <li key={h.ref} className="flex flex-wrap items-center gap-1.5 text-sm">
                        <PriorityBadge priority={h.priority} />
                        <Link href={`/response/incidents/${h.ref}`} className="min-w-0 flex-1 truncate hover:text-accent">
                          {h.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </Panel>
          <Panel title="Recent activity" className="xl:col-span-2" description="Latest updates across incidents in your regions.">
            <ActivityTimeline items={d.recentActivity} showIncident />
          </Panel>
        </div>
      </div>
    </div>
  );
}
