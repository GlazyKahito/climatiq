'use client';

/**
 * MapLibre GL v6 base map (react-map-gl/maplibre).
 *  - Worker: MapLibre v6 is ESM-only and, under Turbopack, needs its worker + shared chunk served from /public
 *    (public/maplibre/*.mjs, copied from node_modules/maplibre-gl/dist — keep in sync when upgrading) and `workerUrl`.
 *  - Basemap: OpenFreeMap positron / dark following the app theme, plain background fallback if the style fails.
 *  - Attribution: basemap + boundaries + Open-Meteo, plus the "not an official warning" note.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { createContext, forwardRef, useContext, useRef, useState, type ReactNode } from 'react';
import Map, { AttributionControl, NavigationControl, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { LightSpecification, SkySpecification } from 'maplibre-gl';
import { CloudOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBasemapStyle } from './geo';
import { INDIA_BOUNDS, type BBox } from './scales';

export const MAPLIBRE_WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';

export const DATA_ATTRIBUTION =
  'Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> · Boundaries <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a> (approximate) · Not an official IMD warning';

/** id of the first basemap label layer — our fills go underneath it so place names stay readable. */
const BeforeIdContext = createContext<string | undefined>(undefined);
export const useLabelBeforeId = () => useContext(BeforeIdContext);

export type BaseMapProps = {
  dark: boolean;
  ariaLabel: string;
  children?: ReactNode;
  bounds?: BBox;
  center?: { lat: number; lon: number; zoom: number };
  interactiveLayerIds?: string[];
  cursor?: string;
  onClick?: (e: MapLayerMouseEvent) => void;
  onMouseMove?: (e: MapLayerMouseEvent) => void;
  onMouseLeave?: (e: MapLayerMouseEvent) => void;
  onLoad?: () => void;
  className?: string;
  compactAttribution?: boolean;
  showNavigation?: boolean;
  scrollZoom?: boolean;
  overlay?: ReactNode;
  /** initial camera tilt / rotation in degrees (3D views); the user can tilt and rotate with right-drag or Ctrl+drag */
  pitch?: number;
  bearing?: number;
};

/** Sky behind a tilted map: the wine-black page instead of MapLibre's default blue. */
const SKY: SkySpecification = {
  'sky-color': '#12060a',
  'horizon-color': '#2a0c13',
  'fog-color': '#1c080d',
  'sky-horizon-blend': 0.7,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.75,
  'atmosphere-blend': 0,
};
/** Light for 3D extrusions: a warm key from the north-west so block faces read as distinct planes. */
const LIGHT: LightSpecification = { anchor: 'viewport', color: '#fff4e4', intensity: 0.42, position: [1.3, 300, 35] };

export const BaseMap = forwardRef<MapRef, BaseMapProps>(function BaseMap(
  {
    dark,
    ariaLabel,
    children,
    bounds = INDIA_BOUNDS,
    center,
    interactiveLayerIds,
    cursor,
    onClick,
    onMouseMove,
    onMouseLeave,
    onLoad,
    className,
    compactAttribution = true,
    showNavigation = true,
    scrollZoom = true,
    overlay,
    pitch = 0,
    bearing = 0,
  },
  ref,
) {
  const basemap = useBasemapStyle(dark);
  const [tileErrors, setTileErrors] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const attribCollapsed = useRef(false);
  // Last camera position; only read when the map is re-created for a new basemap style (initialViewState is mount-only).
  const [savedView, setSavedView] = useState<{ longitude: number; latitude: number; zoom: number; pitch: number; bearing: number } | null>(null);

  return (
    <div role="region" aria-label={ariaLabel} className={cn('relative h-full w-full overflow-hidden', className)}>
      {basemap.style ? (
        <BeforeIdContext.Provider value={basemap.beforeId}>
          {/* The map is re-created when the basemap style changes (light ↔ dark ↔ fallback): the styles use different
              label-layer ids, and re-inserting data layers under the new labels is more robust than setStyle diffing.
              The camera is preserved through savedView. */}
          <Map
            key={basemap.key}
            ref={ref}
            mapStyle={basemap.style}
            workerUrl={MAPLIBRE_WORKER_URL}
            initialViewState={
              savedView ??
              (center
                ? { latitude: center.lat, longitude: center.lon, zoom: center.zoom, pitch, bearing }
                : { bounds, fitBoundsOptions: { padding: 16 }, pitch, bearing })
            }
            onMoveEnd={(e) => {
              const v = e.viewState;
              setSavedView({ longitude: v.longitude, latitude: v.latitude, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
            }}
            minZoom={3}
            maxZoom={12}
            maxPitch={65}
            maxBounds={[45, -12, 120, 48]}
            dragRotate
            pitchWithRotate
            touchPitch
            scrollZoom={scrollZoom}
            attributionControl={false}
            interactiveLayerIds={interactiveLayerIds}
            cursor={cursor}
            onClick={onClick}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            onLoad={(e) => {
              attribCollapsed.current = false;
              const m = e.target;
              // MapLibre's default wheel zoom (1/450) feels sluggish over a country-scale map
              m.scrollZoom.setWheelZoomRate(1 / 220);
              m.scrollZoom.setZoomRate(1 / 60);
              m.setSky(SKY);
              m.setLight(LIGHT);
              onLoad?.();
            }}
            onIdle={(e) => {
              // Start with the compact attribution collapsed (the (i) button expands it). MapLibre opens it once the
              // source attributions arrive, so collapse it on the first idle event of each map instance.
              if (attribCollapsed.current) return;
              attribCollapsed.current = true;
              e.target.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
            }}
            onStyleData={(e) => {
              // Some basemap styles reference sprite icons they do not ship; resolve them as transparent pixels.
              const m = e.target;
              m.setMissingStyleImageResolver((id) => {
                if (!m.hasImage(id)) m.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
              });
            }}
            onError={(e) => {
              const msg = e.error?.message ?? '';
              // Errors can be emitted synchronously while react-map-gl renders layers → defer the state update.
              setTimeout(() => {
                // Tile/glyph fetch failures are tolerated (overlays still render); anything else is surfaced.
                if (/tile|glyph|sprite|fetch|NetworkError|Failed to fetch|AJAXError/i.test(msg)) setTileErrors((n) => n + 1);
                else setMapError(msg || 'Map error');
              }, 0);
            }}
            style={{ width: '100%', height: '100%' }}
          >
            <AttributionControl
              compact={compactAttribution}
              position="bottom-right"
              customAttribution={basemap.status === 'ok' ? DATA_ATTRIBUTION : `Basemap unavailable · ${DATA_ATTRIBUTION}`}
            />
            {showNavigation && <NavigationControl position="bottom-right" showCompass visualizePitch />}
            {children}
          </Map>
        </BeforeIdContext.Provider>
      ) : (
        <div className="grid h-full w-full place-items-center bg-accent-soft text-sm text-fg-muted" aria-busy="true">
          Loading map…
        </div>
      )}
      {(basemap.status === 'fallback' || tileErrors > 3) && (
        <p className="glass-strong pointer-events-none absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-fg-muted">
          <CloudOff className="size-3.5" aria-hidden />
          Basemap tiles unavailable — showing boundaries and data layers only
        </p>
      )}
      {mapError && (
        <p role="status" className="glass-strong absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] text-fg-muted">
          Map rendering issue: {mapError}
        </p>
      )}
      {overlay}
    </div>
  );
});
