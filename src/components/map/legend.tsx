'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { legendFor, METRIC_META, TMAX_BINS, type Palette } from './scales';
import { STATION_DOT_LEGEND, StationDot } from './station-dot';
import type { MapMetric } from './types';

/** Map legend with text labels for every colour (and station marker shapes). Collapsible on small screens. */
export function MapLegend({
  metric,
  palette,
  showChoropleth,
  showHeat,
  showStations,
  heatNote,
  className,
}: {
  metric: MapMetric;
  palette: Palette;
  showChoropleth: boolean;
  showHeat: boolean;
  showStations: boolean;
  heatNote?: string;
  className?: string;
}) {
  // The map (and its legend) only render on the client, so the initial state can read the viewport directly.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 640px)').matches);
  return (
    <div className={cn('glass-strong w-48 max-w-[calc(100vw-3rem)] rounded-xl text-[11px]', className)}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-semibold text-fg"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Legend
        <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} aria-hidden />
      </button>
      {open && (
        <div className="flex max-h-[38vh] flex-col gap-2 overflow-y-auto px-3 pb-2.5">
          {showChoropleth && (
            <section>
              <h3 className="mb-1 font-semibold text-fg-muted">{METRIC_META[metric].short}</h3>
              <ul className="flex flex-col gap-1">
                {legendFor(metric, palette).map((i) => (
                  <li key={i.label} className="flex items-center gap-2" title={i.description}>
                    <span aria-hidden className="size-3 shrink-0 rounded-[3px] border border-black/10" style={{ background: i.color }} />
                    <span className="text-fg">{i.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {showHeat && (
            <section>
              <h3 className="mb-1 font-semibold text-fg-muted">Heat grid · Tmax</h3>
              <div aria-hidden className="flex h-2.5 overflow-hidden rounded-sm">
                {palette.heat.map((c) => (
                  <span key={c} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-fg-muted">
                <span>&lt; {TMAX_BINS[1].min} °C</span>
                <span>≥ {TMAX_BINS[6].min} °C</span>
              </div>
              {heatNote && <p className="mt-1 text-fg-subtle">{heatNote}</p>}
            </section>
          )}
          {showStations && (
            <section>
              <h3 className="mb-1 font-semibold text-fg-muted">Stations</h3>
              <ul className="grid grid-cols-2 gap-1">
                {STATION_DOT_LEGEND.map((s) => (
                  <li key={s.status} className="flex items-center gap-2">
                    <StationDot status={s.status} size={11} />
                    <span className="text-fg">{s.label}</span>
                  </li>
                ))}
                <li className="col-span-2 flex items-center gap-2 text-fg-subtle">
                  <StationDot status="online" simulated size={11} /> centre dot = simulated
                </li>
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
