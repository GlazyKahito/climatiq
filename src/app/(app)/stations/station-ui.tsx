'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { StationDot } from '@/components/map/station-dot';
import { STATION_STATUS_META, type StationStatus } from '@/server/stations/status';

/** Lazy, client-only MapLibre map of stations (MapLibre needs the browser). */
export const StationsMapLazy = dynamic(() => import('@/components/map/stations-map'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-fg-muted" aria-busy="true">
      Loading map…
    </div>
  ),
});

export function StatusPill({ status }: { status: StationStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-fg" title={STATION_STATUS_META[status].description}>
      <StationDot status={status} size={11} />
      {STATION_STATUS_META[status].label}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard unavailable — the value is visible for manual copy */
        }
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-xs text-fg hover:bg-accent-soft"
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {done ? 'Copied' : label}
    </button>
  );
}
