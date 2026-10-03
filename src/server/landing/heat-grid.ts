import 'server-only';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { heatGridStats, parseHeatGrid, type HeatGrid, type HeatGridStats } from '@/components/globe/heat-grid';

const FILE = path.join(process.cwd(), 'public', 'data', 'heat-grid-replay.json');

let cache: { mtimeMs: number; value: { grid: HeatGrid; stats: HeatGridStats } | null } | null = null;

/**
 * Reads the replay heat grid (real ERA5 Tmax, written by the data pipeline) for server-rendered previews.
 * Re-reads when the file changes; returns null when the file is absent or invalid — callers must then show
 * no heat values at all.
 */
export async function readReplayHeatGrid(): Promise<{ grid: HeatGrid; stats: HeatGridStats } | null> {
  try {
    const s = await stat(FILE);
    if (cache && cache.mtimeMs === s.mtimeMs) return cache.value;
    const grid = parseHeatGrid(JSON.parse(await readFile(FILE, 'utf8')));
    const stats = grid ? heatGridStats(grid.points) : null;
    const value = grid && stats ? { grid, stats } : null;
    cache = { mtimeMs: s.mtimeMs, value };
    return value;
  } catch {
    return null;
  }
}
