import { z } from 'zod';
import { geoPointSchema } from '../common/geo';

/**
 * §9.1.5's address entry — autocomplete, details and reverse geocode (Phase 16,
 * re-homed from Phase 15 because the draggable pin needs a rendered map).
 *
 * PROXIED, NEVER CALLED FROM THE HANDSET. A Places key shipped inside an app
 * binary is extractable in minutes and is billed per call, so the key stays
 * server-side behind `ExternalCallPolicy` (timeout, breaker, metrics) and the
 * app talks to us. That also means one cache serves every customer instead of
 * each handset paying for its own lookups.
 *
 * `source` IS PART OF THE RESPONSE ON PURPOSE. No Google key exists yet
 * (SETUP-CHECKLIST item 7), so these routes are served by a local gazetteer —
 * a real permanent path, and the one the breaker falls back to afterwards.
 * `RouteDistance.source` set the precedent: a degradation ladder is only honest
 * if the client can see which rung answered.
 */

export const placeSourceSchema = z.enum(['google_places', 'local']);
export type PlaceSource = z.infer<typeof placeSourceSchema>;

export const placeAutocompleteQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  /**
   * Bias, not a filter. Suggestions near the customer beat alphabetically
   * similar ones 2,000 km away; omitting it still returns results.
   */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
export type PlaceAutocompleteQuery = z.infer<typeof placeAutocompleteQuerySchema>;

/**
 * A prediction carries NO coordinate, by design and by Google's terms: resolving
 * one costs a second (billed) call, so it happens once, when the customer picks
 * a row — not for every keystroke's worth of suggestions.
 */
export const placePredictionSchema = z.object({
  placeId: z.string().min(1),
  /** The bold line — "Indiranagar". */
  primary: z.string().min(1),
  /** The grey line — "100 Feet Road, Bengaluru". Empty when there is nothing to add. */
  secondary: z.string(),
});
export type PlacePrediction = z.infer<typeof placePredictionSchema>;

export const placeAutocompleteResponseSchema = z.object({
  predictions: z.array(placePredictionSchema),
  source: placeSourceSchema,
});
export type PlaceAutocompleteResponse = z.infer<typeof placeAutocompleteResponseSchema>;

export const placeDetailsQuerySchema = z.object({
  placeId: z.string().min(1).max(512),
});
export type PlaceDetailsQuery = z.infer<typeof placeDetailsQuerySchema>;

export const placeDetailSchema = z.object({
  placeId: z.string().min(1),
  /** Short label for the address field — "Indiranagar". */
  label: z.string().min(1),
  /** Full formatted address for the confirmation sheet. */
  address: z.string(),
  point: geoPointSchema,
  /**
   * The `service_zones` row containing this point, or null for "we do not
   * operate there". Returned here so the app can warn at selection time rather
   * than letting the customer build a whole booking and take a 422 at the
   * estimate (§6.10, §9.1.5's "pin moved outside zone").
   */
  zoneId: z.uuid().nullable(),
  zoneName: z.string().nullable(),
  source: placeSourceSchema,
});
export type PlaceDetail = z.infer<typeof placeDetailSchema>;

export const placeReverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type PlaceReverseQuery = z.infer<typeof placeReverseQuerySchema>;

/** `GET /v1/places/route`: the road route between two points, for the booking map's line. */
export const placeRouteQuerySchema = z.object({
  fromLat: z.coerce.number().min(-90).max(90),
  fromLng: z.coerce.number().min(-180).max(180),
  toLat: z.coerce.number().min(-90).max(90),
  toLng: z.coerce.number().min(-180).max(180),
});
export type PlaceRouteQuery = z.infer<typeof placeRouteQuerySchema>;

export const placeRouteResponseSchema = z.object({
  /** Encoded Google polyline, pickup first. */
  polyline: z.string(),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  /** `haversine` is a straight line (Directions unavailable): draw it dashed, never as roads. */
  source: z.enum(['google_directions', 'haversine']),
});
export type PlaceRouteResponse = z.infer<typeof placeRouteResponseSchema>;

/** Same shape as details — the map pin and a picked suggestion must fill the field identically. */
export const placeReverseResponseSchema = placeDetailSchema;
export type PlaceReverseResponse = z.infer<typeof placeReverseResponseSchema>;
