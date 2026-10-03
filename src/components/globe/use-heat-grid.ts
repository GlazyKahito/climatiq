'use client';

import { useEffect, useState } from 'react';
import { HEAT_GRID_URL, heatGridStats, parseHeatGrid, type HeatGrid, type HeatGridStats } from './heat-grid';

export type HeatGridState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; grid: HeatGrid; stats: HeatGridStats };

let request: Promise<HeatGridState> | null = null;

function load(): Promise<HeatGridState> {
  if (!request) {
    request = fetch(HEAT_GRID_URL, { cache: 'no-cache' })
      .then(async (r) => {
        if (!r.ok) return { status: 'missing' } as const;
        const grid = parseHeatGrid(await r.json());
        const stats = grid ? heatGridStats(grid.points) : null;
        return grid && stats ? ({ status: 'ready', grid, stats } as const) : ({ status: 'missing' } as const);
      })
      .catch(() => ({ status: 'missing' }) as const);
    // A missing file is retried on the next mount (the replay grid may be generated while the app runs).
    request.then((s) => {
      if (s.status === 'missing') request = null;
    });
  }
  return request;
}

/** Real ERA5 replay grid from /data/heat-grid-replay.json — `missing` when absent (no values are invented). */
export function useHeatGrid(): HeatGridState {
  const [state, setState] = useState<HeatGridState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    load().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
