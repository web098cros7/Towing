import { z } from 'zod';
import { dispatchConfigOverrideSchema } from '../common/dispatch-config';
import { surgeBandSchema } from '../common/enums';

/**
 * W13 — §9.4.8's service-zone editor, `GET/POST/PUT /v1/admin/zones`.
 *
 * GEOJSON IN AND OUT. `service_zones.area` is a `geography(Polygon,4326)` that
 * has only ever been written as EWKT text by the seed; the editor needs the
 * shape a drawing library produces, and the server converts with
 * `ST_GeomFromGeoJSON(...)::geography` (the first use of that function in this
 * repo). GeoJSON is what MapLibre, Terra Draw and every GeoJSON tool in the
 * world speak — an EWKT string in a request body would make the console own a
 * serialisation nothing else uses.
 */

/**
 * A single-ring `Polygon`.
 *
 * ONE RING AT LAUNCH (§9.4.8's zones have no holes), and the schema says so
 * rather than leaving it to the service: a polygon with a hole in it would
 * silently change `ST_Covers` semantics for every driver inside the hole, and
 * "you cannot draw a donut yet" is a clearer answer than a fare that behaves
 * oddly in one neighbourhood.
 *
 * Positions are `[lng, lat]` — GeoJSON's order, which is NOT the lat/lng order
 * the rest of this API uses. The conversion happens once, in the service.
 */
export const geoJsonRingSchema = z
  .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .min(4);

export const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.tuple([geoJsonRingSchema]),
});
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygonSchema>;

/** One `service_zones` row as the editor reads it. */
export const adminZoneSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  notes: z.string().nullable(),
  /** The RAW override; `null` means "track the platform defaults". */
  dispatchConfig: dispatchConfigOverrideSchema.nullable(),
  surgeBand: surgeBandSchema,
  isHighway: z.boolean(),
  isActive: z.boolean(),
  /** The CURRENT shape's number; every shape is in `GET /:id/versions`. */
  version: z.number().int(),
  area: geoJsonPolygonSchema,
  /** PostGIS's own area, so the console never re-derives km² from degrees. */
  areaKm2: z.number(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.uuid().nullable(),
});
export type AdminZone = z.infer<typeof adminZoneSchema>;

export const adminZonesResponseSchema = z.object({
  items: z.array(adminZoneSchema),
  /**
   * What the resolver would do with these rows today, spelled out: highway
   * zones win over city zones, ties break on the smaller area. The editor shows
   * it so nobody has to read `resolve()` to understand an overlap.
   */
  resolution: z.array(z.string()),
});
export type AdminZonesResponse = z.infer<typeof adminZonesResponseSchema>;

/** `POST /v1/admin/zones`. */
export const adminZoneCreateSchema = z.object({
  code: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lower-case words separated by hyphens')
    .min(3)
    .max(40),
  name: z.string().min(3).max(120),
  notes: z.string().max(500).nullable().optional(),
  area: geoJsonPolygonSchema,
  surgeBand: surgeBandSchema.default('standard'),
  isHighway: z.boolean().default(false),
  dispatchConfig: dispatchConfigOverrideSchema.nullable().optional(),
  reason: z.string().min(3).max(500).optional(),
});
export type AdminZoneCreate = z.infer<typeof adminZoneCreateSchema>;

/**
 * `PUT /v1/admin/zones/:id` — partial, but a shape change is a whole new ring.
 *
 * `dispatchConfig: null` CLEARS the override, the same rule the dispatch screen
 * follows; omitting the key leaves it alone.
 */
export const adminZoneUpdateSchema = z
  .object({
    code: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .min(3)
      .max(40)
      .optional(),
    name: z.string().min(3).max(120).optional(),
    notes: z.string().max(500).nullable().optional(),
    area: geoJsonPolygonSchema.optional(),
    surgeBand: surgeBandSchema.optional(),
    isHighway: z.boolean().optional(),
    isActive: z.boolean().optional(),
    dispatchConfig: dispatchConfigOverrideSchema.nullable().optional(),
    reason: z.string().min(3).max(500).optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'reason'), {
    message: 'Nothing to update',
  });
export type AdminZoneUpdate = z.infer<typeof adminZoneUpdateSchema>;

/**
 * `POST /v1/admin/zones/preview` — §9.4.8's "see what it affects before saving".
 *
 * A DRY RUN, and it is the whole reason a reshape is safe to attempt: the report
 * names the online drivers who would be re-homed or evicted, the live bookings
 * inside (which keep their zone and their locked fare), and the zones this shape
 * overlaps. Overlap is ALLOWED — the seeded highway corridor already crosses the
 * city — so this reports rather than refuses.
 */
export const adminZonePreviewRequestSchema = z.object({
  area: geoJsonPolygonSchema,
  /** `false` previews a deactivation, where the affected set is the zone itself. */
  isActive: z.boolean().default(true),
  /** When editing: the zone being reshaped, so it does not overlap itself. */
  excludeZoneId: z.uuid().optional(),
  existingZoneId: z.uuid().optional(),
});
export type AdminZonePreviewRequest = z.infer<typeof adminZonePreviewRequestSchema>;

export const adminZonePreviewSchema = z.object({
  areaKm2: z.number(),
  onlineDriversInside: z.number().int(),
  /** Online drivers who would be left outside every active zone (W13's eviction). */
  driversToEvict: z.number().int(),
  liveBookingsInside: z.number().int(),
  overlaps: z.array(
    z.object({
      zoneId: z.uuid(),
      zoneName: z.string(),
      areaKm2: z.number(),
    }),
  ),
});
export type AdminZonePreview = z.infer<typeof adminZonePreviewSchema>;

/** `GET /v1/admin/zones/:id/versions` — §9.4.8's "versioned", newest first. */
export const adminZoneVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  area: geoJsonPolygonSchema,
  surgeBand: surgeBandSchema,
  isHighway: z.boolean(),
  isActive: z.boolean(),
  dispatchConfig: dispatchConfigOverrideSchema.nullable(),
  /** NULL on the migrated rows: nobody reshaped them, the seed wrote them. */
  changedBy: z.uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminZoneVersion = z.infer<typeof adminZoneVersionSchema>;
