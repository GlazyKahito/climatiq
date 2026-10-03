import type { Metadata } from 'next';
import { History, Radio } from 'lucide-react';
import { PageHeader } from '@/components/ui/primitives';
import { OriginTag } from '@/components/ui/badges';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { currentScenario, REPLAY } from '@/server/scenario';
import { commandOverview } from '@/server/command/overview';
import { resolveFocus } from '@/server/command/map-data';
import { fmtDate } from '@/lib/domain';
import { CommandCenter } from './command-center';
import { SidePanels } from './side-panels';

export const metadata: Metadata = { title: 'Command center' };

export default async function CommandPage({ searchParams }: PageProps<'/command'>) {
  const user = await requirePagePermission('dashboard:view');
  const sp = await searchParams;
  const region = typeof sp.region === 'string' ? sp.region.toUpperCase() : null;
  const day = typeof sp.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const scenario = await currentScenario();
  const db = getDb();
  const [o, focus] = await Promise.all([commandOverview(db, { scenario, assignments: user.assignments }), resolveFocus(db, region)]);

  const replay = scenario === 'replay';
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Climate command center"
        title="India heat situation"
        description={
          replay
            ? `${REPLAY.label}. Hindcasts issued as of ${fmtDate(o.run?.issuedFor ?? REPLAY.issuedFor)} — a historical replay, not a current emergency.`
            : `Live CLIMATIQ forecasts${o.run ? ` issued for ${fmtDate(o.run.issuedFor)}` : ''} from Open-Meteo NWP guidance blended by the baseline-v1 model.`
        }
        actions={
          <>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-xs font-semibold text-fg"
              title={replay ? REPLAY.label : 'Live data scenario'}
            >
              {replay ? <History className="size-3.5 text-accent" aria-hidden /> : <Radio className="size-3.5 text-accent" aria-hidden />}
              {replay ? REPLAY.shortLabel : 'Live'}
            </span>
            <OriginTag origin="climatiq" />
          </>
        }
      />
      <CommandCenter o={o} initialFocus={focus} initialDay={day} sidePanels={<SidePanels o={o} />} />
      <p className="text-[11px] text-fg-subtle">
        CLIMATIQ is a decision-support prototype, not an official IMD warning — refer to{' '}
        <a className="underline" href="https://mausam.imd.gov.in" target="_blank" rel="noopener noreferrer">
          mausam.imd.gov.in
        </a>{' '}
        for official warnings. Weather data by{' '}
        <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
          Open-Meteo.com
        </a>{' '}
        (CC BY 4.0) incl. ECMWF/Copernicus ERA5 &amp; IFS; indices derived by CLIMATIQ. Boundaries: geoBoundaries (Runfola et al. 2020), states © DataMeet (CC
        BY 2.5 IN), districts from geoBoundaries IND ADM2 (LGD, ODbL 1.0); places © GeoNames (CC BY 4.0). Boundaries are approximate and not authenticated by
        Survey of India.
      </p>
    </div>
  );
}
