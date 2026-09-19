import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  rupeeStringToPaise,
  type AdminDirectoryBooking,
  type AdminDirectoryUser,
  type AdminDirectoryUserDetail,
  type AdminDriverDirectoryDetail,
  type AdminDriverDirectoryItem,
  type AdminDriverZoneRef,
  type AdminFleetItem,
  type AdminSuspensionRequest,
} from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import {
  bookings,
  drivers,
  driverZoneRestrictions,
  fleets,
  serviceZones,
  suspensionRequests,
  users,
} from '../../db/schema';

/**
 * W6's directory reads and suspension-request writes (§9.4.4).
 *
 * Search rules from the guide: TRIGRAM over names (the GIN indexes migration
 * 0024 installs), EXACT over mobiles, PREFIX over ids — one query, three
 * access paths, because an operator looks somebody up by whichever one they
 * have. ILIKE metacharacters in the probe are escaped: someone searching for
 * "100%" means the literal string, not "everything".
 */

export interface UserSearchParams {
  q?: string;
  status?: string;
  limit: number;
  offset: number;
}

export interface UserSearchResult {
  items: AdminDirectoryUser[];
  total: number;
}

export interface BookingListParams {
  userId: string;
  limit: number;
  offset: number;
}

export interface DriverSearchParams {
  q?: string;
  kycStatus?: string;
  online?: boolean;
  longDistance?: boolean;
  zoneId?: string;
  fleetId?: string;
  vehicleClass?: string;
  minRating?: number;
  limit: number;
  offset: number;
}

export interface FleetSearchParams {
  q?: string;
  status?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminDirectoryRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** `users` row → the contract shape, one mapping for every read path. */
  private userOf(row: {
    id: string;
    name: string | null;
    mobile: string;
    email: string | null;
    status: string;
    suspended_at: Date | string | null;
    suspension_reason: string | null;
    created_at: Date | string;
  }): AdminDirectoryUser {
    return {
      id: row.id,
      name: row.name,
      mobile: row.mobile,
      email: row.email,
      status: row.status as AdminDirectoryUser['status'],
      suspendedAt: isoOrNull(row.suspended_at),
      suspensionReason: row.suspension_reason,
      createdAt: iso(row.created_at),
    };
  }

  async searchUsers(params: UserSearchParams): Promise<UserSearchResult> {
    const filters: SQL[] = [];
    if (params.status) filters.push(sql`status::text = ${params.status}`);
    if (params.q) {
      const q = params.q;
      const like = `%${escapeLike(q)}%`;
      const prefix = `${escapeLike(q)}%`;
      filters.push(sql`(name ILIKE ${like} OR mobile = ${q} OR id::text ILIKE ${prefix})`);
    }
    const where: SQL = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``;

    const rows = (await this.db.execute(sql`
      select id, name, mobile, email, status::text as status,
             suspended_at, suspension_reason, created_at,
             count(*) over() as total
      from users
      ${where}
      order by name asc nulls last, id asc
      limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<{
      id: string;
      name: string | null;
      mobile: string;
      email: string | null;
      status: string;
      suspended_at: Date | string | null;
      suspension_reason: string | null;
      created_at: Date | string;
      total: number | string;
    }>;

    return {
      items: rows.map((row) => this.userOf(row)),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }

  /** Profile plus the one stat the header shows; 404 is the service's call. */
  async userDetail(userId: string): Promise<AdminDirectoryUserDetail | undefined> {
    const rows = (await this.db.execute(sql`
      select u.id, u.name, u.mobile, u.email, u.status::text as status,
             u.suspended_at, u.suspension_reason, u.created_at,
             (select count(*) from bookings b where b.user_id = u.id)::int as bookings_count
      from users u
      where u.id = ${userId}::uuid
    `)) as unknown as Array<{
      id: string;
      name: string | null;
      mobile: string;
      email: string | null;
      status: string;
      suspended_at: Date | string | null;
      suspension_reason: string | null;
      created_at: Date | string;
      bookings_count: number;
    }>;

    const row = rows[0];
    if (!row) return undefined;
    return { ...this.userOf(row), bookingsCount: row.bookings_count };
  }

  /** The user's trips, newest first, over the W6 bookings list indexes. */
  async userBookings(
    params: BookingListParams,
  ): Promise<{ items: AdminDirectoryBooking[]; total: number }> {
    const rows = (await this.db.execute(sql`
      select b.id, b.status::text as status, b.service_type::text as service_type,
             b.zone_id, b.driver_id, b.total, b.created_at, b.updated_at,
             count(*) over() as total_count
      from bookings b
      where b.user_id = ${params.userId}::uuid
      order by b.created_at desc, b.id desc
      limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<{
      id: string;
      status: string;
      service_type: string;
      zone_id: string | null;
      driver_id: string | null;
      total: string;
      created_at: Date | string;
      updated_at: Date | string;
      total_count: number | string;
    }>;

    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status as AdminDirectoryBooking['status'],
        serviceType: row.service_type,
        zoneId: row.zone_id,
        driverId: row.driver_id,
        totalPaise: rupeeStringToPaise(row.total),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
      total: rows[0] ? Number(rows[0].total_count) : 0,
    };
  }

  // -------------------------------------------------------------------------
  // W6: drivers directory (C5) — the same three search rules as users
  // -------------------------------------------------------------------------

  /** `drivers` row → the contract shape, one mapping for every read path. */
  private driverOf(row: DriverRow): AdminDriverDirectoryItem {
    return {
      id: row.id,
      name: row.name,
      mobile: row.mobile,
      kycStatus: row.kyc_status as AdminDriverDirectoryItem['kycStatus'],
      isOnline: row.is_online,
      lastPingAt: isoOrNull(row.last_ping_at),
      zoneId: row.current_zone_id,
      zoneName: row.zone_name,
      fleetId: row.fleet_id,
      fleetName: row.fleet_name,
      vehicleClass: row.vehicle_class as AdminDriverDirectoryItem['vehicleClass'],
      longDistanceEnabled: row.long_distance_enabled,
      rating: row.rating === null ? null : Number(row.rating),
      suspensionPending: row.suspension_pending,
      suspendedAt: isoOrNull(row.suspended_at),
      suspensionReason: row.suspension_reason,
      createdAt: iso(row.created_at),
    };
  }

  async searchDrivers(
    params: DriverSearchParams,
  ): Promise<{ items: AdminDriverDirectoryItem[]; total: number }> {
    const filters: SQL[] = [];
    if (params.kycStatus) filters.push(sql`d.kyc_status::text = ${params.kycStatus}`);
    if (params.online !== undefined) filters.push(sql`d.is_online = ${params.online}`);
    if (params.longDistance !== undefined) {
      filters.push(sql`d.long_distance_enabled = ${params.longDistance}`);
    }
    if (params.zoneId) filters.push(sql`d.current_zone_id = ${params.zoneId}::uuid`);
    if (params.fleetId) filters.push(sql`d.fleet_id = ${params.fleetId}::uuid`);
    if (params.vehicleClass) filters.push(sql`d.vehicle_class::text = ${params.vehicleClass}`);
    if (params.minRating !== undefined) filters.push(sql`d.rating >= ${params.minRating}`);
    if (params.q) {
      const q = params.q;
      const like = `%${escapeLike(q)}%`;
      const prefix = `${escapeLike(q)}%`;
      filters.push(sql`(d.name ILIKE ${like} OR d.mobile = ${q} OR d.id::text ILIKE ${prefix})`);
    }
    const where: SQL = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``;

    const rows = (await this.db.execute(sql`
      select d.id, d.name, d.mobile, d.kyc_status::text as kyc_status, d.is_online,
             d.last_ping_at, d.current_zone_id, z.name as zone_name,
             d.fleet_id, f.business_name as fleet_name,
             d.vehicle_class::text as vehicle_class, d.long_distance_enabled,
             d.rating, (d.pending_suspension_at is not null) as suspension_pending,
             d.suspended_at, d.suspension_reason, d.created_at,
             count(*) over() as total
      from drivers d
      left join service_zones z on z.id = d.current_zone_id
      left join fleets f on f.id = d.fleet_id
      ${where}
      order by d.name asc nulls last, d.id asc
      limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<DriverRow & { total: number | string }>;

    return {
      items: rows.map((row) => this.driverOf(row)),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }

  /** Profile plus the header's stat and the §6.10 zone list; 404 is the service's call. */
  async driverDetail(driverId: string): Promise<AdminDriverDirectoryDetail | undefined> {
    const rows = (await this.db.execute(sql`
      select d.id, d.name, d.mobile, d.kyc_status::text as kyc_status, d.is_online,
             d.last_ping_at, d.current_zone_id, z.name as zone_name,
             d.fleet_id, f.business_name as fleet_name,
             d.vehicle_class::text as vehicle_class, d.long_distance_enabled,
             d.rating, (d.pending_suspension_at is not null) as suspension_pending,
             d.suspended_at, d.suspension_reason, d.created_at,
             (select count(*) from bookings b where b.driver_id = d.id)::int as bookings_count,
             coalesce((
               select jsonb_agg(jsonb_build_object('zoneId', r.zone_id, 'name', rz.name)
                                order by rz.name asc)
               from driver_zone_restrictions r
               join service_zones rz on rz.id = r.zone_id
               where r.driver_id = d.id
             ), '[]'::jsonb) as zone_restrictions
      from drivers d
      left join service_zones z on z.id = d.current_zone_id
      left join fleets f on f.id = d.fleet_id
      where d.id = ${driverId}::uuid
    `)) as unknown as Array<
      DriverRow & { bookings_count: number; zone_restrictions: AdminDriverZoneRef[] }
    >;

    const row = rows[0];
    if (!row) return undefined;
    return {
      ...this.driverOf(row),
      bookingsCount: row.bookings_count,
      zoneRestrictions: row.zone_restrictions,
    };
  }

  /** The driver's trips, newest first, over the W6 bookings list indexes. */
  async driverBookings(
    params: { driverId: string; limit: number; offset: number },
  ): Promise<{ items: AdminDirectoryBooking[]; total: number }> {
    const rows = (await this.db.execute(sql`
      select b.id, b.status::text as status, b.service_type::text as service_type,
             b.zone_id, b.driver_id, b.total, b.created_at, b.updated_at,
             count(*) over() as total_count
      from bookings b
      where b.driver_id = ${params.driverId}::uuid
      order by b.created_at desc, b.id desc
      limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<{
      id: string;
      status: string;
      service_type: string;
      zone_id: string | null;
      driver_id: string | null;
      total: string;
      created_at: Date | string;
      updated_at: Date | string;
      total_count: number | string;
    }>;

    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status as AdminDirectoryBooking['status'],
        serviceType: row.service_type,
        zoneId: row.zone_id,
        driverId: row.driver_id,
        totalPaise: rupeeStringToPaise(row.total),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
      total: rows[0] ? Number(rows[0].total_count) : 0,
    };
  }

  /**
   * The driver's §6.10 restrictions with zone names, or `undefined` when the
   * driver does not exist. The LEFT joins make "no restrictions" one all-null
   * row, and "no driver" zero rows — the two cases the service must tell apart.
   */
  async driverZoneRefs(driverId: string): Promise<AdminDriverZoneRef[] | undefined> {
    const rows = (await this.db.execute(sql`
      select z.id as zone_id, z.name as name
      from drivers d
      left join driver_zone_restrictions r on r.driver_id = d.id
      left join service_zones z on z.id = r.zone_id
      where d.id = ${driverId}::uuid
      order by z.name asc nulls last
    `)) as unknown as Array<{ zone_id: string | null; name: string | null }>;

    if (rows.length === 0) return undefined;
    return rows.flatMap((row) =>
      row.zone_id === null ? [] : [{ zoneId: row.zone_id, name: row.name ?? '' }],
    );
  }

  /** Zone ids from the request that do not exist — the editor's 404 source. */
  async missingZoneIds(zoneIds: string[]): Promise<string[]> {
    if (zoneIds.length === 0) return [];
    const found = await this.db
      .select({ id: serviceZones.id })
      .from(serviceZones)
      .where(inArray(serviceZones.id, zoneIds));
    const present = new Set(found.map((row) => row.id));
    return zoneIds.filter((id) => !present.has(id));
  }

  /** Full replacement of a driver's zone restrictions, one transaction. */
  async replaceDriverZoneRestrictions(
    driverId: string,
    zoneIds: string[],
    createdBy: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(driverZoneRestrictions).where(eq(driverZoneRestrictions.driverId, driverId));
      if (zoneIds.length > 0) {
        await tx.insert(driverZoneRestrictions).values(
          zoneIds.map((zoneId) => ({ driverId, zoneId, createdBy })),
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // W6: fleets directory (C6) — same three search rules, plus dry-run counts
  // -------------------------------------------------------------------------

  /** `fleets` row → the contract shape, one mapping for every read path. */
  private fleetOf(row: FleetRow): AdminFleetItem {
    return {
      id: row.id,
      businessName: row.business_name,
      status: row.status as AdminFleetItem['status'],
      gstin: row.gstin,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      ownerMobile: row.owner_mobile,
      driversCount: row.drivers_count,
      onlineDriversCount: row.online_drivers_count,
      trucksCount: row.trucks_count,
      suspendedAt: isoOrNull(row.suspended_at),
      suspensionReason: row.suspension_reason,
      createdAt: iso(row.created_at),
    };
  }

  async searchFleets(
    params: FleetSearchParams,
  ): Promise<{ items: AdminFleetItem[]; total: number }> {
    const filters: SQL[] = [];
    if (params.status) filters.push(sql`f.status::text = ${params.status}`);
    if (params.q) {
      const q = params.q;
      const like = `%${escapeLike(q)}%`;
      const prefix = `${escapeLike(q)}%`;
      filters.push(
        sql`(f.business_name ILIKE ${like} OR u.mobile = ${q} OR f.id::text ILIKE ${prefix})`,
      );
    }
    const where: SQL = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``;

    const rows = (await this.db.execute(sql`
      ${FLEET_SELECT}
      ${where}
      order by f.business_name asc, f.id asc
      limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<FleetRow & { total: number | string }>;

    return {
      items: rows.map((row) => this.fleetOf(row)),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }

  /** Profile plus the same dry-run counts; 404 is the service's call. */
  async fleetDetail(fleetId: string): Promise<AdminFleetItem | undefined> {
    const rows = (await this.db.execute(sql`
      ${FLEET_SELECT}
      where f.id = ${fleetId}::uuid
    `)) as unknown as Array<FleetRow>;

    const row = rows[0];
    return row ? this.fleetOf(row) : undefined;
  }

  // -------------------------------------------------------------------------
  // Suspension requests
  // -------------------------------------------------------------------------

  async insertSuspensionRequest(entry: {
    subjectType: string;
    subjectId: string;
    requestedBy: string;
    reason: string;
  }): Promise<AdminSuspensionRequest> {
    const [row] = await this.db.insert(suspensionRequests).values(entry).returning();
    return requestOf(row!);
  }

  async listSuspensionRequests(status: string): Promise<AdminSuspensionRequest[]> {
    const rows = await this.db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.status, status))
      .orderBy(desc(suspensionRequests.createdAt))
      .limit(200);
    return rows.map(requestOf);
  }

  async suspensionRequest(id: string): Promise<AdminSuspensionRequest | undefined> {
    const [row] = await this.db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.id, id))
      .limit(1);
    return row ? requestOf(row) : undefined;
  }

  async decideSuspensionRequest(
    id: string,
    decision: { status: 'approved' | 'rejected'; decidedBy: string; note: string | null },
  ): Promise<void> {
    await this.db
      .update(suspensionRequests)
      .set({
        status: decision.status,
        decidedBy: decision.decidedBy,
        decidedAt: new Date(),
        decisionNote: decision.note,
      })
      .where(and(eq(suspensionRequests.id, id), eq(suspensionRequests.status, 'open')));
  }

  /**
   * The request target must exist — a typo'd id would otherwise become an
   * unactionable row in the inbox. One switch, three existence probes.
   */
  async subjectExists(subjectType: string, subjectId: string): Promise<boolean> {
    const table = subjectType === 'user' ? users : subjectType === 'driver' ? drivers : fleets;
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, subjectId))
      .limit(1);
    return Boolean(row);
  }

  /** The badge's source: open requests only. */
  async openSuspensionRequestCount(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from suspension_requests where status = 'open'
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }
}

/** The raw `drivers` columns every driver read selects, before the mapper. */
interface DriverRow {
  id: string;
  name: string | null;
  mobile: string;
  kyc_status: string;
  is_online: boolean;
  last_ping_at: Date | string | null;
  current_zone_id: string | null;
  zone_name: string | null;
  fleet_id: string | null;
  fleet_name: string | null;
  vehicle_class: string | null;
  long_distance_enabled: boolean;
  /** numeric arrives as a string from postgres.js; the mapper numbers it. */
  rating: string | number | null;
  suspension_pending: boolean;
  suspended_at: Date | string | null;
  suspension_reason: string | null;
  created_at: Date | string;
}

/** The raw `fleets`+owner columns every fleet read selects, before the mapper. */
interface FleetRow {
  id: string;
  business_name: string;
  status: string;
  gstin: string | null;
  owner_id: string;
  owner_name: string | null;
  owner_mobile: string;
  suspended_at: Date | string | null;
  suspension_reason: string | null;
  created_at: Date | string;
  drivers_count: number;
  online_drivers_count: number;
  trucks_count: number;
}

/**
 * The shared fleet projection: profile, owner contact, the three dry-run
 * counts, and a window total. One fragment rather than two copies — search and
 * detail must never drift on what a "driver count" means.
 */
const FLEET_SELECT = sql`
  select f.id, f.business_name, f.status::text as status, f.gstin, f.owner_id,
         u.name as owner_name, u.mobile as owner_mobile,
         f.suspended_at, f.suspension_reason, f.created_at,
         (select count(*) from drivers d where d.fleet_id = f.id)::int as drivers_count,
         (select count(*) from drivers d where d.fleet_id = f.id and d.is_online)::int as online_drivers_count,
         (select count(*) from fleet_trucks t where t.fleet_id = f.id)::int as trucks_count,
         count(*) over() as total
  from fleets f
  join users u on u.id = f.owner_id
`;

function requestOf(row: typeof suspensionRequests.$inferSelect): AdminSuspensionRequest {
  return {
    id: row.id,
    subjectType: row.subjectType as AdminSuspensionRequest['subjectType'],
    subjectId: row.subjectId,
    reason: row.reason,
    status: row.status as AdminSuspensionRequest['status'],
    requestedBy: row.requestedBy,
    createdAt: iso(row.createdAt),
    decidedBy: row.decidedBy,
    decidedAt: isoOrNull(row.decidedAt),
    decisionNote: row.decisionNote,
  };
}

/** ILIKE metacharacters escaped so "100%" searches for the literal string. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}
