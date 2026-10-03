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
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

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

/** Id of the first layer of the trailing block of label layers (data layers go just below it). */
export function labelBeforeId(style: StyleSpecification): string | undefined {
  let i = style.layers.length;
  while (i > 0 && style.layers[i - 1].type === 'symbol') i--;
  return style.layers[i]?.id;
}
