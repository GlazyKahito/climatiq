'use client';

/** Station network map (list page) and single-station location map (detail page). */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Marker, Popup, Source, type MapRef } from 'react-map-gl/maplibre';
import { fmtRelative, fmtTemp } from '@/lib/domain';
import { BaseMap } from './base-map';
import { STATES_TOPO_URL, useBoundaries, useIsDark, usePalette } from './geo';
import { INDIA_BOUNDS, type BBox } from './scales';
import { StationDot } from './station-dot';
import type { MapStation } from './types';

export default function StationsMap({ stations, single = false, ariaLabel }: { stations: MapStation[]; single?: boolean; ariaLabel?: string }) {
  const dark = useIsDark();
  const palette = usePalette(dark);
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup] = useState<MapStation | null>(null);
  const states = useBoundaries(STATES_TOPO_URL, 'states');

  const bounds = useMemo<BBox>(() => {
    if (!stations.length) return INDIA_BOUNDS;
    if (single) {
      const s = stations[0];
      return [
        [s.lon - 2.5, s.lat - 1.8],
        [s.lon + 2.5, s.lat + 1.8],
      ];
    }
    const lons = stations.map((s) => s.lon);
    const lats = stations.map((s) => s.lat);
    return [
      [Math.min(...lons) - 1.5, Math.min(...lats) - 1.5],
      [Math.max(...lons) + 1.5, Math.max(...lats) + 1.5],
    ];
  }, [stations, single]);

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) mapRef.current?.fitBounds(bounds, { padding: 30, duration: 0, maxZoom: single ? 8 : 7 });
  }, [bounds, loaded, single]);

  return (
    <BaseMap
      ref={mapRef}
      dark={dark}
      bounds={bounds}
      onLoad={() => setLoaded(true)}
      scrollZoom={!single}
      ariaLabel={ariaLabel ?? (single ? 'Station location map' : 'Map of weather stations. The station table lists the same stations.')}
    >
      {states.data && (
        <Source id="st-states" type="geojson" data={states.data}>
          <Layer id="st-state-line" type="line" paint={{ 'line-color': palette.line, 'line-width': 0.9 }} />
        </Source>
      )}
      {stations.map((s) => (
        <Marker key={s.code} longitude={s.lon} latitude={s.lat} anchor="center">
          <button
            type="button"
            className="grid size-6 place-items-center rounded-full"
            aria-label={`${s.name}${s.isSimulated ? ' — simulated station' : ''}, ${s.status}`}
            onClick={(e) => {
              e.stopPropagation();
              setPopup(s);
            }}
          >
            <StationDot status={s.status} simulated={s.isSimulated} size={single ? 18 : 14} />
          </button>
        </Marker>
      ))}
      {popup && (
        <Popup longitude={popup.lon} latitude={popup.lat} anchor="bottom" offset={14} onClose={() => setPopup(null)} closeOnClick={false} maxWidth="240px">
          <div className="flex flex-col gap-1 text-xs text-[#22070e]">
            <p className="font-semibold">{popup.name}</p>
            {popup.isSimulated && (
              <p className="w-fit rounded border border-dashed border-[#8a5a00] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a5a00]">Simulated — not a real station</p>
            )}
            <p>
              <span className="font-medium capitalize">{popup.status}</span>
              {popup.lastSeenAt ? ` · last report ${fmtRelative(popup.lastSeenAt)}` : ' · never reported'}
            </p>
            {popup.latestTempC != null && <p className="tabular">Latest {fmtTemp(popup.latestTempC)}</p>}
            {!single && (
              <Link href={`/stations/${popup.code}`} className="mt-1 font-semibold text-[#7f011f] underline underline-offset-2">
                Station details →
              </Link>
            )}
          </div>
        </Popup>
      )}
    </BaseMap>
  );
}
