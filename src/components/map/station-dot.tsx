import { cn } from '@/lib/utils';

export type StationDotStatus = 'online' | 'degraded' | 'offline' | 'planned';

const COLOR: Record<StationDotStatus, string> = {
  online: 'var(--sev-low)',
  degraded: 'var(--sev-moderate)',
  offline: 'var(--fg-subtle)',
  planned: 'var(--prov-observed)',
};

/**
 * Station status marker. Status is encoded by shape as well as colour (never colour alone):
 * online = solid disc · degraded = disc with dashed ring · offline = hollow ring with a slash · planned = dotted ring.
 */
export function StationDot({ status, simulated, size = 14, className }: { status: StationDotStatus; simulated?: boolean; size?: number; className?: string }) {
  const c = COLOR[status];
  const r = size / 2;
  return (
    <svg width={size + 4} height={size + 4} viewBox={`-2 -2 ${size + 4} ${size + 4}`} aria-hidden className={cn('drop-shadow-sm', className)}>
      {status === 'online' && <circle cx={r} cy={r} r={r - 1} fill={c} stroke="var(--bg)" strokeWidth={1.5} />}
      {status === 'degraded' && (
        <>
          <circle cx={r} cy={r} r={r - 3} fill={c} />
          <circle cx={r} cy={r} r={r - 0.5} fill="none" stroke={c} strokeWidth={1.5} strokeDasharray="2.5 2" />
        </>
      )}
      {status === 'offline' && (
        <>
          <circle cx={r} cy={r} r={r - 1} fill="var(--bg)" stroke={c} strokeWidth={2} />
          <line x1={r * 0.45} y1={r * 1.55} x2={r * 1.55} y2={r * 0.45} stroke={c} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {status === 'planned' && <circle cx={r} cy={r} r={r - 1} fill="var(--bg)" stroke={c} strokeWidth={2} strokeDasharray="1 2" />}
      {simulated && status !== 'offline' && <circle cx={r} cy={r} r={1.6} fill="var(--bg)" />}
    </svg>
  );
}

export const STATION_DOT_LEGEND: { status: StationDotStatus; label: string }[] = [
  { status: 'online', label: 'Online' },
  { status: 'degraded', label: 'Degraded' },
  { status: 'offline', label: 'Offline' },
  { status: 'planned', label: 'Planned' },
];
