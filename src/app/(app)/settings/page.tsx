import type { Metadata } from 'next';
import { Bell, Database, MapPin, ShieldCheck } from 'lucide-react';
import { DemoTag } from '@/components/ui/badges';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { requireUser } from '@/server/auth/dal';
import { ROLES } from '@/lib/rbac';
import { PasswordForm, ProfileForm, RestartTourButton } from './forms';

export const metadata: Metadata = { title: 'Profile & settings' };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHeader eyebrow="Account" title="Profile & settings" description="Your profile, access, preferences and how your data is handled." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Profile" description={user.email} actions={user.isDemo ? <DemoTag label="Fictional demo account" /> : undefined}>
          <ProfileForm name={user.name} designation={user.designation} />
        </Panel>

        <Panel title="Access" description="Roles and the geographic areas they apply to. Managed by administrators.">
          <ul className="flex flex-col gap-2">
            {user.assignments.map((a) => (
              <li key={`${a.roleKey}-${a.regionId ?? 'all'}`} className="rounded-xl border border-line bg-glass-strong p-3">
                <p className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="size-4 text-accent" aria-hidden /> {ROLES[a.roleKey]?.name ?? a.roleKey}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-fg-muted">
                  <MapPin className="size-3.5" aria-hidden /> {a.regionName ?? 'All India'}
                </p>
                <p className="mt-1 text-xs text-fg-subtle">{a.permissions.length} permissions · {ROLES[a.roleKey]?.description}</p>
              </li>
            ))}
            {user.assignments.length === 0 && <li className="text-sm text-fg-muted">No roles assigned — you can use the public portal.</li>}
          </ul>
        </Panel>

        <Panel title="Notifications" actions={<Bell className="size-4 text-fg-subtle" aria-hidden />}>
          <p className="text-sm text-fg-muted">
            Alerts and assignments are delivered <strong className="text-fg">in-app</strong> for the regions you are responsible for. Email and SMS delivery are planned and not enabled in this prototype.
          </p>
        </Panel>

        <Panel title="Password" description={user.isDemo ? 'Demo accounts use a shared, published password.' : 'Change your sign-in password.'}>
          <PasswordForm disabled={user.isDemo} />
        </Panel>

        <Panel title="Guided tour" description="A step-by-step walkthrough of the command center, forecasts, advisories, analytics, stations and response.">
          <RestartTourButton />
        </Panel>

        <Panel className="lg:col-span-2" title="Your data" actions={<Database className="size-4 text-fg-subtle" aria-hidden />}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>Stored: name, email, designation, role and region assignments, a bcrypt password hash and last sign-in time.</li>
            <li>Actions that change data (incidents, advisories, alerts, settings) are recorded in an audit log with your name.</li>
            <li>Sessions use a signed, http-only cookie that expires after 12 hours.</li>
            <li>No personal data is sent to AI providers or weather services.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
