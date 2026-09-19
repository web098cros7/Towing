import { randomUUID } from 'node:crypto';
import { boolean, index, integer, jsonb, pgTable, text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { DispatchConfigOverride } from '@towing/api-contracts';
import { geographyPolygon } from '../geography';
import { adminUsers } from './admin';
import { primaryId, timestamps } from './columns';
import { surgeBandEnum } from './enums';

/**
 * Geofenced operating areas (§6.10, §17 GEOFENCING & DISPATCH CONFIG).
 *
 * Until Phase 14 this table had never been read by a request handler: only
 * `realtime/positions.repo.ts` selected it, for zone outlines on the fleet map.
 * `dispatch_config` had zero writers AND zero readers, `is_highway` was false on
 * every row, and `surge_band` was free text holding the literal 'standard'.
 * Phase 14 makes all three load-bearing — a booking's pickup is point-in-polygon
 * tested here to pick the zone, its surge band, any highway charge and its
 * dispatch radius ladder.
 */
export const serviceZones = pgTable('service_zones', {
  id: primaryId(),
  /**
   * W13 — the human key the console cites (`hsr-corridor`), unique by
   * construction. Backfilled from the id in 0028 because `name` is not unique
   * and nothing has ever stopped two zones sharing one.
   *
   * The default generates one for callers that do not care (test fixtures, the
   * odd script): the console's create form always supplies a code, and the seed
   * slugs the zone's name.
   */
  code: text('code')
    .notNull()
    .$defaultFn(() => `zone-${randomUUID().slice(0, 8)}`),
  name: text('name').notNull(),
  /** Free text for whoever next wonders why this shape exists. */
  notes: text('notes'),
  /** Who last reshaped it. No cascade — history outlives the admin. */
  updatedBy: uuid('updated_by').references(() => adminUsers.id),
  /**
   * The CURRENT shape's number. `service_zone_versions` holds every shape that
   * number has named; a restore writes a NEW version, so the log stays
   * append-only and "what did this look like in March" stays answerable.
   */
  version: integer('version').notNull().default(1),
  // GIST index (`idx_service_zones_geo`) added in migration 0002. Phase 14 is
  // its first user — `zone-resolver.service.ts`'s ST_Covers lookup.
  area: geographyPolygon('area').notNull(),
  /**
   * §7.4 surge tier. Was nullable `text` until migration 0011; every existing
   * row held 'standard', so the cast was free. The estimate multiplies by this,
   * and a free-text typo is a silently un-surged fare.
   */
  surgeBand: surgeBandEnum('surge_band').notNull().default('standard'),
  /** §7.4 highway pickup surcharge applies when the PICKUP falls in a zone with this set. */
  isHighway: boolean('is_highway').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  /**
   * §6.7 per-zone dispatch overrides — radius ladder, offer timing, wave size,
   * per-service variations. Typed by `dispatchConfigOverrideSchema` and read
   * ONLY through `resolveDispatchConfig()`, which supplies the code-level
   * defaults when this is NULL. A consumer reading the JSONB directly and
   * falling back to its own constants is the exact failure Phase 17 is written
   * to avoid.
   *
   * Not to be confused with the `dispatch_config` TABLE, which holds the global
   * scorer weights. See `db/schema/pricing.ts`.
   */
  dispatchConfig: jsonb('dispatch_config').$type<DispatchConfigOverride>(),
  ...timestamps,
},
  (t) => [uniqueIndex('uq_service_zones_code').on(t.code)],
);

/**
 * W13 — one row per SHAPE a zone has had, so §9.4.8's "versioned" is a fact and
 * a restore is possible.
 *
 * THE GEOMETRY IS STORED AS GEOJSON, not geography: a version is a document of
 * what the shape was, and `ST_GeomFromGeoJSON` back into the column is the
 * restore. It is also readable — a diff of two versions is a diff of two lists
 * of coordinates rather than an opaque WKB blob.
 *
 * Append-only: a restore inserts a new row with the old coordinates, it does
 * not move the pointer backwards. A history you can rewrite is not a history.
 */
export const serviceZoneVersions = pgTable(
  'service_zone_versions',
  {
    id: primaryId(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => serviceZones.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    areaGeoJson: jsonb('area_geojson').notNull(),
    surgeBand: surgeBandEnum('surge_band').notNull(),
    isHighway: boolean('is_highway').notNull(),
    isActive: boolean('is_active').notNull(),
    dispatchConfig: jsonb('dispatch_config').$type<DispatchConfigOverride>(),
    /** NULL only for the seed backfill: nobody, before the editor existed. */
    changedBy: uuid('changed_by').references(() => adminUsers.id),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_service_zone_versions_zone_version').on(t.zoneId, t.version),
    index('idx_service_zone_versions_zone_created').on(t.zoneId, t.createdAt.desc().nullsLast()),
  ],
);
