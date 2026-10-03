import Link from 'next/link';
import { CalendarRange, MapPin, Sparkles } from 'lucide-react';
import { EmptyState, LinkButton } from '@/components/ui/primitives';
import { DemoTag, SeverityBadge } from '@/components/ui/badges';
import { AdvisoryStatusBadge, AudienceBadge, ProviderChip, ScenarioBadge } from '@/components/advisories/badges';
import { FilterForm } from '@/components/advisories/filter-form';
import { Pager } from '@/components/advisories/pager';
import { listAdvisories, type AdvisoryFilters } from '@/server/advisories/service';
import type { AppUser } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { AUDIENCE_META, fmtDate, fmtRelative, SEVERITY_META } from '@/lib/domain';
import { can } from '@/lib/rbac';

type SP = Record<string, string | undefined>;
const STATUSES = ['draft', 'approved', 'published', 'archived'] as const;

export async function AdvisoriesTab({ user, sp, stateOptions }: { user: AppUser; sp: SP; stateOptions: { value: string; label: string }[] }) {
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
  const filters: AdvisoryFilters = {
    status: pick(sp.status, [...STATUSES, 'all'] as const) ?? 'all',
    audience: pick(sp.audience, Object.keys(AUDIENCE_META) as (keyof typeof AUDIENCE_META)[]),
    severity: pick(sp.severity, Object.keys(SEVERITY_META) as (keyof typeof SEVERITY_META)[]),
    region: sp.region && /^[A-Z0-9-]+$/.test(sp.region) ? sp.region : undefined,
    scenario: pick(sp.scenario, ['live', 'replay'] as const),
    limit: 20,
    offset: Math.max(Number(sp.offset) || 0, 0),
  };
  const { items, total } = await listAdvisories(getDb(), user, filters);
  const internal = can(user.assignments, 'advisory:view_internal');
  const params = Object.fromEntries(Object.entries({ tab: 'advisories', ...sp }).filter(([k, v]) => v && k !== 'offset')) as Record<string, string>;

  return (
    <div className="flex flex-col gap-4" data-tour="advisories">
      <FilterForm
        hidden={{ tab: 'advisories' }}
        fields={[
          { name: 'status', label: 'Status', type: 'select', value: filters.status === 'all' ? '' : filters.status, allLabel: 'All statuses', options: STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
          { name: 'audience', label: 'Audience', type: 'select', value: filters.audience, allLabel: 'All audiences', options: Object.entries(AUDIENCE_META).map(([v, m]) => ({ value: v, label: m.label })) },
          { name: 'severity', label: 'Severity', type: 'select', value: filters.severity, allLabel: 'Any severity', options: Object.entries(SEVERITY_META).map(([v, m]) => ({ value: v, label: m.label })) },
          { name: 'region', label: 'Region', type: 'select', value: filters.region, allLabel: 'All regions', options: stateOptions },
          { name: 'scenario', label: 'Scenario', type: 'select', value: filters.scenario, allLabel: 'All', options: [{ value: 'replay', label: 'Replay 2024' }, { value: 'live', label: 'Live' }] },
        ]}
      />
      {!internal && (
        <p className="rounded-xl border border-dashed border-line-strong px-3 py-2 text-xs text-fg-muted">
          Your role sees published public advisories only. Internal drafts and audience-specific advisories are visible to officials in their assigned regions.
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState
          title="No advisories match these filters"
          action={
            can(user.assignments, 'advisory:generate') ? (
              <LinkButton href="/advisories/new" size="sm">
                <Sparkles aria-hidden className="size-3.5" /> Generate an advisory
              </LinkButton>
            ) : undefined
          }
        >
          Advisories are generated from CLIMATIQ forecast runs, reviewed by an authorised official and then published.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map((a) => (
            <li key={a.id}>
              <article className="glass flex h-full flex-col gap-2.5 rounded-2xl p-4 transition hover:shadow-lg">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityBadge severity={a.severity} size="sm" />
                  <AdvisoryStatusBadge status={a.status} />
                  <AudienceBadge audience={a.audience} />
                  <ScenarioBadge scenario={a.scenario} />
                  {a.isDemo && <DemoTag label="Demo" />}
                </div>
                <h3 className="text-base font-semibold leading-snug">
                  <Link href={`/advisories/${a.id}`} className="hover:text-accent hover:underline">
                    {a.title}
                  </Link>
                </h3>
                <p className="line-clamp-3 text-sm leading-relaxed text-fg-muted">{a.summary}</p>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-xs text-fg-subtle">
                  <span className="inline-flex items-center gap-1">
                    <MapPin aria-hidden className="size-3.5" /> {a.regionNames.join(', ') || '—'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarRange aria-hidden className="size-3.5" /> {fmtDate(a.validFrom, { day: 'numeric', month: 'short' })} – {fmtDate(a.validTo)}
                  </span>
                  <ProviderChip provider={a.provider} modelName={a.modelName} fallback={Boolean(a.fallbackReason)} />
                  <span title={new Date(a.generatedAt).toISOString()}>
                    {a.status === 'published' && a.publishedAt ? `Published ${fmtRelative(a.publishedAt)}` : `Generated ${fmtRelative(a.generatedAt)}`}
                    {a.generatedByName ? ` · ${a.generatedByName}` : ''}
                  </span>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      <Pager total={total} limit={filters.limit!} offset={filters.offset!} params={params} path="/advisories" />
    </div>
  );
}
