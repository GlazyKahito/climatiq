import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { EmptyState, LinkButton, PageHeader } from '@/components/ui/primitives';
import { DemoTag, SeverityBadge } from '@/components/ui/badges';
import { FilterForm } from '@/components/advisories/filter-form';
import { Pager } from '@/components/advisories/pager';
import { IncidentStatusBadge, OverdueChip, PriorityBadge } from '@/components/crm/badges';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { regionsByLevel } from '@/server/geo/regions';
import { listIncidents, teamsInScope, type IncidentFilters } from '@/server/incidents/service';
import { INCIDENT_STATUS_META, PRIORITY_META, SEVERITY_META, fmtDate, fmtRelative } from '@/lib/domain';
import { can } from '@/lib/rbac';

export const metadata: Metadata = { title: 'Incidents' };

export default async function IncidentsPage({ searchParams }: PageProps<'/response/incidents'>) {
  const user = await requirePagePermission('incident:view');
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const db = getDb();
  const status = sp.status && (sp.status === 'all' || sp.status === 'active' || sp.status in INCIDENT_STATUS_META) ? (sp.status as IncidentFilters['status']) : 'active';
  const filters: IncidentFilters = {
    status,
    priority: sp.priority && sp.priority in PRIORITY_META ? (sp.priority as IncidentFilters['priority']) : undefined,
    severity: sp.severity && sp.severity in SEVERITY_META ? (sp.severity as IncidentFilters['severity']) : undefined,
    region: sp.region && /^[A-Z0-9-]+$/.test(sp.region) ? sp.region : undefined,
    teamId: Number(sp.teamId) > 0 ? Number(sp.teamId) : undefined,
    mine: sp.mine === 'true',
    overdue: sp.overdue === 'true',
    q: sp.q?.slice(0, 80),
    limit: 25,
    offset: Math.max(Number(sp.offset) || 0, 0),
  };
  const [{ items, total }, states, teamList] = await Promise.all([listIncidents(db, user, filters), regionsByLevel(db, 'state'), teamsInScope(db, user)]);
  const params = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== 'offset')) as Record<string, string>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Response CRM"
        title="Incidents"
        description="Heat-response incidents in your assigned regions. Demo incidents are fictional."
        actions={
          <>
            <LinkButton href="/response" variant="secondary" size="sm">
              <ArrowLeft aria-hidden className="size-3.5" /> Dashboard
            </LinkButton>
            {can(user.assignments, 'incident:create') && (
              <LinkButton href="/response/incidents/new" size="sm">
                <Plus aria-hidden className="size-3.5" /> New incident
              </LinkButton>
            )}
          </>
        }
      />
      <FilterForm
        fields={[
          { name: 'q', label: 'Search', type: 'search', value: filters.q, placeholder: 'Ref, title or description' },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            value: status,
            options: [{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }, ...Object.entries(INCIDENT_STATUS_META).map(([v, m]) => ({ value: v, label: m.label }))],
          },
          { name: 'priority', label: 'Priority', type: 'select', value: filters.priority, allLabel: 'Any priority', options: Object.entries(PRIORITY_META).map(([v, m]) => ({ value: v, label: m.label })) },
          { name: 'severity', label: 'Severity', type: 'select', value: filters.severity, allLabel: 'Any severity', options: Object.entries(SEVERITY_META).map(([v, m]) => ({ value: v, label: m.label })) },
          { name: 'region', label: 'State', type: 'select', value: filters.region, allLabel: 'All regions', options: states.map((s) => ({ value: s.code, label: s.name })) },
          { name: 'teamId', label: 'Team', type: 'select', value: filters.teamId ? String(filters.teamId) : undefined, allLabel: 'Any team', options: teamList.map((t) => ({ value: String(t.id), label: t.name })) },
          { name: 'mine', label: 'Mine', type: 'checkbox', value: filters.mine ? 'true' : undefined },
          { name: 'overdue', label: 'Overdue', type: 'checkbox', value: filters.overdue ? 'true' : undefined },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState title="No incidents match these filters">Try “All” statuses or clear the filters.</EmptyState>
      ) : (
        <>
          {/* Table on wide screens */}
          <div className="glass hidden overflow-x-auto rounded-2xl md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Incidents</caption>
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Incident</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Priority</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Severity</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Region</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Team / owner</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Tasks</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-accent-soft/50">
                    <td className="max-w-md px-4 py-2.5">
                      <Link href={`/response/incidents/${i.ref}`} className="font-mono text-xs font-semibold text-accent hover:underline">
                        {i.ref}
                      </Link>
                      {i.isDemo && <DemoTag label="Demo" className="ml-1.5 align-middle" />}
                      <Link href={`/response/incidents/${i.ref}`} className="mt-0.5 block truncate font-medium hover:text-accent">
                        {i.title}
                      </Link>
                      <span className="text-xs text-fg-subtle">Updated {fmtRelative(i.updatedAt)}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <IncidentStatusBadge status={i.status} />
                    </td>
                    <td className="px-2 py-2.5">
                      <PriorityBadge priority={i.priority} />
                    </td>
                    <td className="px-2 py-2.5">
                      <SeverityBadge severity={i.severity} size="sm" />
                    </td>
                    <td className="px-2 py-2.5">{i.regionName}</td>
                    <td className="px-2 py-2.5">
                      <span className="block">{i.teamName ?? <span className="text-fg-subtle">—</span>}</span>
                      <span className="block text-xs text-fg-muted">{i.ownerName ?? 'No owner'}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular">
                      {i.openTasks}/{i.totalTasks}
                    </td>
                    <td className="px-4 py-2.5">
                      {i.dueAt ? <span className="whitespace-nowrap">{fmtDate(i.dueAt)}</span> : <span className="text-fg-subtle">—</span>}
                      {i.overdue && <OverdueChip className="mt-1" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Cards on small screens */}
          <ul className="flex flex-col gap-2.5 md:hidden">
            {items.map((i) => (
              <li key={i.id} className="glass rounded-2xl p-3.5">
                <p className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/response/incidents/${i.ref}`} className="font-mono text-xs font-semibold text-accent">
                    {i.ref}
                  </Link>
                  <PriorityBadge priority={i.priority} />
                  <IncidentStatusBadge status={i.status} />
                  {i.overdue && <OverdueChip />}
                </p>
                <Link href={`/response/incidents/${i.ref}`} className="mt-1 block font-medium">
                  {i.title}
                </Link>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
                  <SeverityBadge severity={i.severity} size="sm" /> {i.regionName} · {i.teamName ?? 'No team'} · {i.openTasks}/{i.totalTasks} tasks
                  {i.dueAt ? ` · due ${fmtDate(i.dueAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      <Pager total={total} limit={filters.limit!} offset={filters.offset!} params={params} path="/response/incidents" />
    </div>
  );
}
