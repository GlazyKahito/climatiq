import type { Metadata } from 'next';
import { Bell, BellRing, FileText, Sparkles } from 'lucide-react';
import { LinkButton, PageHeader } from '@/components/ui/primitives';
import { TabNav } from '@/components/advisories/tab-nav';
import { OfficialWarningsNotice } from '@/components/advisories/provenance';
import { requireUser } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { currentScenario } from '@/server/scenario';
import { regionsByLevel } from '@/server/geo/regions';
import { advisoryStatusCounts, officialWarningsFor } from '@/server/advisories/service';
import { alertStatusCounts } from '@/server/alerts/service';
import { inboxFor } from '@/server/notifications/inbox';
import { can } from '@/lib/rbac';
import { AdvisoriesTab } from './_components/advisories-tab';
import { AlertsTab } from './_components/alerts-tab';
import { NotificationsTab } from './_components/notifications-tab';

export const metadata: Metadata = { title: 'Advisories & alerts' };

const TABS = ['advisories', 'alerts', 'notifications'] as const;
type Tab = (typeof TABS)[number];

export default async function AdvisoriesPage({ searchParams }: PageProps<'/advisories'>) {
  const user = await requireUser();
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : can(user.assignments, 'advisory:view_internal') ? 'advisories' : 'notifications';
  const { tab: _t, ...filters } = sp;
  void _t;

  const db = getDb();
  const scenario = await currentScenario();
  const [states, advCounts, alertCounts, inbox, official] = await Promise.all([
    regionsByLevel(db, 'state'),
    advisoryStatusCounts(db, user),
    alertStatusCounts(db, user, scenario),
    inboxFor(db, user.id, 0),
    officialWarningsFor(db),
  ]);
  const stateOptions = states.map((s) => ({ value: s.code, label: s.name }));
  const canGenerate = can(user.assignments, 'advisory:generate');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Advisories & alerts"
        title="Advisories, alerts & notifications"
        description="AI-assisted advisories reviewed and approved by officials, automated alerts from CLIMATIQ forecast runs, and your in-app notifications. CLIMATIQ content is decision support — not an official IMD warning."
        actions={
          canGenerate ? (
            <LinkButton href="/advisories/new" size="sm">
              <Sparkles aria-hidden className="size-3.5" /> Generate advisory
            </LinkButton>
          ) : undefined
        }
      />
      <OfficialWarningsNotice warnings={official} compact={tab === 'notifications'} />
      <TabNav
        label="Advisories, alerts and notifications"
        active={tab}
        items={[
          { key: 'advisories', label: 'Advisories', href: '/advisories?tab=advisories', count: advCounts.draft, icon: <FileText aria-hidden className="size-4" /> },
          { key: 'alerts', label: 'Alerts', href: '/advisories?tab=alerts', count: alertCounts.active, icon: <BellRing aria-hidden className="size-4" />, tour: 'alerts' },
          { key: 'notifications', label: 'Notifications', href: '/advisories?tab=notifications', count: inbox.unread, icon: <Bell aria-hidden className="size-4" /> },
        ]}
      />
      {tab === 'advisories' && <AdvisoriesTab user={user} sp={filters} stateOptions={stateOptions} />}
      {tab === 'alerts' && <AlertsTab user={user} sp={filters} scenario={scenario} stateOptions={stateOptions} />}
      {tab === 'notifications' && <NotificationsTab user={user} sp={filters} stateOptions={stateOptions} />}
    </div>
  );
}
