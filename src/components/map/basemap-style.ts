/**
 * Post-processing of the OpenFreeMap (OpenMapTiles schema) basemap style — pure, unit-tested.
 *
 *  - Labels in English: every name-based label uses name:en → name_en → name:latin → name (no local scripts).
 *  - No basemap boundaries: OSM administrative/disputed boundary lines are removed so the CLIMATIQ geoBoundaries
 *    polygons (India's official depiction) are the only boundaries drawn.
 *  - No foreign country / province labels: country labels are limited to India; state/province labels are removed
 *    (our state polygons carry the names in tooltips, the table view and the side panel).
 * Attribution is unaffected (it comes from the style sources and our AttributionControl).
 */
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

export const ENGLISH_NAME = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
const INDIA_ONLY = ['any', ['==', ['get', 'iso_a2'], 'IN'], ['==', ['get', 'name:en'], 'India'], ['==', ['get', 'name'], 'India']];

const isNameField = (field: unknown) => {
  const s = JSON.stringify(field ?? '');
  return /name/.test(s) && !/"ref"/.test(s);
};
const filterMentions = (layer: LayerSpecification, cls: string) => JSON.stringify((layer as { filter?: unknown }).filter ?? '').includes(`"${cls}"`);

export function localizeStyle(style: StyleSpecification): StyleSpecification {
  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    const sourceLayer = (layer as { 'source-layer'?: string })['source-layer'];
    if (sourceLayer === 'boundary') continue; // OSM de-facto / disputed borders
    if (layer.type !== 'symbol') {
      layers.push(layer);
      continue;
    }
    if (sourceLayer === 'place' && (filterMentions(layer, 'state') || /(^|_)state/.test(layer.id)) && !filterMentions(layer, 'city')) continue;
    const next = { ...layer, layout: { ...(layer.layout ?? {}) } } as LayerSpecification & { layout: Record<string, unknown>; filter?: unknown };
    if (isNameField(next.layout['text-field'])) next.layout['text-field'] = ENGLISH_NAME;
    if (sourceLayer === 'place' && /country/.test(layer.id)) {
      next.filter = next.filter ? ['all', next.filter, INDIA_ONLY] : INDIA_ONLY;
    }
    layers.push(next as LayerSpecification);
  }
  return { ...style, layers };
}

/**
 * Labels are kept to the subcontinent: a tilted 3D camera sees far past India's borders (to Moscow and Baghdad), and
 * those names would crowd the horizon.
 */
const SUBCONTINENT: ExpressionSpecification = [
  'within',
  {
    type: 'Polygon',
    coordinates: [
      [
        [60, 3],
        [98, 3],
        [98, 39],
        [60, 39],
        [60, 3],
      ],
    ],
  },
] as unknown as ExpressionSpecification;
const inSubcontinent = (filter: unknown) => (filter ? ['all', filter, SUBCONTINENT] : SUBCONTINENT);

const DROP_SOURCE_LAYERS = new Set(['building', 'aeroway', 'transportation_name', 'poi', 'housenumber', 'aerodrome_label', 'mountain_peak', 'park']);
const DROP_PLACE = /country|continent|state|province|suburb|village|hamlet|neighbourhood|quarter|isolated|island|other/;

/**
 * Quiet, on-brand dark basemap for the heat layers: wine-black land and water, faint rivers, motorways only from
 * zoom 6, no buildings / airports / rail / parks / road names / country labels, and soft sentence-case city labels
 * (towns from zoom 6.5). Applied after localizeStyle. Pure — unit-tested.
 */
export function quietBasemap(style: StyleSpecification): StyleSpecification {
  const halo = { 'text-halo-color': 'rgba(18,6,10,0.88)', 'text-halo-width': 1.3, 'text-halo-blur': 0.6 };
  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    const sl = (layer as { 'source-layer'?: string })['source-layer'] ?? '';
    const l = layer as LayerSpecification & { paint?: Record<string, unknown>; layout?: Record<string, unknown>; minzoom?: number };
    if (DROP_SOURCE_LAYERS.has(sl)) continue;
    if (l.type === 'background') {
      layers.push({ ...l, paint: { ...l.paint, 'background-color': '#1c080d' } } as LayerSpecification);
    } else if (sl === 'water' && l.type === 'fill') {
      layers.push({ ...l, paint: { ...l.paint, 'fill-color': '#0d0306', 'fill-opacity': 1 } } as LayerSpecification);
    } else if (sl === 'waterway') {
      layers.push({ ...l, paint: { ...l.paint, 'line-color': '#0f0407', 'line-opacity': 0.9 } } as LayerSpecification);
    } else if (sl === 'landcover') {
      if (/ice|glacier/.test(l.id)) layers.push({ ...l, paint: { ...l.paint, 'fill-color': 'rgba(238,224,199,0.05)' } } as LayerSpecification);
    } else if (sl === 'landuse') {
      continue; // residential / park blobs are noise under a choropleth
    } else if (sl === 'transportation') {
      if (l.type !== 'line' || !/motorway/.test(l.id) || /casing/.test(l.id)) continue;
      layers.push({ ...l, minzoom: Math.max(l.minzoom ?? 0, 6), paint: { ...l.paint, 'line-color': 'rgba(238,224,199,0.09)' } } as LayerSpecification);
    } else if (sl === 'water_name' && l.type === 'symbol') {
      layers.push({
        ...l,
        filter: inSubcontinent((l as { filter?: unknown }).filter),
        paint: { ...l.paint, 'text-color': 'rgba(205,185,164,0.5)', 'text-halo-width': 0 },
      } as LayerSpecification);
    } else if (sl === 'place' && l.type === 'symbol') {
      if (DROP_PLACE.test(l.id) || DROP_PLACE.test(JSON.stringify((l as { filter?: unknown }).filter ?? ''))) continue;
      const large = /large/.test(l.id);
      const town = /town/.test(l.id);
      layers.push({
        ...l,
        minzoom: town ? Math.max(l.minzoom ?? 0, 6.5) : l.minzoom,
        filter: inSubcontinent((l as { filter?: unknown }).filter),
        layout: { ...l.layout, 'text-transform': 'none', 'text-letter-spacing': 0.02 },
        paint: { ...l.paint, ...halo, 'text-color': large ? '#ecdcc0' : town ? '#b7a28c' : '#d6c4a8' },
      } as LayerSpecification);
    } else {
      layers.push(l);
    }
  }
  return { ...style, layers };
}

/** Id of the first layer of the trailing block of label layers (data layers go just below it). */
export function labelBeforeId(style: StyleSpecification): string | undefined {
  let i = style.layers.length;
  while (i > 0 && style.layers[i - 1].type === 'symbol') i--;
  return style.layers[i]?.id;
}
