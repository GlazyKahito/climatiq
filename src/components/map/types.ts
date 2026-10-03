/** Client-safe types shared by the command-center map, its API routes and src/server/command. */
import type { Confidence, DataKind, Severity } from '@/lib/domain';

export type MapMetric = 'severity' | 'tmax' | 'departure';
export type RegionLevel = 'state' | 'district';

/** One CLIMATIQ forecast value for a region and target day (compact for transfer). */
export type MapForecast = {
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
  day: string;
  h: number; // horizon day
  tmax: number;
  lo: number;
  hi: number;
  normal: number | null;
  dep: number | null;
  sev: Severity;
  conf: Confidence;
  cs: number; // heuristic confidence score 0..1 (NOT a probability)
  dur: number; // consecutive days ≥ High
  res: string; // resolution label, e.g. 'state-centroid (single point)'
  imd: string; // 'none' | 'heatwave' | 'severe_heatwave' (criteria-based, not official)
};

export type RunSummary = {
  id: string;
  scenario: 'live' | 'replay';
  issuedFor: string;
  horizonDays: number;
  isHindcast: boolean;
  createdAt: string;
  modelKey: string;
  modelName: string;
  nwpInput: string | null;
  normalsInput: string | null;
};

export type StateMeta = { code: string; name: string; isPilot: boolean; zone: 'plains' | 'coastal' | 'hilly' };

export type MapStation = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: 'online' | 'degraded' | 'offline' | 'planned';
  stationType: 'aws_simulated' | 'iot' | 'external';
  isSimulated: boolean;
  lastSeenAt: string | null;
  latestTempC: number | null;
  latestAt: string | null;
  regionName: string;
  stateCode: string;
};

export type GridPayload = {
  day: string;
  /** Provenance of the values (reanalysis / nwp_forecast / simulated) — null when there is no grid for the day. */
  kind: DataKind | null;
  sources: string[];
  step: number;
  points: [lat: number, lon: number, tmaxC: number][];
};

export type CityItem = { code: string; name: string; population: number | null };

export type RegionDetailPayload = {
  region: {
    code: string;
    name: string;
    level: 'country' | 'state' | 'district' | 'city';
    isPilot: boolean;
    climateZone: 'plains' | 'coastal' | 'hilly';
    parentCode: string | null;
    parentName: string | null;
  };
  /** Forecast series used for this region (cities resolve to their district). */
  series: MapForecast[];
  seriesRegionCode: string | null;
  cities: CityItem[];
};
