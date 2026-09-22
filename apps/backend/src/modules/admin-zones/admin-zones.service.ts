import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  dispatchConfigOverrideSchema,
  type AdminZone,
  type AdminZoneCreate,
  type AdminZonePreview,
  type AdminZonePreviewRequest,
  type AdminZoneUpdate,
  type AdminZoneVersion,
  type AdminZonesResponse,
  type GeoJsonPolygon,
} from '@towing/api-contracts';
import { asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { DB, type Database } from '../../db/db.module';
import { drivers, serviceZoneVersions, serviceZones } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { ZoneReconcileService } from './zone-reconcile.service';

/**
 * W13 — §9.4.8's service-zone editor: draw, preview, save, version, restore.
 *
 * GEOJSON EVERYWHERE THE OPERATOR TOUCHES, GEOGRAPHY WHERE THE ENGINE NEEDS IT.
 * Bodies carry a `Polygon`; the server converts on the way in with
 * `ST_GeomFromGeoJSON(...)::geography` and on the way out with
 * `ST_AsGeoJSON(area::geometry)` — the first uses of both functions in this repo.
 * Nothing in the console ever sees WKT.
 *
 * THE GEOMETRY RAIL IS `assertZoneGeometry`, and it refuses four things:
 * invalid rings (with PostGIS's own reason), more than one ring, too many
 * points, and an implausible area. OVERLAP IS NOT ONE OF THEM: the seeded
 * highway corridor crosses the city on purpose, and the resolver's
 * highway-first-then-smallest rule is what makes that work — so an overlap is
 * REPORTED in the preview, never refused.
 */
@Injectable()
export class AdminZonesService {
  private readonly logger = new Logger(AdminZonesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
    private readonly reconcile: ZoneReconcileService,
  ) {}

  async list(): Promise<AdminZonesResponse> {
    const rows = await this.db
      .select(this.zoneColumns())
      .from(serviceZones)
      .orderBy(asc(serviceZones.name));

    return {
      items: rows.map((row) => this.toZone(row)),
      // Spelled out for the editor: the order the resolver applies, so an
      // overlap is legible without reading `zone-resolver.service.ts`.
      resolution: [
        'A pickup inside several zones resolves to a HIGHWAY zone first.',
        'After that, the SMALLEST area wins — the more precise geofence.',
        'Inactive zones are invisible to the resolver and to go-online.',
      ],
    };
  }

  async get(zoneId: string): Promise<AdminZone> {
    const [row] = await this.db
      .select(this.zoneColumns())
      .from(serviceZones)
      .where(eq(serviceZones.id, zoneId))
      .limit(1);
    if (!row) throw ApiException.notFound('Zone not found');
    return this.toZone(row);
  }

  async create(
    adminId: string,
    body: AdminZoneCreate,
    context: SessionContext,
  ): Promise<AdminZone> {
    await this.assertZoneGeometry(body.area);

    let createdId: string;
    try {
      const [row] = await this.db
        .insert(serviceZones)
        .values({
          code: body.code,
          name: body.name,
          notes: body.notes ?? null,
          area: this.geography(body.area),
          surgeBand: body.surgeBand,
          isHighway: body.isHighway,
          dispatchConfig: body.dispatchConfig ?? null,
          updatedBy: adminId,
          version: 1,
        })
        .returning({ id: serviceZones.id });
      createdId = row!.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiException.conflict('A zone with that code already exists', { code: body.code });
      }
      throw error;
    }

    await this.writeVersion(createdId, 1, {
      area: body.area,
      surgeBand: body.surgeBand,
      isHighway: body.isHighway,
      isActive: true,
      dispatchConfig: body.dispatchConfig ?? null,
      reason: body.reason ?? 'Zone created',
      adminId,
    });

    const zone = await this.get(createdId);
    await this.audit.record({
      adminId,
      action: 'zone.create',
      subjectType: 'zone',
      subjectId: createdId,
      before: null,
      after: zone,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return zone;
  }

  /**
   * A reshape or a flag change. EVERY EDIT IS A VERSION — the snapshot rows
   * carry the shape AND its surge/highway/active state, so a restore puts back
   * what the operator remembers rather than half of it.
   *
   * ONLINE DRIVERS ARE NOT RE-HOMED BY THE DATABASE. Their zone is cached on the
   * Redis hash at go-online and on the driver row; a reshape that moves a
   * boundary has no way to reach into those. The reconcile pass does, and it
   * runs here — before the answer leaves the request — so "saved" and "the
   * marketplace agrees" are not a minute apart.
   */
  async update(
    adminId: string,
    zoneId: string,
    body: AdminZoneUpdate,
    context: SessionContext,
  ): Promise<AdminZone> {
    const before = await this.get(zoneId);
    if (body.area) await this.assertZoneGeometry(body.area);

    const version = before.version + 1;
    try {
      await this.db
        .update(serviceZones)
        .set({
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.area !== undefined ? { area: this.geography(body.area) } : {}),
          ...(body.surgeBand !== undefined ? { surgeBand: body.surgeBand } : {}),
          ...(body.isHighway !== undefined ? { isHighway: body.isHighway } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.dispatchConfig !== undefined ? { dispatchConfig: body.dispatchConfig } : {}),
          updatedBy: adminId,
          version,
          updatedAt: new Date(),
        })
        .where(eq(serviceZones.id, zoneId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiException.conflict('Another zone already uses that code', { code: body.code });
      }
      throw error;
    }

    const after = await this.get(zoneId);
    await this.writeVersion(zoneId, version, {
      area: after.area,
      surgeBand: after.surgeBand,
      isHighway: after.isHighway,
      isActive: after.isActive,
      dispatchConfig: after.dispatchConfig,
      reason: body.reason ?? 'Zone edited',
      adminId,
    });

    await this.audit.record({
      adminId,
      action: 'zone.update',
      subjectType: 'zone',
      subjectId: zoneId,
      before,
      after,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    // A reshape or a deactivation can strand drivers who are already online in
    // the old shape. The reconcile is part of the write, not a cron.
    if (body.area !== undefined || body.isActive === false) {
      await this.reconcile.reconcileZone(zoneId).catch((error: unknown) => {
        // The zone change itself is committed and correct; a reconcile failure
        // must be loud but not roll it back — the sweep can be re-run.
        this.logger.error(`zone reconcile failed for ${zoneId}: ${String(error)}`);
      });
    }

    return after;
  }

  async setActive(
    adminId: string,
    zoneId: string,
    isActive: boolean,
    reason: string | undefined,
    context: SessionContext,
  ): Promise<AdminZone> {
    return this.update(adminId, zoneId, { isActive, reason }, context);
  }

  async versions(zoneId: string): Promise<AdminZoneVersion[]> {
    const rows = await this.db
      .select()
      .from(serviceZoneVersions)
      .where(eq(serviceZoneVersions.zoneId, zoneId))
      .orderBy(desc(serviceZoneVersions.version))
      .limit(50);

    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      area: row.areaGeoJson as GeoJsonPolygon,
      surgeBand: row.surgeBand,
      isHighway: row.isHighway,
      isActive: row.isActive,
      dispatchConfig: (row.dispatchConfig ?? null) as AdminZoneVersion['dispatchConfig'],
      changedBy: row.changedBy,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Restore = apply an old snapshot AS A NEW VERSION. The history is
   * append-only: moving a pointer backwards would make "what did this look like
   * in March" unanswerable the moment somebody restored something.
   */
  async restore(
    adminId: string,
    zoneId: string,
    versionId: string,
    reason: string | undefined,
    context: SessionContext,
  ): Promise<AdminZone> {
    const [version] = await this.db
      .select()
      .from(serviceZoneVersions)
      .where(
        sql`${serviceZoneVersions.id} = ${versionId} AND ${serviceZoneVersions.zoneId} = ${zoneId}`,
      )
      .limit(1);
    if (!version) throw ApiException.notFound('Zone version not found');

    return this.update(
      adminId,
      zoneId,
      {
        area: version.areaGeoJson as GeoJsonPolygon,
        surgeBand: version.surgeBand,
        isHighway: version.isHighway,
        isActive: version.isActive,
        dispatchConfig: version.dispatchConfig ?? null,
        reason: reason ?? `Restored version ${version.version}`,
      },
      context,
    );
  }

  /**
   * §9.4.8's "see what it affects before saving" — a DRY RUN.
   *
   * Counts the online drivers inside the candidate shape and, of those, how many
   * would end up outside EVERY active zone (the ones the reconcile would evict).
   * Live bookings are counted because they are the thing an operator expects to
   * move and must not: a booking keeps its zone and its locked fare.
   */
  async preview(body: AdminZonePreviewRequest): Promise<AdminZonePreview> {
    await this.assertZoneGeometry(body.area);
    return this.previewFromCandidate(this.geography(body.area), body);
  }

  private async previewFromCandidate(
    candidate: SQL,
    body: AdminZonePreviewRequest,
  ): Promise<AdminZonePreview> {
    const rows = await this.db.execute(sql`
      WITH draft AS (SELECT ${candidate}::geography AS area)
      SELECT
        (SELECT ST_Area(area) / 1000000 FROM draft) AS area_km2,
        (SELECT count(*) FROM bookings b
          JOIN draft ON b.status IN ('searching', 'assigned', 'in_progress')
           AND ST_Covers(draft.area, ST_SetSRID(ST_MakePoint(b.pickup_lng, b.pickup_lat), 4326)::geography)
        ) AS live_bookings,
        (SELECT count(*) FROM service_zones z
          WHERE z.is_active
            AND (${body.excludeZoneId ?? null}::uuid IS NULL OR z.id <> ${body.excludeZoneId ?? null}::uuid)
            AND ST_Intersects(z.area, (SELECT area FROM draft))
        ) AS overlap_count
    `);

    const row = (
      rows as unknown as Array<{ area_km2: string; live_bookings: string; overlap_count: string }>
    )[0]!;

    const overlaps = await this.db
      .select({
        zoneId: serviceZones.id,
        zoneName: serviceZones.name,
        areaKm2: sql<number>`ST_Area(${serviceZones.area}) / 1000000`,
      })
      .from(serviceZones)
      .where(
        sql`${serviceZones.isActive}
          AND (${body.excludeZoneId ?? null}::uuid IS NULL OR ${serviceZones.id} <> ${body.excludeZoneId ?? null}::uuid)
          AND ST_Intersects(${serviceZones.area}, ${candidate}::geography)`,
      );

    // Online drivers are held in Redis, so their membership in a CANDIDATE
    // shape is resolved against their last fix rather than in SQL.
    const online = await this.reconcile.onlineDriversInShape(candidate);

    return {
      areaKm2: Number(row.area_km2),
      onlineDriversInside: online.inside,
      driversToEvict: online.stranded,
      liveBookingsInside: Number(row.live_bookings),
      overlaps: overlaps.map((entry) => ({
        zoneId: entry.zoneId,
        zoneName: entry.zoneName,
        areaKm2: Number(entry.areaKm2),
      })),
    };
  }

  /**
   * The four refusals. Every message names the SHAPE, not the caller: an
   * operator drawing a polygon wants to know what is wrong with it.
   */
  private async assertZoneGeometry(area: GeoJsonPolygon): Promise<void> {
    const rows = await this.db.execute(sql`
      SELECT
        ST_IsValid(geom) AS is_valid,
        ST_IsValidReason(geom) AS reason,
        ST_NPoints(geom) AS points,
        ST_NRings(geom) AS rings,
        ST_Area(geom::geography) / 1000000 AS area_km2
      FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area)}), 4326) AS geom) parsed
    `);

    const row = (
      rows as unknown as Array<{
        is_valid: boolean;
        reason: string | null;
        points: number;
        rings: number;
        area_km2: string;
      }>
    )[0]!;

    if (!row.is_valid) {
      throw ApiException.validation('That polygon crosses itself', {
        reason: row.reason,
        hint: 'Remove the crossing point and try again.',
      });
    }
    if (row.rings !== 1) {
      throw ApiException.validation('Zones are single rings at launch — no holes yet', {
        rings: row.rings,
      });
    }
    if (row.points > 2_000) {
      throw ApiException.validation('That polygon has too many points — simplify it', {
        points: row.points,
        cap: 2_000,
      });
    }
    const areaKm2 = Number(row.area_km2);
    if (areaKm2 < 0.05 || areaKm2 > 5_000) {
      throw ApiException.validation('That area is outside the plausible range', {
        areaKm2,
        allowed: '0.05 km² – 5,000 km²',
      });
    }
  }

  private geography(area: GeoJsonPolygon): SQL {
    return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area)}), 4326)::geography`;
  }

  private zoneColumns() {
    return {
      id: serviceZones.id,
      code: serviceZones.code,
      name: serviceZones.name,
      notes: serviceZones.notes,
      dispatchConfig: serviceZones.dispatchConfig,
      surgeBand: serviceZones.surgeBand,
      isHighway: serviceZones.isHighway,
      isActive: serviceZones.isActive,
      version: serviceZones.version,
      updatedAt: serviceZones.updatedAt,
      updatedBy: serviceZones.updatedBy,
      area: sql<string>`ST_AsGeoJSON(${serviceZones.area}::geometry)`,
      areaKm2: sql<number>`(ST_Area(${serviceZones.area}) / 1000000)::float8`,
    };
  }

  private toZone(row: {
    id: string;
    code: string;
    name: string;
    notes: string | null;
    dispatchConfig: unknown;
    surgeBand: AdminZone['surgeBand'];
    isHighway: boolean;
    isActive: boolean;
    version: number;
    updatedAt: Date;
    updatedBy: string | null;
    area: string;
    areaKm2: number;
  }): AdminZone {
    const parsed = dispatchConfigOverrideSchema.safeParse(row.dispatchConfig);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      notes: row.notes,
      dispatchConfig: parsed.success ? parsed.data : null,
      surgeBand: row.surgeBand,
      isHighway: row.isHighway,
      isActive: row.isActive,
      version: row.version,
      area: JSON.parse(row.area) as GeoJsonPolygon,
      areaKm2: Number(row.areaKm2),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  }

  private async writeVersion(
    zoneId: string,
    version: number,
    snapshot: {
      area: GeoJsonPolygon;
      surgeBand: AdminZone['surgeBand'];
      isHighway: boolean;
      isActive: boolean;
      dispatchConfig: unknown;
      reason: string;
      adminId: string;
    },
  ): Promise<void> {
    await this.db.insert(serviceZoneVersions).values({
      zoneId,
      version,
      areaGeoJson: snapshot.area as never,
      surgeBand: snapshot.surgeBand,
      isHighway: snapshot.isHighway,
      isActive: snapshot.isActive,
      dispatchConfig: (snapshot.dispatchConfig ?? null) as never,
      reason: snapshot.reason,
      changedBy: snapshot.adminId,
    });
  }
}
