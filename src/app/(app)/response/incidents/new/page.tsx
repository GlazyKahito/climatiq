import type { Metadata } from 'next';
import { inArray } from 'drizzle-orm';
import { ArrowLeft, BellRing, FileText } from 'lucide-react';
import { LinkButton, PageHeader, Panel } from '@/components/ui/primitives';
import { SeverityBadge } from '@/components/ui/badges';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { regions } from '@/server/db/schema';
import { getAlert } from '@/server/alerts/service';
import { getAdvisory } from '@/server/advisories/service';
import { can } from '@/lib/rbac';
import type { Severity } from '@/lib/domain';
import { IncidentForm, type IncidentPrefill, type RegionGroup } from './incident-form';

export const metadata: Metadata = { title: 'New incident' };

const PRIORITY_FOR: Record<Severity, 'p1' | 'p2' | 'p3' | 'p4'> = { extreme: 'p1', high: 'p2', moderate: 'p3', low: 'p4' };

export default async function NewIncidentPage({ searchParams }: PageProps<'/response/incidents/new'>) {
  const user = await requirePagePermission('incident:create');
  const sp = await searchParams;
  const db = getDb();

  let prefill: IncidentPrefill = {};
  let source: { kind: 'alert' | 'advisory'; title: string; severity: Severity } | null = null;
  let prefillNote: string | null = null;
  const alertId = typeof sp.alert === 'string' && /^[0-9a-f-]{36}$/i.test(sp.alert) ? sp.alert : null;
  const advisoryId = typeof sp.advisory === 'string' && /^[0-9a-f-]{36}$/i.test(sp.advisory) ? sp.advisory : null;
  try {
    if (alertId) {
      const a = await getAlert(db, user, alertId);
      source = { kind: 'alert', title: a.title, severity: a.severity };
      prefill = {
        alertId: a.id,
        regionCode: a.regionCode,
        severity: a.severity,
        priority: PRIORITY_FOR[a.severity],
        title: `Heat response: ${a.regionName} (${a.severity} heat risk)`,
        description: `Opened from CLIMATIQ alert “${a.title}”.\n\n${a.message}\n\nDescribe the situation on the ground and the support needed.`,
      };
    } else if (advisoryId) {
      const adv = await getAdvisory(db, user, advisoryId);
      const r = adv.regions[0];
      source = { kind: 'advisory', title: adv.title, severity: adv.severity };
      prefill = {
        advisoryId: adv.id,
        regionCode: r?.code,
        severity: adv.severity,
        priority: PRIORITY_FOR[adv.severity],
        title: `Heat response: ${adv.regions.map((x) => x.name).join(', ')}`,
        description: `Opened from CLIMATIQ advisory “${adv.title}”.\n\n${adv.content.summary}\n\nDescribe the situation on the ground and the support needed.`,
      };
    }
  } catch {
    prefillNote = 'The linked alert/advisory is not available for your role, so the form was not pre-filled.';
  }

  const rows = await db
    .select({ code: regions.code, name: regions.name, level: regions.level, path: regions.path, parentId: regions.parentId, id: regions.id })
    .from(regions)
    .where(inArray(regions.level, ['state', 'district']));
  const states = rows.filter((r) => r.level === 'state').sort((a, b) => a.name.localeCompare(b.name));
  const groups: RegionGroup[] = states
    .map((s) => ({
      state: s.name,
      options: [s, ...rows.filter((d) => d.parentId === s.id).sort((a, b) => a.name.localeCompare(b.name))]
        .filter((r) => can(user.assignments, 'incident:create', r.path))
        .map((r) => ({ code: r.code, label: r.level === 'state' ? `${r.name} (whole state)` : r.name })),
    }))
    .filter((g) => g.options.length > 0);
  if (prefill.regionCode && !groups.some((g) => g.options.some((o) => o.code === prefill.regionCode))) {
    prefillNote = 'You cannot open incidents in the linked region; choose a region within your assignment.';
    prefill = { ...prefill, regionCode: undefined };
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Response CRM"
        title="Report an incident"
        description="Open a response incident for a heat-related situation in your region. You can assign a team, owner and tasks after creating it."
        actions={
          <LinkButton href="/response/incidents" variant="secondary" size="sm">
            <ArrowLeft aria-hidden className="size-3.5" /> Incidents
          </LinkButton>
        }
      />
      {source && (
        <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-sm">
          {source.kind === 'alert' ? <BellRing aria-hidden className="size-4 text-accent" /> : <FileText aria-hidden className="size-4 text-accent" />}
          <span className="font-medium">Linked {source.kind}:</span>
          <span className="min-w-0 flex-1 truncate">{source.title}</span>
          <SeverityBadge severity={source.severity} size="sm" />
        </div>
      )}
      {prefillNote && <p className="rounded-xl border border-dashed border-line-strong px-3 py-2 text-sm text-fg-muted">{prefillNote}</p>}
      <Panel>
        <IncidentForm groups={groups} prefill={prefill} />
      </Panel>
    </div>
  );
}
