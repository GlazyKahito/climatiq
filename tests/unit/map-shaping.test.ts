import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import type { StyleSpecification } from 'maplibre-gl';
import {
  bboxOf,
  binIndex,
  colorFor,
  decorateRegions,
  DEPARTURE_BINS,
  departureColor,
  gridCells,
  legendFor,
  LIGHT_PALETTE,
  metricValueLabel,
  peakOf,
  severityCounts,
  TMAX_BINS,
  tmaxColor,
  valuesForDay,
} from '@/components/map/scales';
import { ENGLISH_NAME, labelBeforeId, localizeStyle } from '@/components/map/basemap-style';
import type { MapForecast } from '@/components/map/types';
import { compareRuns, inferGridStep, parentCodeFromPath, peakByRegion, toMapForecast } from '@/server/command/map-data';
import { inScopes, relevantToScopes } from '@/server/command/overview';

const P = LIGHT_PALETTE;
const f = (o: Partial<MapForecast>): MapForecast => ({
  code: 'IN-RJ',
  name: 'Rajasthan',
  level: 'state',
  parentCode: 'IN',
  day: '2024-05-27',
  h: 1,
  tmax: 45,
  lo: 43,
  hi: 47,
  normal: 40,
  dep: 5,
  sev: 'high',
  conf: 'high',
  cs: 0.8,
  dur: 2,
  res: 'state-centroid (single point)',
  imd: 'heatwave',
  ...o,
});

describe('forecast shaping', () => {
  it('derives the parent code from the materialised path', () => {
    expect(parentCodeFromPath('IN/IN-RJ/IN-RJ-JAIPUR')).toBe('IN-RJ');
    expect(parentCodeFromPath('IN/IN-RJ')).toBe('IN');
    expect(parentCodeFromPath('IN')).toBeNull();
  });

  it('compacts a forecast row with rounding and level/parent', () => {
    const m = toMapForecast({
      code: 'IN-RJ-JAIPUR',
      name: 'Jaipur',
      level: 'district',
      path: 'IN/IN-RJ/IN-RJ-JAIPUR',
      targetDate: '2024-05-27',
      horizonDay: 1,
      predictedTmaxC: 45.2666,
      lowerC: 42.61,
      upperC: 47.94,
      normalTmaxC: 38.77,
      departureC: 6.49,
      severity: 'extreme',
      confidence: 'high',
      confidenceScore: 0.7412,
      durationDays: 3,
      resolution: 'district-centroid (point)',
      imdCategory: 'severe_heatwave',
    });
    expect(m).toMatchObject({ level: 'district', parentCode: 'IN-RJ', tmax: 45.3, lo: 42.6, hi: 47.9, normal: 38.8, dep: 6.5, cs: 0.74 });
  });

  it('counts severities per day and finds per-region peaks within a horizon', () => {
    const rows = [
      f({ code: 'A', day: 'd1', h: 1, sev: 'low', tmax: 38 }),
      f({ code: 'A', day: 'd2', h: 2, sev: 'extreme', tmax: 46 }),
      f({ code: 'A', day: 'd6', h: 6, sev: 'extreme', tmax: 49 }),
      f({ code: 'B', day: 'd1', h: 1, sev: 'high', tmax: 44 }),
      f({ code: 'B', day: 'd2', h: 2, sev: 'high', tmax: 45 }),
    ];
    expect(severityCounts(rows, 'd1')).toEqual({ low: 1, moderate: 0, high: 1, extreme: 0 });
    const peaks = peakByRegion(rows, 5);
    expect(peaks.get('A')).toEqual({ sev: 'extreme', tmax: 46, day: 'd2' }); // day 6 is beyond the horizon
    expect(peaks.get('B')).toEqual({ sev: 'high', tmax: 45, day: 'd2' });
    expect(peakOf(rows.filter((r) => r.code === 'A'))?.day).toBe('d6');
    expect(valuesForDay(rows, 'd2').get('B')?.tmax).toBe(45);
  });

  it('compares two runs on overlapping region-days', () => {
    const prev = [f({ code: 'A', day: 'd1', sev: 'moderate', tmax: 42 }), f({ code: 'B', day: 'd1', sev: 'high', tmax: 45 }), f({ code: 'C', day: 'd0', tmax: 40 })];
    const cur = [f({ code: 'A', day: 'd1', sev: 'high', tmax: 44.5 }), f({ code: 'B', day: 'd1', sev: 'moderate', tmax: 44 }), f({ code: 'D', day: 'd1' })];
    const c = compareRuns(prev, cur);
    expect(c).toMatchObject({ compared: 2, upgraded: 1, downgraded: 1, meanAbsTmaxChange: 1.8 });
    expect(c.largest).toMatchObject({ code: 'A', from: 42, to: 44.5 });
    expect(compareRuns([], cur)).toMatchObject({ compared: 0, largest: null });
  });

  it('infers the heat-grid spacing', () => {
    expect(inferGridStep([{ lat: 20.5, lon: 70.5 }, { lat: 20.5, lon: 71.5 }, { lat: 21.5, lon: 73.5 }])).toBe(1);
    expect(inferGridStep([{ lat: 20, lon: 70 }, { lat: 20, lon: 70.25 }])).toBe(0.25);
    expect(inferGridStep([{ lat: 20, lon: 70 }])).toBe(1);
  });
});

describe('colour scales & legends', () => {
  it('bins Tmax and departures with labelled classes', () => {
    expect(binIndex(TMAX_BINS, 29.9)).toBe(0);
    expect(binIndex(TMAX_BINS, 40)).toBe(3);
    expect(binIndex(TMAX_BINS, 47.2)).toBe(6);
    expect(tmaxColor(46, P)).toBe(P.heat[5]);
    expect(binIndex(DEPARTURE_BINS, 6.5)).toBe(4);
    expect(departureColor(-3, P)).toBe(P.cool[0]);
    expect(departureColor(0, P)).toBe(P.neutral);
  });

  it('colours by metric and falls back to the no-data colour', () => {
    expect(colorFor('severity', f({ sev: 'extreme' }), P)).toBe(P.sev.extreme);
    expect(colorFor('tmax', f({ tmax: 41 }), P)).toBe(P.heat[3]);
    expect(colorFor('departure', f({ dep: null }), P)).toBe(P.noData);
    expect(colorFor('severity', undefined, P)).toBe(P.noData);
    expect(metricValueLabel('severity', f({ sev: 'high' }))).toBe('High');
    expect(metricValueLabel('departure', f({ dep: 4.2 }))).toBe('+4.2 °C');
    expect(metricValueLabel('tmax', undefined)).toBe('No forecast');
  });

  it('every legend entry has a text label (never colour alone) and includes no-data', () => {
    for (const m of ['severity', 'tmax', 'departure'] as const) {
      const items = legendFor(m, P);
      expect(items.every((i) => i.label.length > 2)).toBe(true);
      expect(items.at(-1)?.label).toBe('No forecast available');
    }
    expect(legendFor('severity', P).map((i) => i.label)).toEqual(['Extreme', 'High', 'Moderate', 'Low', 'No forecast available']);
  });
});

describe('GeoJSON helpers', () => {
  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { code: 'IN-RJ', name: 'Rajasthan' }, geometry: { type: 'Polygon', coordinates: [[[70, 24], [78, 24], [78, 30], [70, 30], [70, 24]]] } },
      { type: 'Feature', properties: { code: 'IN-KL', name: 'Kerala' }, geometry: { type: 'MultiPolygon', coordinates: [[[[74, 8], [77, 8], [77, 12], [74, 8]]]] } },
    ],
  };

  it('decorates boundary features with forecast colour, label and pilot flag', () => {
    const out = decorateRegions(fc, new Map([['IN-RJ', f({ sev: 'extreme' })]]), 'severity', P, new Set(['IN-RJ']));
    expect(out.features[0].properties).toMatchObject({ code: 'IN-RJ', color: P.sev.extreme, hasData: true, label: 'Extreme', isPilot: true });
    expect(out.features[1].properties).toMatchObject({ code: 'IN-KL', color: P.noData, hasData: false, label: 'No forecast', isPilot: false });
  });

  it('computes bounding boxes for polygons and multipolygons', () => {
    expect(bboxOf(fc.features[0].geometry)).toEqual([[70, 24], [78, 30]]);
    expect(bboxOf(fc.features[1].geometry)).toEqual([[74, 8], [77, 12]]);
    expect(bboxOf(null)).toBeNull();
  });

  it('builds square heat-grid cells centred on the grid points', () => {
    const cells = gridCells([[26.5, 75.5, 46.1]], 1, P);
    expect(cells.features[0].geometry.coordinates[0][0]).toEqual([75, 26]);
    expect(cells.features[0].geometry.coordinates[0][2]).toEqual([76, 27]);
    expect(cells.features[0].properties).toEqual({ tmax: 46.1, color: P.heat[5] });
  });
});

describe('basemap localisation', () => {
  const style = {
    version: 8,
    sources: {},
    layers: [
      { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water' },
      { id: 'boundary_2', type: 'line', source: 'ofm', 'source-layer': 'boundary' },
      { id: 'road', type: 'line', source: 'ofm', 'source-layer': 'transportation' },
      { id: 'water_name', type: 'symbol', source: 'ofm', 'source-layer': 'water_name', layout: { 'text-field': ['get', 'name:nonlatin'] } },
      { id: 'shield', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', layout: { 'text-field': ['to-string', ['get', 'ref']] } },
      { id: 'label_state', type: 'symbol', source: 'ofm', 'source-layer': 'place', filter: ['==', ['get', 'class'], 'state'], layout: { 'text-field': ['get', 'name'] } },
      { id: 'label_country_1', type: 'symbol', source: 'ofm', 'source-layer': 'place', filter: ['==', ['get', 'class'], 'country'], layout: { 'text-field': ['get', 'name'] } },
    ],
  } as unknown as StyleSpecification;

  it('uses English names, drops OSM boundaries and state labels, limits country labels to India', () => {
    const out = localizeStyle(style);
    const ids = out.layers.map((l) => l.id);
    expect(ids).not.toContain('boundary_2');
    expect(ids).not.toContain('label_state');
    const byId = Object.fromEntries(out.layers.map((l) => [l.id, l as { layout?: Record<string, unknown>; filter?: unknown }]));
    expect(byId.water_name.layout?.['text-field']).toEqual(ENGLISH_NAME);
    expect(byId.shield.layout?.['text-field']).toEqual(['to-string', ['get', 'ref']]); // route numbers untouched
    expect(JSON.stringify(byId.label_country_1.filter)).toContain('"IN"');
    expect(labelBeforeId(out)).toBe('water_name');
  });
});

describe('region scoping', () => {
  it('matches descendants for operational data and ancestors for advisories', () => {
    const jaipurScope = ['IN/IN-RJ/IN-RJ-JAIPUR'];
    expect(inScopes('IN/IN-RJ/IN-RJ-JAIPUR', jaipurScope)).toBe(true);
    expect(inScopes('IN/IN-RJ/IN-RJ-JODHPUR', jaipurScope)).toBe(false);
    expect(inScopes('IN/IN-RJ', jaipurScope)).toBe(false);
    expect(relevantToScopes('IN/IN-RJ', jaipurScope)).toBe(true); // a Rajasthan-wide advisory applies to Jaipur
    expect(relevantToScopes('IN/IN-UP', jaipurScope)).toBe(false);
    expect(inScopes('IN/IN-UP/IN-UP-AGRA', [null])).toBe(true);
  });
});
