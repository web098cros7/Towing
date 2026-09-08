import type { Presence, TruckStatus } from './presence';

export type { Presence };

/**
 * One truck as the map renders it. Merged from two sources — the REST snapshot
 * (identity, status, driver, active job) and the socket stream (position) — so
 * a truck that stops pinging keeps its identity and just ages out of freshness.
 */
export type FleetPosition = {
  truckId: string;
  plate: string;
  status: TruckStatus;
  driverName: string | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  speedKph: number | null;
  /** ISO ping timestamp; null means never seen. Feeds `presenceFor`. */
  at: string | null;
  activeBookingId: string | null;
  /**
   * Straight pickup→drop leg for the active job. Not a routed polyline: §11.4's
   * road-following route needs the Directions API (Track B, Phases 15–16), so
   * this is drawn dashed and labelled approximate rather than faked.
   */
  activeJobLeg: { pickup: LatLng; drop: LatLng | null } | null;
  fromFallback: boolean;
};

export type LatLng = { lat: number; lng: number };

export type FleetZone = {
  id: string;
  name: string;
  geometry: unknown;
};

export type PositionsSnapshot = {
  positions: FleetPosition[];
  zones: FleetZone[];
  at: string;
  /** Redis was unreachable; positions came from PostGIS (§19.2). */
  degraded: boolean;
};

/**
 * What the console is honestly doing right now (§11.6 honesty states). Rendered
 * as a chip so an operator never has to guess whether the map is live.
 */
export type RealtimeMode =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  /** Socket unavailable — falling back to 10s REST polling (§19.2). */
  | 'polling'
  /** Session gone or realtime deliberately off; nothing is being fetched. */
  | 'offline'
  /** Mock mode: a canned replayer drives the map, no network at all. */
  | 'mock';

export const REALTIME_MODE_LABEL: Record<RealtimeMode, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  polling: 'Polling',
  offline: 'Offline',
  mock: 'Demo data',
};

export type MapStatusFilter = 'all' | TruckStatus | 'on_job';
