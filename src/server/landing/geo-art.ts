import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  geoGraticule,
  geoMercator,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
  type GeoStream,
  type GeoStreamWrapper,
} from 'd3-geo';
import { feature, merge } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import { INDIA_FOCUS, heatColor, rgbToHex } from '@/components/globe/globe-math';
import { heatGridCaption, type HeatGridStats } from '@/components/globe/heat-grid';
import { readReplayHeatGrid } from './heat-grid';

/**
 * Server-side vector art for the landing page (rendered as inline SVG, so it costs no client JS):
 *  - a static orthographic globe matching the WebGL globe's resting view (poster + no-WebGL fallback)
 *  - an India outline (Mercator) for feature previews, with the real ERA5 replay grid when available
 */

/**
 * Heat values drawn as compact SVG: points are binned by temperature (1.5 °C bins, coloured at the bin centre) and
 * each bin is ONE path of zero-length segments ("M x y h0") stroked with round/square caps — ~14 bytes per point
 * instead of a full <circle>/<rect> element each.
 */
export type HeatPath = { color: string; d: string; fromC: number; toC: number };

export type GlobeArt = {
  size: number;
  graticule: string;
  land: string;
  india: string;
  heat: HeatPath[];
};

export type IndiaArt = {
  width: number;
  height: number;
  outline: string;
  /** projected ERA5 cells, binned by temperature */
  heat: HeatPath[];
  /** width in px of a 1° cell (Mercator x-scale is latitude-independent) */
  cell: number;
};

export type LandingArt = {
  globe: GlobeArt;
  india: IndiaArt;
  heat: { caption: string; stats: HeatGridStats; day: string; note: string | null } | null;
};

/** Drops projected vertices closer than `eps` px to the previous kept vertex (keeps ring ends). */
function simplified(projection: GeoProjection, eps: number): GeoStreamWrapper {
  return {
    stream(out: GeoStream) {
      let lx = 0;
      let ly = 0;
      let has = false;
      let pending: [number, number] | null = null;
      const s: GeoStream = {
        point(x: number, y: number) {
          if (!has || Math.hypot(x - lx, y - ly) >= eps) {
            out.point(x, y);
            lx = x;
            ly = y;
            has = true;
            pending = null;
          } else pending = [x, y];
        },
        lineStart() {
          has = false;
          pending = null;
          out.lineStart();
        },
        lineEnd() {
          if (pending) out.point(pending[0], pending[1]);
          out.lineEnd();
        },
        polygonStart() {
          out.polygonStart();
        },
        polygonEnd() {
          out.polygonEnd();
        },
        sphere() {
          out.sphere?.();
        },
      };
      return projection.stream(s);
    },
  };
}

let indiaGeom: Promise<GeoJSON.MultiPolygon | null> | null = null;
function loadIndia() {
  if (!indiaGeom) {
    indiaGeom = readFile(path.join(process.cwd(), 'public', 'geo', 'india-states.topo.json'), 'utf8')
      .then((txt) => {
        const topo = JSON.parse(txt) as Topology<{ states: GeometryCollection }>;
        return merge(topo, topo.objects.states.geometries as Parameters<typeof merge>[1]);
      })
      .catch(() => {
        indiaGeom = null;
        return null;
      });
  }
  return indiaGeom;
}

const BIN_C = 1.5;

function binPoints(pts: { x: number; y: number; t: number }[]): HeatPath[] {
  const bins = new Map<number, string[]>();
  for (const p of pts) {
    const b = Math.floor(p.t / BIN_C);
    const arr = bins.get(b) ?? [];
    arr.push(`M${p.x.toFixed(1)} ${p.y.toFixed(1)}h0`);
    bins.set(b, arr);
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, segs]) => ({
      color: rgbToHex(heatColor((b + 0.5) * BIN_C)),
      d: segs.join(''),
      fromC: b * BIN_C,
      toC: (b + 1) * BIN_C,
    }));
}

let cache: { key: string; art: LandingArt } | null = null;

export async function getLandingArt(): Promise<LandingArt> {
  const [india, heat] = await Promise.all([loadIndia(), readReplayHeatGrid()]);
  const key = `${india ? 1 : 0}:${heat ? `${heat.grid.meta.day}:${heat.stats.count}:${heat.stats.maxC}` : 'none'}`;
  if (cache && cache.key === key) return cache.art;

  // ── Orthographic globe (same resting view as the WebGL globe) ──
  const size = 600;
  const ortho = geoOrthographic()
    .scale(size / 2 - 2)
    .translate([size / 2, size / 2])
    .rotate([-INDIA_FOCUS.lon, -INDIA_FOCUS.lat])
    .clipAngle(90)
    .precision(0.5);
  const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>;
  const land = feature(topo, topo.objects.land) as GeoPermissibleObjects;
  const globe: GlobeArt = {
    size,
    graticule: geoPath(ortho).digits(0)(geoGraticule().step([20, 20])()) ?? '',
    land: geoPath(simplified(ortho, 2.5)).digits(0)(land) ?? '',
    india: india ? (geoPath(simplified(ortho, 1.2)).digits(1)(india) ?? '') : '',
    heat: [],
  };

  // ── India outline for previews ──
  const W = 260;
  const H = 290;
  const merc = geoMercator();
  if (india) merc.fitExtent([[6, 6], [W - 6, H - 6]], india);
  const indiaArt: IndiaArt = {
    width: W,
    height: H,
    outline: india ? (geoPath(simplified(merc, 1.1)).digits(1)(india) ?? '') : '',
    heat: [],
    cell: 0,
  };

  let heatSummary: LandingArt['heat'] = null;
  if (heat) {
    const gPts: { x: number; y: number; t: number }[] = [];
    const iPts: { x: number; y: number; t: number }[] = [];
    for (const p of heat.grid.points) {
      const o = ortho([p.lon, p.lat]);
      if (o) gPts.push({ x: o[0], y: o[1], t: p.tmaxC });
      if (india) {
        const c = merc([p.lon, p.lat]);
        if (c) iPts.push({ x: c[0], y: c[1], t: p.tmaxC });
      }
    }
    globe.heat = binPoints(gPts);
    indiaArt.heat = binPoints(iPts);
    if (india) {
      const a = merc([78, 20]);
      const b = merc([79, 20]);
      indiaArt.cell = a && b ? +Math.abs(b[0] - a[0]).toFixed(2) : 0;
    }
    heatSummary = { caption: heatGridCaption(heat.grid.meta), stats: heat.stats, day: heat.grid.meta.day, note: heat.grid.meta.note };
  }

  const art: LandingArt = { globe, india: indiaArt, heat: heatSummary };
  cache = { key, art };
  return art;
}
