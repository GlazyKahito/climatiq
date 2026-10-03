'use client';

import { useEffect, useState } from 'react';
import { GLOBAL_HEAT_URL } from './global-heat';
import { HEAT_GRID_URL, heatGridStats, parseHeatGrid, type HeatGrid, type HeatGridStats } from './heat-grid';

export type HeatGridState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; grid: HeatGrid; stats: HeatGridStats };

let request: Promise<HeatGridState> | null = null;

/** Shared, memoised fetch of the replay grid (the hero globe and the intro readout use the same request). */
export function loadHeatGrid(): Promise<HeatGridState> {
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
    loadHeatGrid().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

let globalRequest: Promise<HeatGrid | null> | null = null;

/** Shared fetch of the global context grid (ERA5 Tmax over land, same day); null when absent or malformed. */
export function loadGlobalHeat(): Promise<HeatGrid | null> {
  globalRequest ??= fetch(GLOBAL_HEAT_URL, { cache: 'force-cache' })
    .then(async (r) => (r.ok ? parseHeatGrid(await r.json()) : null))
    .catch(() => null);
  return globalRequest;
}

/** The global context grid once loaded (null while loading or when unavailable — the globe then shows plain land). */
export function useGlobalHeat(): HeatGrid | null {
  const [grid, setGrid] = useState<HeatGrid | null>(null);
  useEffect(() => {
    let alive = true;
    loadGlobalHeat().then((g) => alive && setGrid(g));
    return () => {
      alive = false;
    };
  }, []);
  return grid;
}
