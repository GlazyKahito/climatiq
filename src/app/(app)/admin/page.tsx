import type { Metadata } from 'next';
import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { Activity, Bot, Database, FlaskConical, KeyRound, ShieldCheck, UserX } from 'lucide-react';
import { DemoTag } from '@/components/ui/badges';
import { buttonClass, EmptyState, MetricCard, PageHeader, Panel } from '@/components/ui/primitives';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { appConfig, auditLogs, severityThresholds } from '@/server/db/schema';
import { env } from '@/server/config/env';
import { operationalCounts, recentForecastRuns, recentIngestionRuns, sourceStatuses } from '@/server/admin/status';
import { grantableRoles, listManagedUsers } from '@/server/admin/users';
import { can } from '@/lib/rbac';
import { fmtDateTime, fmtRelative } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { revokeAssignmentAction, setActiveAction } from './actions';
import { AlertConfigForm, CreateUserForm, GrantRoleForm, JobButton, ResetDemoForm, ThresholdRow } from './forms';

export const metadata: Metadata = { title: 'Administration' };

const TABS = [
  ['overview', 'Overview'],
  ['users', 'Users & access'],
  ['ingestion', 'Ingestion'],
  ['audit', 'Audit log'],
  ['config', 'Configuration'],
  ['demo', 'Demo'],
] as const;

function StatusDot({ status }: { status: string | null }) {
  const color = status === 'succeeded' ? 'var(--sev-low)' : status === 'failed' ? 'var(--sev-extreme)' : status === 'partial' || status === 'running' ? 'var(--sev-moderate)' : 'var(--fg-subtle)';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize">
      <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
      {status ?? 'never run'}
    </span>
  );
}

export default async function AdminPage({ searchParams }: PageProps<'/admin'>) {
  const user = await requirePagePermission('admin:view');
  const tab = (await searchParams).tab;
  const active = TABS.some(([k]) => k === tab) ? (tab as (typeof TABS)[number][0]) : 'overview';
  const db = getDb();
  const e = env();
  const perms = {
    users: can(user.assignments, 'admin:users'),
    audit: can(user.assignments, 'audit:view'),
    config: can(user.assignments, 'config:edit'),
    ingest: can(user.assignments, 'ingestion:run'),
    forecast: can(user.assignments, 'forecast:run'),
    reset: can(user.assignments, 'demo:reset') && e.DEMO_MODE,
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Administration" title="Operate & monitor the prototype" description="Data ingestion, model runs, users and access, audit trail and demo controls. Every change here is audited." />
      <nav aria-label="Administration sections" className="flex flex-wrap gap-1.5">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={`/admin?tab=${k}`}
            aria-current={active === k ? 'page' : undefined}
            className={cn('rounded-xl px-3 py-1.5 text-sm font-medium', active === k ? 'bg-wine text-sand dark:bg-accent dark:text-accent-fg' : 'glass text-fg-muted hover:text-fg')}
          >
            {label}
          </Link>
        ))}
      </nav>

      {active === 'overview' && <Overview />}
      {active === 'users' && (perms.users ? <Users /> : <EmptyState title="You cannot manage users">This requires the “Manage users, roles and geographic assignments” permission.</EmptyState>)}
      {active === 'ingestion' && <Ingestion />}
      {active === 'audit' && (perms.audit ? <Audit /> : <EmptyState title="You cannot view the audit log" />)}
      {active === 'config' && <Config />}
      {active === 'demo' && <Demo />}
    </div>
  );

  async function Overview() {
    const [sources, runs, counts] = await Promise.all([sourceStatuses(db), recentForecastRuns(db, 4), operationalCounts(db)]);
    const aiConfigured = e.AI_PROVIDER === 'gemini' ? Boolean(e.GEMINI_API_KEY) : e.AI_PROVIDER === 'anthropic' ? Boolean(e.ANTHROPIC_API_KEY) : true;
    return (
      <>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Advisories" value={counts.advisories.total} hint={`${counts.advisories.published} published · ${counts.advisories.drafts} drafts · ${counts.advisories.fallbacks} via fallback`} />
          <MetricCard label="Open alerts" value={counts.alerts.open} hint={`${counts.alerts.total} alerts raised in total`} />
          <MetricCard label="Notifications" value={counts.notifications.total} hint={`${counts.notifications.unread} unread · in-app channel`} />
          <MetricCard label="Forecast runs" value={runs.length ? fmtRelative(runs[0].createdAt) : '—'} hint={runs[0] ? `latest: ${runs[0].scenario}, ${runs[0].status}` : 'no runs yet'} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Panel title="Data sources & API connections" description="Last successful and failed synchronisation per source.">
            <ul className="flex flex-col divide-y divide-line">
              {sources.map((s) => (
                <li key={s.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
                  <Database className="mt-0.5 size-4 text-fg-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-fg-muted">
                      {s.kind === 'model'
                        ? runs[0]
                          ? `Model output — latest forecast run ${fmtRelative(runs[0].createdAt)} (${runs[0].scenario})`
                          : 'Model output — no forecast run yet'
                        : s.isConfigured
                          ? s.lastSuccess
                            ? `Last success ${fmtRelative(s.lastSuccess)} (${fmtDateTime(s.lastSuccess)})`
                            : 'No successful sync yet'
                          : 'Not configured — see methodology'}
                      {s.lastFailure && ` · last failure ${fmtRelative(s.lastFailure)}`}
                    </p>
                    {s.lastError && <p className="mt-0.5 line-clamp-2 text-xs text-accent">{s.lastError}</p>}
                  </div>
                  <StatusDot status={s.kind === 'model' ? (runs[0]?.status ?? null) : s.isConfigured ? s.lastStatus : 'not configured'} />
                </li>
              ))}
            </ul>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel title="AI advisory provider" actions={<Bot className="size-4 text-fg-subtle" aria-hidden />}>
              <p className="text-sm">
                Provider: <strong className="capitalize">{e.AI_PROVIDER}</strong>
                {e.AI_PROVIDER === 'gemini' && ` · ${e.GEMINI_MODEL}`}
                {e.AI_PROVIDER === 'anthropic' && ` · ${e.ANTHROPIC_MODEL}`}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {aiConfigured
                  ? e.AI_PROVIDER === 'template'
                    ? 'Deterministic template provider (no external AI). Set AI_PROVIDER and an API key to enable an LLM.'
                    : 'API key configured (stored server-side only).'
                  : 'API key missing — advisories fall back to the deterministic template.'}
              </p>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {counts.advisories.byProvider.map((p) => (
                  <li key={p.provider} className="rounded-md bg-accent-soft px-2 py-0.5">
                    {p.provider}: {p.n}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Scheduled ingestion" actions={<KeyRound className="size-4 text-fg-subtle" aria-hidden />}>
              <p className="text-sm text-fg-muted">
                Daily Vercel Cron → <code className="break-all font-mono text-xs">/api/v1/cron/refresh</code> ({e.CRON_SECRET ? 'secret configured' : 'CRON_SECRET not set — scheduled refresh disabled'}). Manual runs are on the Ingestion tab.
              </p>
            </Panel>
            <Panel title="Recent forecast runs" actions={<Activity className="size-4 text-fg-subtle" aria-hidden />}>
              <ul className="flex flex-col gap-2 text-sm">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="font-medium capitalize">{r.scenario}</span> · {r.issuedFor} · {r.regionsCount} regions{r.isHindcast ? ' · hindcast' : ''}
                    </span>
                    <StatusDot status={r.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </>
    );
  }

  async function Users() {
    const [list, roles] = await Promise.all([listManagedUsers(db, user), grantableRoles(user)]);
    return (
      <div className="flex flex-col gap-4">
        <Panel title="Users in your administrative scope" description="Grant or revoke roles per region. You can only grant roles at or below your own seniority, within your regions.">
          <ul className="flex flex-col divide-y divide-line">
            {list.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.name}</span>
                  <span className="text-xs text-fg-muted">{u.email}</span>
                  {u.isDemo && <DemoTag label="Fictional" />}
                  {!u.isActive && <span className="rounded bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">DEACTIVATED</span>}
                  <span className="ml-auto text-xs text-fg-subtle">{u.lastLoginAt ? `Last sign-in ${fmtRelative(u.lastLoginAt)}` : 'Never signed in'}</span>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {u.assignments.map((a) => (
                    <li key={a.id} className="flex items-center gap-1 rounded-lg border border-line bg-glass-strong py-0.5 pl-2 pr-1 text-xs">
                      <ShieldCheck className="size-3 text-accent" aria-hidden /> {a.roleName} · {a.regionName ?? 'All India'}
                      <form action={revokeAssignmentAction}>
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <button type="submit" className="ml-1 rounded px-1 text-fg-subtle hover:bg-accent-soft hover:text-accent" aria-label={`Revoke ${a.roleName} for ${u.name}`}>
                          ×
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-end gap-3">
                  <GrantRoleForm userId={u.id} roles={roles} />
                  {u.id !== user.id && (
                    <form action={setActiveAction} className="ml-auto">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="active" value={u.isActive ? 'false' : 'true'} />
                      <button type="submit" className={buttonClass('ghost', 'sm')}>
                        <UserX className="size-3.5" aria-hidden /> {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Create a user" description="New users receive one role in one region; add more roles afterwards.">
          <CreateUserForm roles={roles} />
        </Panel>
      </div>
    );
  }

  async function Ingestion() {
    const runs = await recentIngestionRuns(db, 40);
    return (
      <div className="flex flex-col gap-4">
        <Panel title="Run jobs" description="Jobs call Open-Meteo within free-tier limits (batched, with retry and back-off). Failures are recorded — data is never invented.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {perms.ingest && <JobButton job="history" label="Refresh recent history" description="Last 21 days of ERA5 reanalysis for all states and pilot districts (≈5-day lag)." />}
            {perms.ingest && <JobButton job="grid" label="Refresh live heat grid" description="Open-Meteo NWP maximum temperature on the 1° India grid for the next 7 days." />}
            {perms.forecast && <JobButton job="forecast" label="Run live forecast" description="New baseline-v1 run (fetches NWP per region) and alert evaluation." />}
            {perms.ingest && <JobButton job="retention" label="Apply retention" description="Delete read notifications > 30 days and live runs > 400 days." />}
          </div>
          {!perms.ingest && !perms.forecast && <p className="text-sm text-fg-muted">Your role can view ingestion status but not run jobs.</p>}
        </Panel>
        <Panel title="Ingestion history">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-subtle">
                  <th className="py-2 pr-3">Started</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Job</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Records</th>
                  <th className="py-2 pr-3">Triggered by</th>
                  <th className="py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDateTime(r.startedAt)}</td>
                    <td className="py-1.5 pr-3">{r.source}</td>
                    <td className="py-1.5 pr-3">{r.job}</td>
                    <td className="py-1.5 pr-3">
                      <StatusDot status={r.status} />
                    </td>
                    <td className="tabular py-1.5 pr-3">{r.recordsWritten.toLocaleString('en-IN')}</td>
                    <td className="py-1.5 pr-3 text-xs">{r.triggeredBy}</td>
                    <td className="max-w-64 py-1.5 text-xs text-accent">{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    );
  }

  async function Audit() {
    const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
    return (
      <Panel title="Audit log" description="Latest 100 entries. Snapshots exclude secrets and password hashes.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-subtle">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Entity</th>
                <th className="py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="py-1.5 pr-3">{r.actorLabel}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.action}</td>
                  <td className="py-1.5 pr-3 text-xs">
                    {r.entityType}
                    {r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}
                  </td>
                  <td className="max-w-md py-1.5">
                    {r.after != null && (
                      <details>
                        <summary className="cursor-pointer text-xs text-accent">View</summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-accent-soft p-2 font-mono text-[11px]">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  async function Config() {
    const [cfg, thresholds] = await Promise.all([db.select().from(appConfig), db.select().from(severityThresholds).orderBy(severityThresholds.zone, severityThresholds.id)]);
    const values = Object.fromEntries(cfg.map((c) => [c.key, c.value]));
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <Panel title="Automated alert rules" description={perms.config ? 'Applied from the next forecast run. Changes are audited.' : 'Read-only for your role.'}>
          <AlertConfigForm values={values} disabled={!perms.config} />
        </Panel>
        <Panel title="Severity thresholds" description="High/Extreme mirror IMD heatwave criteria; Moderate is a CLIMATIQ band. Changing them changes classification — not IMD’s definitions.">
          {thresholds.map((t) => (
            <ThresholdRow key={t.id} t={t} disabled={!perms.config} />
          ))}
        </Panel>
      </div>
    );
  }

  async function Demo() {
    if (!e.DEMO_MODE) return <EmptyState title="Demo mode is off">Demo controls are only available when DEMO_MODE=true.</EmptyState>;
    return (
      <Panel title="Safe demo reset" actions={<FlaskConical className="size-4 text-fg-subtle" aria-hidden />}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="text-sm text-fg-muted">
            <p className="font-semibold text-fg">What the reset does</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Deletes demo-flagged incidents (with tasks and activity), advisories, alerts and notifications, records created by demo accounts during the demo, and simulated stations.</li>
              <li>Restores every fictional demo account&apos;s roles and active status.</li>
              <li>Re-creates the demo stations and the demo response story.</li>
            </ul>
            <p className="mt-2 font-semibold text-fg">What it keeps</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Configuration and thresholds, real climate history, forecast runs, non-demo users and the audit log.</li>
            </ul>
          </div>
          {perms.reset ? <ResetDemoForm /> : <p className="text-sm text-fg-muted">Only system administrators can reset the demo.</p>}
        </div>
      </Panel>
    );
  }
}
