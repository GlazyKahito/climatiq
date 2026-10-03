'use client';

/** Client-side loading of the static boundary TopoJSON files (cached per URL) and theme/basemap hooks. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { feature } from 'topojson-client';
import type { FeatureCollection } from 'geojson';
import type { StyleSpecification } from 'maplibre-gl';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { DARK_PALETTE, LIGHT_PALETTE, readPalette, type Palette } from './scales';
import { labelBeforeId, localizeStyle } from './basemap-style';

export const STATES_TOPO_URL = '/geo/india-states.topo.json';
export const districtsTopoUrl = (stateCode: string) => `/geo/districts/${stateCode}.topo.json`;
/** Pilot states with district boundaries shipped in public/geo/districts. */
export const DISTRICT_BOUNDARY_STATES = new Set(['IN-RJ', 'IN-UP', 'IN-MH', 'IN-OR', 'IN-TG', 'IN-HP', 'IN-DL']);

const topoCache = new Map<string, Promise<FeatureCollection>>();

export function loadBoundaries(url: string, objectName: string): Promise<FeatureCollection> {
  let p = topoCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Boundary file ${url} returned ${r.status}`);
        return r.json() as Promise<Topology>;
      })
      .then((topo) => {
        const obj = topo.objects[objectName] as GeometryCollection | undefined;
        if (!obj) throw new Error(`Boundary file ${url} has no "${objectName}" object`);
        return feature(topo, obj) as unknown as FeatureCollection;
      });
    p.catch(() => topoCache.delete(url));
    topoCache.set(url, p);
  }
  return p;
}

export function useBoundaries(url: string | null, objectName: string) {
  const [state, setState] = useState<{ url: string | null; data: FeatureCollection | null; error: string | null }>({ url: null, data: null, error: null });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    loadBoundaries(url, objectName)
      .then((data) => alive && setState({ url, data, error: null }))
      .catch((e: Error) => alive && setState({ url, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [url, objectName]);
  if (!url) return { data: null, error: null, loading: false };
  const current = state.url === url;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: !current };
}

// ───────────── Theme ─────────────
function resolvedDark() {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Tracks <html data-theme> (set by the theme toggle) and returns whether the dark theme is active. */
function subscribeTheme(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => {
    obs.disconnect();
    mq.removeEventListener('change', onChange);
  };
}

export function useIsDark() {
  return useSyncExternalStore(subscribeTheme, resolvedDark, () => false);
}

export function usePalette(dark: boolean): Palette {
  const [p, setP] = useState<Palette>(dark ? DARK_PALETTE : LIGHT_PALETTE);
  useEffect(() => {
    // read after the theme attribute has been applied
    const id = requestAnimationFrame(() => setP(readPalette(dark)));
    return () => cancelAnimationFrame(id);
  }, [dark]);
  return p;
}

// ───────────── Basemap (OpenFreeMap, no API key) with a plain-background fallback ─────────────
export const BASEMAP_URLS = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const styleCache = new Map<string, Promise<StyleSpecification | null>>();

function fetchStyle(url: string, timeoutMs = 6000): Promise<StyleSpecification | null> {
  let p = styleCache.get(url);
  if (!p) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    p = fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    p.then((s) => {
      if (!s) styleCache.delete(url); // retry on the next mount
    });
    styleCache.set(url, p);
  }
  return p;
}

export function fallbackStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    name: 'climatiq-fallback',
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#1a0a0f' : '#efe4c6' } }],
  };
}

export type BasemapState = { style: StyleSpecification | null; status: 'loading' | 'ok' | 'fallback'; beforeId: string | undefined; key: string };

export function useBasemapStyle(dark: boolean): BasemapState {
  const [state, setState] = useState<BasemapState>({ style: null, status: 'loading', beforeId: undefined, key: 'loading' });
  useEffect(() => {
    let alive = true;
    fetchStyle(dark ? BASEMAP_URLS.dark : BASEMAP_URLS.light).then((style) => {
      if (!alive) return;
      if (style && Array.isArray(style.layers)) {
        // English labels, no OSM boundaries / foreign country labels (see basemap-style.ts); data layers are inserted
        // under the trailing block of label layers, i.e. above roads/water/landuse but below place names.
        const localized = localizeStyle(style);
        setState({ style: localized, status: 'ok', beforeId: labelBeforeId(localized), key: `ok-${dark ? 'dark' : 'light'}` });
      } else {
        setState({ style: fallbackStyle(dark), status: 'fallback', beforeId: undefined, key: `fallback-${dark ? 'dark' : 'light'}` });
      }
    });
    return () => {
      alive = false;
    };
  }, [dark]);
  return state;
}
