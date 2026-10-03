import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { EmptyState, PageHeader, Panel } from '@/components/ui/primitives';
import { scopesFor } from '@/lib/rbac';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { env } from '@/server/config/env';
import { registrableRegions } from '@/server/stations/queries';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Register IoT station' };

export default async function RegisterStationPage() {
  const user = await requirePagePermission('station:manage');
  const groups = await registrableRegions(getDb(), scopesFor(user.assignments, 'station:manage'));
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <Link href="/stations" className="inline-flex w-fit items-center gap-1 text-xs text-fg-muted hover:text-fg hover:underline">
        <ArrowLeft className="size-3.5" aria-hidden /> All stations
      </Link>
      <PageHeader
        eyebrow="Weather stations"
        title="Register an IoT station"
        description="For future physical stations. Registration creates the station record and a per-station API key; the device then pushes observations to the REST ingestion endpoint."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Station details">
          {groups.length ? <RegisterForm groups={groups} appUrl={env().APP_URL} /> : <EmptyState title="No regions available">Your role does not include a region where stations can be managed.</EmptyState>}
        </Panel>
        <Panel title="How ingestion works">
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-fg-muted">
            <li>The station gets a code (e.g. IOT-RJ-001) and status “planned”.</li>
            <li>An API key is generated and shown once; only its SHA-256 hash is stored.</li>
            <li>
              The device sends <code className="font-mono text-xs">POST /api/v1/stations/&#123;code&#125;/observations</code> with{' '}
              <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code> (≤ 500 observations per request, ≤ 60 requests/min).
            </li>
            <li>Timestamps more than 10 min in the future or older than 30 days are rejected; physically impossible values are rejected.</li>
            <li>Implausible values and sudden jumps are stored as “suspect”; everything else as “unverified”. Nothing is auto-verified.</li>
            <li>Duplicate timestamps are ignored, so retries are safe. Each request is logged as an ingestion run and audited.</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}
