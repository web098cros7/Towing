import { z } from 'zod';
import { geoPointSchema } from '../common/geo';
import { vehicleClassSchema } from '../fleet/trucks';

/**
 * `GET /v1/drivers/nearby` (§11.9) — the "there is supply here" signal the
 * customer's home map draws.
 *
 * WHAT IS DELIBERATELY ABSENT IS THE CONTRACT. §11.9 forbids identity
 * pre-assignment, so there is no driver id, no name, no plate, no rating and no
 * per-driver ETA anywhere below. TowGo's own `NearbyDriver` type carried
 * `name`, `vehiclePlate` and `rating` from Phase 12's mock; Phase 16 deletes
 * them rather than serve them, because a customer who has been shown "Suresh,
 * 4.8★, 3 min away" before dispatch has run has been promised a driver the
 * matcher has not chosen and may never offer the job to.
 *
 * POSITIONS ARE SNAPPED, NOT JITTERED. Each point is rounded onto a ~100 m
 * grid. Jitter looks equivalent and is not: it re-rolls per request, so a
 * client polling every few seconds averages the noise away and recovers the
 * true position to within metres. A grid snap is stable — repeated reads return
 * the same coarse cell, and the true point is unrecoverable.
 */

export const nearbyDriversQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  /** Viewport-scoped (§11.9). Capped so this cannot become a nationwide supply census. */
  radiusKm: z.coerce.number().positive().max(25).default(5),
});
export type NearbyDriversQuery = z.infer<typeof nearbyDriversQuerySchema>;

/**
 * One nearby truck as the map draws it: the same coarsened position as
 * `points`, plus which way it faces and what kind of truck it is, so the map
 * shows a flatbed or a wheel-lift pointing along the road. Still no identity:
 * no driver, plate or name. Null where the degraded (PostGIS) rung cannot say.
 */
export const nearbyVehicleSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  /** Degrees clockwise from north, rounded to 5. */
  headingDeg: z.number().nullable(),
  vehicleClass: vehicleClassSchema.nullable(),
});
export type NearbyVehicle = z.infer<typeof nearbyVehicleSchema>;

export const nearbyDriversResponseSchema = z.object({
  /** The honest supply number, computed BEFORE coarsening collapses co-located drivers. */
  count: z.number().int().nonnegative(),
  points: z.array(geoPointSchema),
  /** `points` with heading and truck type, one per coarsened cell. */
  vehicles: z.array(nearbyVehicleSchema),
  /** Published so the client can size its marker to the uncertainty rather than pretend to precision. */
  coarsenedToMeters: z.number().int().positive(),
  at: z.iso.datetime(),
  /**
   * Redis was unavailable and this was answered from PostGIS (§19.2). The count
   * is still real, just as fresh as the last ~30 s flush rather than live.
   */
  degraded: z.boolean(),
});
export type NearbyDriversResponse = z.infer<typeof nearbyDriversResponseSchema>;
