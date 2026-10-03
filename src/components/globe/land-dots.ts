/**
 * Builds the dotted-land field for the globe (browser only).
 *
 * Land: Natural Earth 1:110m via `world-atlas` (public domain). India: geoBoundaries ADM1 states merged with
 * topojson-client `merge` (served from /geo/india-states.topo.json). Both are rasterised ONCE onto an
 * equirectangular canvas (red channel = land, green = India); every Fibonacci sample is then classified with an
 * O(1) pixel lookup, which is far cheaper than per-point polygon tests. Results are memoised per dot count.
 */
import { feature, merge } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { geoContains, geoEquirectangular, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import landTopo from 'world-atlas/land-110m.json';
import { fibonacciSphere, inIndiaBBox, latLonToVec3 } from './globe-math';

export type DotField = {
  count: number;
  /** xyz per dot on the unit sphere */
  positions: Float32Array;
  /** 1 for dots inside India, else 0 */
  india: Float32Array;
  /** per-dot 0..1 pseudo-random value (shimmer phase) */
  seeds: Float32Array;
};

export type GlobeGeometry = {
  dots: DotField;
  /** India outline as line-segment pairs (xyz, xyz) slightly above the surface; empty if geometry unavailable */
  indiaOutline: Float32Array;
};

const INDIA_URL = '/geo/india-states.topo.json';
const RASTER_W = 2048;
const RASTER_H = 1024;

type IndiaGeom = GeoJSON.MultiPolygon | GeoJSON.Polygon;

let indiaPromise: Promise<IndiaGeom | null> | null = null;
let rasterPromise: Promise<Raster | null> | null = null;
const geometryCache = new Map<string, Promise<GlobeGeometry>>();

type Raster = { data: Uint8ClampedArray; w: number; h: number };

function landFeature() {
  const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>;
  return feature(topo, topo.objects.land);
}

/** India outline = union of all state polygons. Cached; null if the file can't be fetched. */
export function loadIndiaGeometry(): Promise<IndiaGeom | null> {
  if (!indiaPromise) {
    indiaPromise = fetch(INDIA_URL, { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((topo: Topology<{ states: GeometryCollection }> | null) => {
        if (!topo?.objects?.states) return null;
        return merge(topo, topo.objects.states.geometries as Parameters<typeof merge>[1]) as IndiaGeom;
      })
      .catch(() => null);
  }
  return indiaPromise;
}

async function buildRaster(): Promise<Raster | null> {
  if (typeof document === 'undefined') return null;
  const india = await loadIndiaGeometry();
  try {
    const canvas = document.createElement('canvas');
    canvas.width = RASTER_W;
    canvas.height = RASTER_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const projection = geoEquirectangular()
      .scale(RASTER_W / (2 * Math.PI))
      .translate([RASTER_W / 2, RASTER_H / 2])
      .precision(0.3);
    const path = geoPath(projection, ctx);
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    path(landFeature() as GeoPermissibleObjects);
    ctx.fill();
    if (india) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#00ff00';
      ctx.beginPath();
      path(india);
      ctx.fill();
    }
    return { data: ctx.getImageData(0, 0, RASTER_W, RASTER_H).data, w: RASTER_W, h: RASTER_H };
  } catch {
    return null;
  }
}

function getRaster() {
  if (!rasterPromise) rasterPromise = buildRaster();
  return rasterPromise;
}

function sample(r: Raster, lat: number, lon: number): { land: boolean; india: boolean } {
  const x = Math.min(r.w - 1, Math.max(0, Math.floor(((lon + 180) / 360) * r.w)));
  const y = Math.min(r.h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * r.h)));
  const i = (y * r.w + x) * 4;
  const india = r.data[i + 1] > 127;
  return { land: india || r.data[i] > 127, india };
}

/** Slow but dependency-free fallback when a 2D canvas is unavailable. */
function makeVectorClassifier(india: IndiaGeom | null) {
  const land = landFeature();
  return (lat: number, lon: number) => {
    const inIndia = !!india && inIndiaBBox(lat, lon) && geoContains(india, [lon, lat]);
    return { india: inIndia, land: inIndia || geoContains(land as GeoPermissibleObjects, [lon, lat]) };
  };
}

function hash01(i: number) {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Simplify a lon/lat ring by dropping vertices closer than `minDeg` to the last kept one. */
function simplifyRing(ring: GeoJSON.Position[], minDeg: number): GeoJSON.Position[] {
  if (ring.length < 4) return ring;
  const out: GeoJSON.Position[] = [ring[0]];
  let last = ring[0];
  for (let i = 1; i < ring.length - 1; i++) {
    const p = ring[i];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= minDeg) {
      out.push(p);
      last = p;
    }
  }
  out.push(ring[ring.length - 1]);
  return out;
}

function outlineSegments(india: IndiaGeom | null, radius: number, minDeg: number): Float32Array {
  if (!india) return new Float32Array(0);
  const polys = india.type === 'Polygon' ? [india.coordinates] : india.coordinates;
  const segs: number[] = [];
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer || outer.length < 4) continue;
    const ring = simplifyRing(outer, minDeg);
    for (let i = 0; i < ring.length - 1; i++) {
      const a = latLonToVec3(ring[i][1], ring[i][0], radius);
      const b = latLonToVec3(ring[i + 1][1], ring[i + 1][0], radius);
      segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }
  return new Float32Array(segs);
}

/**
 * Dotted land for `n` global samples plus a denser India-only sampling (`indiaDensity`× the global density) so the
 * highlighted country reads as a solid, finely-dotted shape.
 */
export function buildGlobeGeometry(n: number, indiaDensity = 5): Promise<GlobeGeometry> {
  const key = `${n}:${indiaDensity}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const p = (async (): Promise<GlobeGeometry> => {
    const [raster, india] = await Promise.all([getRaster(), loadIndiaGeometry()]);
    const classify = raster ? (lat: number, lon: number) => sample(raster, lat, lon) : makeVectorClassifier(india);

    const pos: number[] = [];
    const ind: number[] = [];
    const seeds: number[] = [];
    const global = fibonacciSphere(n);
    for (let i = 0; i < n; i++) {
      const lat = global[i * 2];
      const lon = global[i * 2 + 1];
      const c = classify(lat, lon);
      if (!c.land || c.india) continue; // India is drawn by the dense pass below
      const v = latLonToVec3(lat, lon, 1.0015);
      pos.push(v[0], v[1], v[2]);
      ind.push(0);
      seeds.push(hash01(i));
    }
    if (india) {
      const dense = Math.round(n * indiaDensity);
      const pts = fibonacciSphere(dense);
      for (let i = 0; i < dense; i++) {
        const lat = pts[i * 2];
        const lon = pts[i * 2 + 1];
        if (!inIndiaBBox(lat, lon)) continue;
        if (!classify(lat, lon).india) continue;
        const v = latLonToVec3(lat, lon, 1.002);
        pos.push(v[0], v[1], v[2]);
        ind.push(1);
        seeds.push(hash01(i + 7));
      }
    }
    return {
      dots: { count: ind.length, positions: new Float32Array(pos), india: new Float32Array(ind), seeds: new Float32Array(seeds) },
      indiaOutline: outlineSegments(india, 1.004, 0.06),
    };
  })();
  geometryCache.set(key, p);
  p.catch(() => geometryCache.delete(key));
  return p;
}
