import type { LatLng } from '@/types/geo';

export type VehicleClass = 'wheel_lift' | 'flatbed';

/**
 * §11.9's nearby supply — a COUNT and coarsened positions, nothing more.
 *
 * WHAT WAS DELETED HERE IS THE POINT. Until Phase 16 this type carried `name`,
 * `vehiclePlate`, `rating`, `etaMinutes` and a `vehicleClass`, all invented by
 * Phase 12's mock and never rendered. §11.9 forbids identity pre-assignment:
 * showing "Suresh, 4.8★, 3 min away" before dispatch has run promises a
 * specific driver the matcher has not chosen and may never offer the job to. The
 * server's response has no such fields either — the contract and this type were
 * cut together.
 *
 * Positions are snapped onto a ~100 m grid server-side. `coarsenedToMeters`
 * travels with them so the marker can be drawn at the size of the uncertainty
 * rather than as a precise dot.
 */
export type NearbySupply = {
  /** Honest total, counted before coarsening collapsed co-located drivers. */
  count: number;
  points: LatLng[];
  coarsenedToMeters: number;
  /** Redis was unavailable and this came from the last ~30s flush (§19.2). */
  degraded: boolean;
  /**
   * APP-LOCAL, OPTIONAL, MOCK-ONLY TODAY. Figma 07/08 draws ONE towing partner
   * on Home's map: a truck, a route line to the customer and the callout
   * "Towing partner" / "4 mins away". §11.9's wire response
   * (`NearbyDriversResponse`) has no such field, so `homeRestSource` never sets
   * it and Home derives an estimate from `points` instead (`nearestPartnerFrom`
   * in `home.queries.ts`). The mock sets it so every designed element renders
   * with EXPO_PUBLIC_USE_MOCKS=true, including the Figma example ETA.
   */
  nearestPartner?: NearestPartner;
};

/** The single partner the Home map draws (Figma 07 `287:2038` / `287:2045`). */
export type NearestPartner = {
  /** Still a coarsened position: no identity, plate or name. */
  coordinate: LatLng;
  /** Whole minutes until the partner could reach the customer ("4 mins away"). */
  etaMinutes: number;
  /**
   * Line from the partner to the customer, partner first. When a source gives
   * none, `useNearestPartner` fills it with Figma 07's route shape (`287:2037`)
   * stretched between the two points, because no directions source exists.
   */
  route?: LatLng[];
  /**
   * APP-LOCAL. Where this partner came from, so nothing downstream mistakes a
   * stand-in for supply:
   * - `source`: the data source named it (the mock's `nearestPartner`).
   * - `nearestSupply`: the closest §11.9 point, ETA estimated from distance.
   * - `designFraming`: no supply answer yet, an error or no drivers. Placed where
   *   Figma 07 frames the partner, because the design never drops the partner
   *   group (product owner rule). Not a real driver.
   */
  basis?: 'source' | 'nearestSupply' | 'designFraming';
};

export type QuickActionId = 'book' | 'schedule' | 'roadside' | 'support';
