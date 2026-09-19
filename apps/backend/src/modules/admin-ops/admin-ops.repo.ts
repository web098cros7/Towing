import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DB_READER, type DatabaseReader } from '../../db/db.module';
import { ACTIVE_JOB_STATUSES } from '../bookings/booking-state-machine.service';

/**
 * W3/W4's reads: dashboard KPIs, badge counts, the activity backfill and the
 * live-map snapshot (guide §9.4.2, §9.4.6).
 *
 * `DB_READER` throughout — §9.3.8's rule that dashboard/report reads must not
 * touch the live-ops path. Everything here is a plain aggregate or a bounded
 * list; the one query whose shape is load-bearing is the KPI block, whose
 * definitions the guide spells out because "dashboards usually start lying".
 * The comments on each method restate its definition so the SQL and the guide
 * cannot drift apart silently.
 */

export interface TodayResolutionCounts {
  /** Creations today that reached `assigned` at some point (history is authoritative). */
  matched: number;
  noDrivers: number;
  /** Cancelled with NO `assigned` ever — the third fill-rate term. */
  cancelledWhileSearching: number;
  cancelled: number;
}

export interface ActivityHistoryRow {
  id: string;
  bookingId: string;
  status: string;
  /** ISO string — `db.execute` hands timestamptz back as a string, normalised in the mapper. */
  at: string;
  zoneId: string | null;
  isFirst: boolean;
}

export interface ActivityAdminActionRow {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  adminId: string;
  at: string;
}

export interface LiveDriverRow {
  driverId: string;
  name: string | null;
  zoneId: string | null;
  /** Persisted PostGIS position — the fallback when Redis has no hash. */
  lat: number | null;
  lng: number | null;
  lastPingAt: string | null;
}

export interface LiveBookingRow {
  bookingId: string;
  status: string;
  serviceType: string;
  zoneId: string | null;
  driverId: string | null;
  pickupLat: number;
  pickupLng: number;
  dropLat: number | null;
  dropLng: number | null;
  createdAt: string;
}

@Injectable()
export class AdminOpsRepo {
  constructor(@Inject(DB_READER) private readonly db: DatabaseReader) {}
  /**
   * Active rides and live searches. `searching` excludes dormant scheduled
   * bookings — they sit in `searching` until their dispatch delay elapses, and
   * counting them as an active search inflates the tile every night (A18's
   * `booking_created.scheduledAt` exists for exactly this distinction).
   */
  async activeAndSearching(): Promise<{ activeRides: number; searching: number }> {
    const activeList = sql.join(
      ACTIVE_JOB_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    );
    const rows = (await this.db.execute(sql`
      select
        count(*) filter (where status::text in (${activeList}))::int as active_rides,
        count(*) filter (
          where status = 'searching' and (scheduled_at is null or scheduled_at <= now())
        )::int as searching
      from bookings
    `)) as unknown as Array<{ active_rides: number; searching: number }>;
    return {
      activeRides: rows[0]?.active_rides ?? 0,
      searching: rows[0]?.searching ?? 0,
    };
  }

  /**
   * Today's resolution counts for the fill rate, over bookings CREATED today
   * (IST). "Matched" is history-based on purpose: a booking cancelled after
   * assignment was still matched, and the current status alone cannot tell it
   * apart from one cancelled mid-search.
   */
  async todayResolutions(dayStartIso: string): Promise<TodayResolutionCounts> {
    const rows = (await this.db.execute(sql`
      select
        count(*) filter (where exists (
          select 1 from booking_status_history h
          where h.booking_id = b.id and h.status = 'assigned'
        ))::int as matched,
        count(*) filter (where b.status = 'no_drivers_found')::int as no_drivers,
        count(*) filter (where b.status = 'cancelled' and not exists (
          select 1 from booking_status_history h
          where h.booking_id = b.id and h.status = 'assigned'
        ))::int as cancelled_while_searching,
        count(*) filter (where b.status = 'cancelled')::int as cancelled
      from bookings b
      where b.created_at >= ${dayStartIso}::timestamptz
    `)) as unknown as Array<{
      matched: number;
      no_drivers: number;
      cancelled_while_searching: number;
      cancelled: number;
    }>;
    const row = rows[0];
    return {
      matched: row?.matched ?? 0,
      noDrivers: row?.no_drivers ?? 0,
      cancelledWhileSearching: row?.cancelled_while_searching ?? 0,
      cancelled: row?.cancelled ?? 0,
    };
  }

  /** GMV and commission over `paid` bookings whose `paid_at` is inside the IST day. */
  async todayRevenue(dayStartIso: string): Promise<{ gmv: string; commission: string }> {
    const rows = (await this.db.execute(sql`
      select
        coalesce(sum(total), 0)::text as gmv,
        coalesce(sum(commission_amount), 0)::text as commission
      from bookings
      where status = 'paid' and paid_at >= ${dayStartIso}::timestamptz
    `)) as unknown as Array<{ gmv: string; commission: string }>;
    return {
      gmv: rows[0]?.gmv ?? '0',
      commission: rows[0]?.commission ?? '0',
    };
  }

  /**
   * p50/p90 seconds from creation to the FIRST accepted offer, over bookings
   * created today. `dispatch_attempts.responded_at` on an `accepted` row IS the
   * acceptance instant; `accepted_at` does not exist as a column.
   */
  async timeToMatch(dayStartIso: string): Promise<{ p50: number | null; p90: number | null }> {
    const rows = (await this.db.execute(sql`
      select
        percentile_cont(0.5) within group (
          order by extract(epoch from (m.first_accepted - b.created_at))
        )::float8 as p50,
        percentile_cont(0.9) within group (
          order by extract(epoch from (m.first_accepted - b.created_at))
        )::float8 as p90
      from bookings b
      join lateral (
        select min(da.responded_at) as first_accepted
        from dispatch_attempts da
        where da.booking_id = b.id and da.outcome = 'accepted'
      ) m on true
      where b.created_at >= ${dayStartIso}::timestamptz
        and m.first_accepted is not null
    `)) as unknown as Array<{ p50: number | null; p90: number | null }>;
    return {
      p50: rows[0]?.p50 ?? null,
      p90: rows[0]?.p90 ?? null,
    };
  }

  /** Postgres-side online drivers: online + approved + pinged within 60 s. */
  async onlineDrivers(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n
      from drivers
      where is_online = true
        and kyc_status = 'approved'
        and last_ping_at >= now() - interval '60 seconds'
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** Pending KYC reviews and pending payout approvals — the approvals card + two badges. */
  async approvalCounts(): Promise<{ pendingKyc: number; pendingPayouts: number }> {
    const rows = (await this.db.execute(sql`
      select
        (select count(*) from drivers where kyc_status = 'pending')::int as pending_kyc,
        (select count(*) from payouts where approval_state = 'pending_approval')::int as pending_payouts
    `)) as unknown as Array<{ pending_kyc: number; pending_payouts: number }>;
    return {
      pendingKyc: rows[0]?.pending_kyc ?? 0,
      pendingPayouts: rows[0]?.pending_payouts ?? 0,
    };
  }

  /** Completed but not yet captured — a stuck-money signal, not a status count. */
  async completedUnpaid(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from bookings where status = 'completed'
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** The deletion badge's source — `deletion_requests` has existed since 0009. */
  async deletionRequests(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from deletion_requests where status = 'requested'
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /**
   * Backfill rows from history, newest first. `is_first` marks each booking's
   * opening row — creation writes that row directly with `searching` (A18), so
   * it is the one row that is a creation rather than a transition.
   */
  async activityHistory(limit: number): Promise<ActivityHistoryRow[]> {
    const rows = (await this.db.execute(sql`
      with recent as (
        select h.id, h.booking_id, h.status::text as status, h.created_at
        from booking_status_history h
        order by h.created_at desc
        limit ${limit}
      )
      select r.id, r.booking_id, r.status, r.created_at, b.zone_id,
        (r.created_at = (
          select min(h2.created_at) from booking_status_history h2 where h2.booking_id = r.booking_id
        )) as is_first
      from recent r
      left join bookings b on b.id = r.booking_id
      order by r.created_at desc
    `)) as unknown as Array<{
      id: string;
      booking_id: string;
      status: string;
      created_at: Date | string;
      zone_id: string | null;
      is_first: boolean;
    }>;
    return rows.map((row) => ({
      id: row.id,
      bookingId: row.booking_id,
      status: row.status,
      at: toIso(row.created_at),
      zoneId: row.zone_id,
      isFirst: row.is_first,
    }));
  }

  async activityAdminActions(limit: number): Promise<ActivityAdminActionRow[]> {
    const rows = (await this.db.execute(sql`
      select id, action, subject_type, subject_id, admin_id, created_at
      from admin_actions
      order by created_at desc
      limit ${limit}
    `)) as unknown as Array<{
      id: string;
      action: string;
      subject_type: string;
      subject_id: string | null;
      admin_id: string;
      created_at: Date | string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      adminId: row.admin_id,
      at: toIso(row.created_at),
    }));
  }

  /** Active zone ids — the `ZCARD` fan-out set for `dispatchableNow`. */
  async activeZoneIds(): Promise<string[]> {
    const rows = (await this.db.execute(sql`
      select id from service_zones where is_active = true
    `)) as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * Which drivers show on the admin map: online + approved, optionally narrowed
   * to a zone. Postgres is the authoritative id set; Redis is only ever allowed
   * to make these rows fresher (the fleet snapshot's tenancy rule, inverted —
   * here the whole platform IS the tenant).
   */
  async liveDrivers(zoneId?: string): Promise<LiveDriverRow[]> {
    const zoneFilter: SQL = zoneId ? sql` and d.current_zone_id = ${zoneId}::uuid` : sql``;
    const rows = (await this.db.execute(sql`
      select d.id as driver_id, d.name, d.current_zone_id,
             ST_X(d.current_location::geometry)::float8 as lng,
             ST_Y(d.current_location::geometry)::float8 as lat,
             d.last_ping_at
      from drivers d
      where d.is_online = true and d.kyc_status = 'approved'
        ${zoneFilter}
      order by d.name asc nulls last
    `)) as unknown as Array<{
      driver_id: string;
      name: string | null;
      current_zone_id: string | null;
      lng: number | null;
      lat: number | null;
      last_ping_at: Date | string | null;
    }>;
    return rows.map((row) => ({
      driverId: row.driver_id,
      name: row.name,
      zoneId: row.current_zone_id,
      lat: row.lat,
      lng: row.lng,
      lastPingAt: row.last_ping_at === null ? null : toIso(row.last_ping_at),
    }));
  }

  /**
   * Bookings worth drawing: the four `ACTIVE_JOB_STATUSES`. `searching` is not
   * here — a search has no driver to follow and belongs to W5's inspector.
   * `limit` is a packet guard, not pagination: nobody can act on 1,000 markers.
   */
  async liveBookings(zoneId?: string, status?: string): Promise<LiveBookingRow[]> {
    const activeList = sql.join(
      ACTIVE_JOB_STATUSES.map((value) => sql`${value}`),
      sql`, `,
    );
    const zoneFilter: SQL = zoneId ? sql` and b.zone_id = ${zoneId}::uuid` : sql``;
    const statusFilter: SQL = status ? sql` and b.status::text = ${status}` : sql``;
    const rows = (await this.db.execute(sql`
      select b.id as booking_id, b.status::text as status, b.service_type::text as service_type,
             b.zone_id, b.driver_id,
             b.pickup_lat, b.pickup_lng, b.drop_lat, b.drop_lng, b.created_at
      from bookings b
      where b.status::text in (${activeList})
        ${zoneFilter}
        ${statusFilter}
      order by b.created_at desc
      limit 1000
    `)) as unknown as Array<{
      booking_id: string;
      status: string;
      service_type: string;
      zone_id: string | null;
      driver_id: string | null;
      pickup_lat: number;
      pickup_lng: number;
      drop_lat: number | null;
      drop_lng: number | null;
      created_at: Date | string;
    }>;
    return rows.map((row) => ({
      bookingId: row.booking_id,
      status: row.status,
      serviceType: row.service_type,
      zoneId: row.zone_id,
      driverId: row.driver_id,
      pickupLat: row.pickup_lat,
      pickupLng: row.pickup_lng,
      dropLat: row.drop_lat,
      dropLng: row.drop_lng,
      createdAt: toIso(row.created_at),
    }));
  }
}

/**
 * `db.execute` hands `timestamptz` back as a string — the drizzle raw path does
 * not run the driver's date parser — while the query builder returns a Date.
 * Normalising in one place (the repo) keeps both shapes honest for callers.
 */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
