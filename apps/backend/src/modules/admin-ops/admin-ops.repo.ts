import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminDispatchAttempt,
  AdminDispatchWaveLog,
  ScorerWeights,
} from '@towing/api-contracts';
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

/** W14 — `/sos_alerts` rows for the feed's backfill union. */
export interface ActivitySosAlertRow {
  id: string;
  subjectType: string;
  subjectId: string;
  bookingId: string | null;
  status: string;
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
  /**
   * W6 (C8): online + approved, but would an offer actually reach them right
   * now? False for a shelved suspension, a suspended fleet, or a zone
   * restriction on their CURRENT zone — the map still draws them, distinctly.
   */
  dispatchable: boolean;
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

/** W5: the booking header the inspector renders, plus the zone's raw JSONB config. */
export interface InspectorBookingRow {
  bookingId: string;
  status: string;
  serviceType: string;
  vehicleClass: string;
  zoneId: string | null;
  userId: string;
  customerName: string | null;
  customerMobile: string | null;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string | null;
  dropLat: number | null;
  dropLng: number | null;
  longDistance: boolean;
  searchWave: number | null;
  deadlineAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  /** Resolved by the service via `resolveDispatchConfig` — the repo stays a pipe. */
  zoneDispatchConfig: unknown;
}

/** W5: one live search, before the service resolves its ladder radius. */
export interface LiveSearchRow {
  bookingId: string;
  zoneId: string | null;
  serviceType: string;
  vehicleClass: string;
  wave: number | null;
  longDistance: boolean;
  deadlineAt: string | null;
  createdAt: string;
  /** Distinct drivers ever offered this booking. */
  contacted: number;
  zoneDispatchConfig: unknown;
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

  /**
   * The deletion badge's source — `deletion_requests` has existed since 0009;
   * W19 widened what "open" means. The predicate matches
   * `uq_deletion_requests_one_open_per_subject`'s, so the badge and the
   * one-open-request rule agree on the word by construction.
   */
  async deletionRequests(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from deletion_requests
       where status in ('requested', 'on_hold', 'approved', 'executing')
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** W6: open suspension requests — the Users badge's source since 0024. */
  async suspensionRequests(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from suspension_requests where status = 'open'
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /**
   * W8: open disputes — the Disputes badge's source since 0025. `<> 'resolved'`
   * matches the partial unique index's predicate, so the badge and "one open
   * dispute per booking" agree on what "open" means by construction.
   */
  async openDisputes(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from disputes where status <> 'resolved'
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** W14: open SOS alerts (`triggered` + `acknowledged`) — the `openSos` badge. */
  async openSosAlerts(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from sos_alerts where status in ('triggered', 'acknowledged')
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** W15: tickets not yet resolved/closed — the `openTickets` badge. */
  async openSupportTickets(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from support_tickets where status not in ('resolved', 'closed')
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /**
   * W14: §22.2's SOS response time — p50/p95 of `acknowledged_at − created_at`
   * over the last 30 days, plus the open count for the same tile.
   *
   * Percentiles stay NULL when nothing has been acknowledged: 0 seconds would
   * claim a response time nobody measured, the same trap `fillRatePct`
   * documents. `::float8` because `percentile_cont` over `numeric` comes back
   * as a string, and a KPI that is a string is a KPI that renders wrong.
   */
  async sosAcknowledgement(): Promise<{ open: number; p50: number | null; p95: number | null }> {
    const rows = (await this.db.execute(sql`
      select
        (select count(*) from sos_alerts where status in ('triggered', 'acknowledged'))::int as open,
        (percentile_cont(0.5) within group (
          order by extract(epoch from (acknowledged_at - created_at))
        ))::float8 as p50,
        (percentile_cont(0.95) within group (
          order by extract(epoch from (acknowledged_at - created_at))
        ))::float8 as p95
      from sos_alerts
      where acknowledged_at is not null
        and acknowledged_at >= now() - interval '30 days'
    `)) as unknown as Array<{ open: number; p50: number | null; p95: number | null }>;
    const row = rows[0];
    return { open: row?.open ?? 0, p50: row?.p50 ?? null, p95: row?.p95 ?? null };
  }

  /** W14: SOS rows for the activity feed's DB backfill. */
  async activitySosAlerts(limit: number): Promise<ActivitySosAlertRow[]> {
    const rows = (await this.db.execute(sql`
      select id, subject_type, subject_id, booking_id, status, created_at
      from sos_alerts
      order by created_at desc
      limit ${limit}
    `)) as unknown as Array<{
      id: string;
      subject_type: string;
      subject_id: string;
      booking_id: string | null;
      status: string;
      created_at: Date | string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      bookingId: row.booking_id,
      status: row.status,
      at: toIso(row.created_at),
    }));
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
             d.last_ping_at,
             -- W6 (C8): drawn, but would this driver actually get an offer
             -- right now? A live job's shelf, a suspended fleet, and a zone
             -- restriction for their CURRENT zone all say no — the map shows
             -- them so an operator can see WHY supply disappeared.
             (d.pending_suspension_at is null
              and coalesce(f.status <> 'suspended', true)
              and coalesce(not exists (
                select 1 from driver_zone_restrictions r
                where r.driver_id = d.id and r.zone_id = d.current_zone_id
              ), true)) as dispatchable
      from drivers d
      left join fleets f on f.id = d.fleet_id
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
      dispatchable: boolean;
    }>;
    return rows.map((row) => ({
      driverId: row.driver_id,
      name: row.name,
      zoneId: row.current_zone_id,
      lat: row.lat,
      lng: row.lng,
      lastPingAt: row.last_ping_at === null ? null : toIso(row.last_ping_at),
      dispatchable: row.dispatchable,
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

  // ---------------------------------------------------------------------------
  // W5 — dispatch inspector (§9.4.6)
  // ---------------------------------------------------------------------------

  /**
   * The booking under inspection, with the zone's RAW `dispatch_config` so the
   * service can resolve the current ladder without a second read per row.
   */
  async inspectorBooking(bookingId: string): Promise<InspectorBookingRow | undefined> {
    const rows = (await this.db.execute(sql`
      select b.id as booking_id, b.status::text as status,
             b.service_type::text as service_type, b.vehicle_class::text as vehicle_class,
             b.zone_id, b.user_id,
             u.name as customer_name, u.mobile as customer_mobile,
             b.pickup_lat, b.pickup_lng, b.pickup_address, b.drop_lat, b.drop_lng,
             (b.commission_band = 'C') as long_distance,
             b.search_wave, b.dispatch_deadline_at, b.scheduled_at, b.created_at,
             z.dispatch_config as zone_dispatch_config
      from bookings b
      left join users u on u.id = b.user_id
      left join service_zones z on z.id = b.zone_id
      where b.id = ${bookingId}::uuid
    `)) as unknown as Array<{
      booking_id: string;
      status: string;
      service_type: string;
      vehicle_class: string;
      zone_id: string | null;
      user_id: string;
      customer_name: string | null;
      customer_mobile: string | null;
      pickup_lat: number;
      pickup_lng: number;
      pickup_address: string | null;
      drop_lat: number | null;
      drop_lng: number | null;
      long_distance: boolean;
      search_wave: number | null;
      dispatch_deadline_at: Date | string | null;
      scheduled_at: Date | string | null;
      created_at: Date | string;
      zone_dispatch_config: unknown;
    }>;

    const row = rows[0];
    if (!row) return undefined;
    return {
      bookingId: row.booking_id,
      status: row.status,
      serviceType: row.service_type,
      vehicleClass: row.vehicle_class,
      zoneId: row.zone_id,
      userId: row.user_id,
      customerName: row.customer_name,
      customerMobile: row.customer_mobile,
      pickupLat: row.pickup_lat,
      pickupLng: row.pickup_lng,
      pickupAddress: row.pickup_address,
      dropLat: row.drop_lat,
      dropLng: row.drop_lng,
      longDistance: row.long_distance,
      searchWave: row.search_wave,
      deadlineAt: row.dispatch_deadline_at === null ? null : toIso(row.dispatch_deadline_at),
      scheduledAt: row.scheduled_at === null ? null : toIso(row.scheduled_at),
      createdAt: toIso(row.created_at),
      zoneDispatchConfig: row.zone_dispatch_config,
    };
  }

  /** The wave log, oldest wave first — the inspector's timeline, in order. */
  async waveLogsFor(bookingId: string): Promise<AdminDispatchWaveLog[]> {
    const rows = (await this.db.execute(sql`
      select id, wave, radius_km, considered, eligible, offered, degraded,
             weights, config, excluded, candidates, ran_at, duration_ms
      from dispatch_wave_logs
      where booking_id = ${bookingId}::uuid
      order by wave asc, ran_at asc
    `)) as unknown as Array<{
      id: string;
      wave: number;
      radius_km: string;
      considered: number;
      eligible: number;
      offered: number;
      degraded: boolean;
      weights: unknown;
      config: unknown;
      excluded: unknown;
      candidates: unknown;
      ran_at: Date | string;
      duration_ms: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      wave: row.wave,
      radiusKm: Number(row.radius_km),
      considered: row.considered,
      eligible: row.eligible,
      offered: row.offered,
      degraded: row.degraded,
      weights: row.weights as AdminDispatchWaveLog['weights'],
      config: row.config as AdminDispatchWaveLog['config'],
      excluded: row.excluded as AdminDispatchWaveLog['excluded'],
      candidates: row.candidates as AdminDispatchWaveLog['candidates'],
      ranAt: toIso(row.ran_at),
      durationMs: row.duration_ms,
    }));
  }

  /** Every attempt on the booking, joined to the driver it names (§9.4.6). */
  async attemptsFor(bookingId: string): Promise<AdminDispatchAttempt[]> {
    const rows = (await this.db.execute(sql`
      select da.driver_id, d.name as driver_name, d.mobile as driver_mobile,
             da.wave, da.radius_km, da.outcome, da.offered_at, da.responded_at
      from dispatch_attempts da
      left join drivers d on d.id = da.driver_id
      where da.booking_id = ${bookingId}::uuid
      order by da.offered_at asc, da.wave asc
    `)) as unknown as Array<{
      driver_id: string | null;
      driver_name: string | null;
      driver_mobile: string | null;
      wave: number;
      radius_km: string;
      outcome: string;
      offered_at: Date | string;
      responded_at: Date | string | null;
    }>;

    return rows.map((row) => ({
      driverId: row.driver_id,
      driverName: row.driver_name,
      driverMobile: row.driver_mobile,
      wave: row.wave,
      radiusKm: Number(row.radius_km),
      outcome: row.outcome as AdminDispatchAttempt['outcome'],
      offeredAt: toIso(row.offered_at),
      respondedAt: row.responded_at === null ? null : toIso(row.responded_at),
    }));
  }

  /**
   * The live-searches list: `searching` and not dormant (`scheduled_at` in the
   * future — a scheduled booking sits in `searching` and is not a live search;
   * same rule as `activeAndSearching`). Oldest first: the longest-waiting
   * customer is the one an operator is looking for.
   */
  async liveSearches(): Promise<LiveSearchRow[]> {
    const rows = (await this.db.execute(sql`
      select b.id as booking_id, b.zone_id,
             b.service_type::text as service_type, b.vehicle_class::text as vehicle_class,
             b.search_wave, coalesce(b.commission_band = 'C', false) as long_distance,
             b.dispatch_deadline_at, b.created_at,
             coalesce(a.contacted, 0) as contacted,
             z.dispatch_config as zone_dispatch_config
      from bookings b
      left join lateral (
        select count(distinct da.driver_id)::int as contacted
        from dispatch_attempts da
        where da.booking_id = b.id
      ) a on true
      left join service_zones z on z.id = b.zone_id
      where b.status = 'searching'
        and (b.scheduled_at is null or b.scheduled_at <= now())
      order by b.created_at asc
      limit 200
    `)) as unknown as Array<{
      booking_id: string;
      zone_id: string | null;
      service_type: string;
      vehicle_class: string;
      search_wave: number | null;
      long_distance: boolean;
      dispatch_deadline_at: Date | string | null;
      created_at: Date | string;
      contacted: number;
      zone_dispatch_config: unknown;
    }>;

    return rows.map((row) => ({
      bookingId: row.booking_id,
      zoneId: row.zone_id,
      serviceType: row.service_type,
      vehicleClass: row.vehicle_class,
      wave: row.search_wave,
      longDistance: row.long_distance,
      deadlineAt: row.dispatch_deadline_at === null ? null : toIso(row.dispatch_deadline_at),
      createdAt: toIso(row.created_at),
      contacted: row.contacted,
      zoneDispatchConfig: row.zone_dispatch_config,
    }));
  }

  /**
   * The §6.2 weights singleton. `undefined` when the row is missing (a fresh
   * or half-seeded database) — the caller falls back to the code defaults, the
   * same way `DispatchConfigRepo` does, rather than inventing a number here.
   */
  async globalWeights(): Promise<ScorerWeights | undefined> {
    const rows = (await this.db.execute(sql`
      select weight_proximity, weight_rating, weight_acceptance, weight_completion
      from dispatch_config
      limit 1
    `)) as unknown as Array<{
      weight_proximity: string;
      weight_rating: string;
      weight_acceptance: string;
      weight_completion: string;
    }>;

    const row = rows[0];
    if (!row) return undefined;
    return {
      proximity: Number(row.weight_proximity),
      rating: Number(row.weight_rating),
      acceptance: Number(row.weight_acceptance),
      completion: Number(row.weight_completion),
    };
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
