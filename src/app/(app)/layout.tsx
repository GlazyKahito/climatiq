import { cookies } from 'next/headers';
import { AppShell } from '@/components/shell/app-shell';
import { NAV, SECONDARY_NAV } from '@/lib/nav';
import { can } from '@/lib/rbac';
import { requireUser } from '@/server/auth/dal';
import { describeScope, listDemoAccounts } from '@/server/auth/demo';
import { getDb } from '@/server/db/client';
import { env } from '@/server/config/env';
import { inboxFor } from '@/server/notifications/inbox';
import { currentScenario, REPLAY } from '@/server/scenario';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser();
  const db = getDb();
  const [inbox, demoAccounts, scenario, themeCookie] = await Promise.all([
    inboxFor(db, user.id),
    env().DEMO_MODE ? listDemoAccounts(db) : Promise.resolve(null),
    currentScenario(),
    cookies().then((c) => c.get('cq_theme')?.value),
  ]);
  const scope = describeScope(user.assignments);
  const theme = themeCookie === 'dark' || themeCookie === 'system' ? themeCookie : 'light';

  const nav = NAV.filter((n) => !n.permission || can(user.assignments, n.permission));
  return (
    <AppShell
      nav={nav}
      tour={{ allowedRoutes: nav.map((n) => n.href), autoStart: env().DEMO_MODE && user.isDemo && user.primaryRole !== 'public' }}
      secondaryNav={SECONDARY_NAV}
      topbar={{
        user: { name: user.name, designation: user.designation, isDemo: user.isDemo, ...scope },
        scenario,
        replayLabel: REPLAY.label,
        theme,
        inbox,
        demoAccounts: demoAccounts?.map((a) => ({ id: a.id, name: a.name, roleLabel: a.roleLabel, scopeLabel: a.scopeLabel })) ?? null,
      }}
    >
      {children}
    </AppShell>
  );
}
