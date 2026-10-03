import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Link from 'next/link';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { SEVERITY_META, type Severity } from '@/lib/domain';

type Props = { name: string; code: string };
let cached: FeatureCollection<Geometry, Props> | null = null;

function states(): FeatureCollection<Geometry, Props> {
  if (cached) return cached;
  const topo = JSON.parse(readFileSync(join(process.cwd(), 'public/geo/india-states.topo.json'), 'utf8')) as Topology<{ states: GeometryCollection<Props> }>;
  cached = feature(topo, topo.objects.states) as FeatureCollection<Geometry, Props>;
  return cached;
}

/**
 * Server-rendered, lightweight SVG choropleth of India's states (no WebGL, no client JS) — used by the public portal.
 * Severity is encoded with colour AND a text list beside the map; each state is a keyboard-focusable link.
 */
export function IndiaSvgMap({
  values,
  hrefFor,
  width = 560,
  height = 620,
  caption,
}: {
  values: Record<string, { severity: Severity; tmax: number }>;
  hrefFor: (code: string) => string;
  width?: number;
  height?: number;
  caption: string;
}) {
  const fc = states();
  const projection = geoMercator().fitSize([width, height], fc);
  const path = geoPath(projection).digits(1);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="group" aria-label={caption}>
        <title>{caption}</title>
        {fc.features.map((f) => {
          const v = values[f.properties.code];
          const fill = v ? `var(--sev-${v.severity})` : 'var(--border-strong)';
          const label = v ? `${f.properties.name}: ${SEVERITY_META[v.severity].label} heat risk, forecast maximum ${v.tmax.toFixed(1)} °C` : `${f.properties.name}: no forecast`;
          return (
            <Link key={f.properties.code} href={hrefFor(f.properties.code)} aria-label={label}>
              <path
                d={path(f) ?? undefined}
                fill={fill}
                fillOpacity={v ? (v.severity === 'low' ? 0.35 : 0.85) : 0.25}
                stroke="var(--bg)"
                strokeWidth={0.8}
                className="transition-[fill-opacity] hover:fill-opacity-100 focus:outline-none"
              >
                <title>{label}</title>
              </path>
            </Link>
          );
        })}
      </svg>
      <figcaption className="mt-2 text-xs text-fg-muted">{caption}</figcaption>
    </figure>
  );
}
