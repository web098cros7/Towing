import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  rupeeStringToPaise,
  type AdminBookingDetail,
  type AdminBookingPayment,
  type AdminBookingRefund,
  type AdminBookingSummary,
  type AdminBookingTimelineEntry,
  type AdminBookingsQuery,
  type BookingActorValue,
  type JobStatus,
  type RefundKind,
  type RefundStatus,
  type PaymentPurpose,
  type PaymentStatusValue,
} from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';

/**
 * W8's bookings reads and the row shapes the action services validate against
 * (§9.4.7).
 *
 * THE LIST IS ONE QUERY, the detail is one query plus four small ones — the
 * timeline, the payments, the refunds and the open dispute — because each is a
 * genuinely different table and folding them into the detail SELECT with
 * LEFT JOINs would multiply the booking row per payment and refund. Reads run
 * on `DB`, which is the read connection where one exists.
 */

/** Everything the cancel/reassign/transition paths must know BEFORE they move anything. */
export interface AdminBookingActionRow {
  id: string;
  status: JobStatus;
  userId: string;
  driverId: string | null;
  fleetId: string | null;
  baseFare: string;
  /** Rupees string — the reminder template renders it. */
  total: string;
  /** Set when a coupon is attached — the waived cancel's "released" answer. */
  couponId: string | null;
  createdAt: Date;
}

export interface AdminBookingsSearchParams {
  query: AdminBookingsQuery;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminBookingsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** ILIKE metacharacters in a probe are escaped — "100%" means the literal string. */
  private static like(probe: string): string {
    return probe.replace(/[\\%_]/g, (char) => `\\${char}`);
  }

  /**
   * §9.4.7's filters, one query. The customer's name and mobile are searched
   * through the trigram indexes migration 0024 installed; the booking id is a
   * PREFIX match so an operator pasting the first characters of a reference
   * lands on it without a full scan.
   */
  private listFilter(query: AdminBookingsQuery): SQL {
    const filters: SQL[] = [];
    if (query.status && query.status.length > 0) {
      // `in (…)` with per-value casts rather than `= any($1::booking_status[])`:
      // the array form depends on the driver's array serialization, and this
      // reads the same in the query log either way.
      filters.push(
        sql`b.status in (${sql.join(
          query.status.map((value) => sql`${value}::booking_status`),
          sql`, `,
        )})`,
      );
    }
    // Inclusive IST day bounds; `to` is inclusive of the whole day.
    if (query.from) {
      filters.push(sql`b.created_at >= (${query.from}::date::timestamp at time zone 'Asia/Kolkata')`);
    }
    if (query.to) {
      filters.push(
        sql`b.created_at < ((${query.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    if (query.userId) filters.push(sql`b.user_id = ${query.userId}::uuid`);
    if (query.driverId) filters.push(sql`b.driver_id = ${query.driverId}::uuid`);
    if (query.fleetId) filters.push(sql`b.fleet_id = ${query.fleetId}::uuid`);
    if (query.zoneId) filters.push(sql`b.zone_id = ${query.zoneId}::uuid`);
    if (query.band) filters.push(sql`b.commission_band = ${query.band}::commission_band`);
    if (query.serviceType) filters.push(sql`b.service_type = ${query.serviceType}::service_type`);
    if (query.q) {
      const like = `%${AdminBookingsRepo.like(query.q)}%`;
      const prefix = `${AdminBookingsRepo.like(query.q)}%`;
      filters.push(sql`(
        b.id::text ilike ${prefix}
        or u.name ilike ${like}
        or u.mobile ilike ${like}
        or b.pickup_address ilike ${like}
      )`);
    }
    return filters.length > 0 ? sql.join(filters, sql` and `) : sql`true`;
  }

  async search(params: AdminBookingsSearchParams): Promise<{
    items: AdminBookingSummary[];
    total: number;
  }> {
    const where = this.listFilter(params.query);
    const rows = (await this.db.execute(sql`
      select b.id, b.status, b.service_type, b.vehicle_class,
             b.user_id, u.name as user_name, u.mobile as user_mobile,
             b.driver_id, d.name as driver_name,
             b.fleet_id, f.business_name as fleet_name,
             b.zone_id, z.name as zone_name,
             b.pickup_address, b.drop_address, b.distance_km::text as distance_km,
             b.total::text as total, b.commission_amount::text as commission_amount,
             b.driver_payout::text as driver_payout,
             b.commission_band, b.commission_pct::text as commission_pct,
             b.scheduled_at, b.created_at, b.updated_at,
             count(*) over() as total_count
        from bookings b
        join users u on u.id = b.user_id
        left join drivers d on d.id = b.driver_id
        left join fleets f on f.id = b.fleet_id
        left join service_zones z on z.id = b.zone_id
       where ${where}
       order by b.created_at desc, b.id desc
       limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      items: rows.map((row) => this.summaryOf(row)),
      total: rows[0] ? Number(rows[0].total_count) : 0,
    };
  }

  private summaryOf(row: Record<string, unknown>): AdminBookingSummary {
    const id = row.id as string;
    return {
      id,
      code: codeOf(id),
      status: row.status as JobStatus,
      serviceType: row.service_type as AdminBookingSummary['serviceType'],
      vehicleClass: row.vehicle_class as AdminBookingSummary['vehicleClass'],
      userId: row.user_id as string,
      userName: (row.user_name as string | null) ?? null,
      userMobile: row.user_mobile as string,
      driverId: (row.driver_id as string | null) ?? null,
      driverName: (row.driver_name as string | null) ?? null,
      fleetId: (row.fleet_id as string | null) ?? null,
      fleetName: (row.fleet_name as string | null) ?? null,
      zoneId: (row.zone_id as string | null) ?? null,
      zoneName: (row.zone_name as string | null) ?? null,
      pickupAddress: (row.pickup_address as string | null) ?? null,
      dropAddress: (row.drop_address as string | null) ?? null,
      distanceKm: row.distance_km === null ? null : Number(row.distance_km),
      totalPaise: rupeeStringToPaise(row.total as string),
      commissionPaise: rupeeStringToPaise(row.commission_amount as string),
      driverPayoutPaise: rupeeStringToPaise(row.driver_payout as string),
      commissionBand: (row.commission_band as AdminBookingSummary['commissionBand']) ?? null,
      commissionPct: row.commission_pct === null ? null : Number(row.commission_pct),
      scheduledAt: isoOrNull(row.scheduled_at),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  /** The row the action paths validate against — deliberately narrow. */
  async actionRow(bookingId: string): Promise<AdminBookingActionRow | null> {
    const [row] = (await this.db.execute(sql`
      select id, status, user_id, driver_id, fleet_id, coupon_id,
             base_fare::text as base_fare, total::text as total, created_at
        from bookings where id = ${bookingId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    if (!row) return null;
    return {
      id: row.id as string,
      status: row.status as JobStatus,
      userId: row.user_id as string,
      driverId: (row.driver_id as string | null) ?? null,
      fleetId: (row.fleet_id as string | null) ?? null,
      baseFare: row.base_fare as string,
      total: row.total as string,
      couponId: (row.coupon_id as string | null) ?? null,
      createdAt: new Date(row.created_at as string),
    };
  }

  async detail(bookingId: string): Promise<AdminBookingDetail | null> {
    const [row] = (await this.db.execute(sql`
      select b.*,
             u.name as user_name, u.mobile as user_mobile,
             d.name as driver_name,
             f.business_name as fleet_name,
             z.name as zone_name
        from bookings b
        join users u on u.id = b.user_id
        left join drivers d on d.id = b.driver_id
        left join fleets f on f.id = b.fleet_id
        left join service_zones z on z.id = b.zone_id
       where b.id = ${bookingId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    if (!row) return null;

    const summary = this.summaryOf(row);
    const [timeline, payments, refunds, openDisputeId] = await Promise.all([
      this.timeline(bookingId),
      this.payments(bookingId),
      this.refunds(bookingId),
      this.openDisputeId(bookingId),
    ]);

    return {
      ...summary,
      pickupLat: Number(row.pickup_lat),
      pickupLng: Number(row.pickup_lng),
      dropLat: row.drop_lat === null ? null : Number(row.drop_lat),
      dropLng: row.drop_lng === null ? null : Number(row.drop_lng),
      note: (row.note as string | null) ?? null,
      contactName: (row.contact_name as string | null) ?? null,
      contactMobile: (row.contact_mobile as string | null) ?? null,
      waitingFreeMinutes: (row.waiting_free_minutes as number | null) ?? null,
      waitingPerMinutePaise:
        row.waiting_per_minute === null ? null : rupeeStringToPaise(row.waiting_per_minute as string),
      completedAt: isoOrNull(row.completed_at),
      paidAt: isoOrNull(row.paid_at),
      cancelledBy: (row.cancelled_by as BookingActorValue | null) ?? null,
      cancellationReason: (row.cancellation_reason as string | null) ?? null,
      cancellationFeePaise: rupeeStringToPaise(row.cancellation_fee as string),
      driverCompensationPaise: rupeeStringToPaise(row.driver_compensation as string),
      unableReason: (row.unable_reason as string | null) ?? null,
      searchWave: (row.search_wave as number | null) ?? null,
      dispatchDeadlineAt: isoOrNull(row.dispatch_deadline_at),
      breakdown: {
        baseFarePaise: rupeeStringToPaise(row.base_fare as string),
        distanceChargePaise: rupeeStringToPaise(row.distance_charge as string),
        nightChargePaise: rupeeStringToPaise(row.night_charge as string),
        highwayChargePaise: rupeeStringToPaise(row.highway_charge as string),
        accidentChargePaise: rupeeStringToPaise(row.accident_charge as string),
        waitingChargePaise: rupeeStringToPaise(row.waiting_charge as string),
        surgePaise: rupeeStringToPaise(row.surge_amount as string),
        discountPaise: rupeeStringToPaise(row.discount as string),
        taxPct: Number(row.tax_pct),
        taxAmountPaise: rupeeStringToPaise(row.tax_amount as string),
        totalPaise: rupeeStringToPaise(row.total as string),
        commissionBand: (row.commission_band as AdminBookingDetail['commissionBand']) ?? null,
        commissionPct: row.commission_pct === null ? null : Number(row.commission_pct),
        commissionPaise: rupeeStringToPaise(row.commission_amount as string),
        driverPayoutPaise: rupeeStringToPaise(row.driver_payout as string),
      },
      timeline,
      payments,
      refunds,
      openDisputeId,
    };
  }

  async timeline(bookingId: string): Promise<AdminBookingTimelineEntry[]> {
    const rows = (await this.db.execute(sql`
      select status, actor, actor_id, note, created_at
        from booking_status_history
       where booking_id = ${bookingId}::uuid
       order by created_at asc, id asc
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      status: row.status as JobStatus,
      actor: row.actor as BookingActorValue,
      actorId: (row.actor_id as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      at: iso(row.created_at),
    }));
  }

  async payments(bookingId: string): Promise<AdminBookingPayment[]> {
    const rows = (await this.db.execute(sql`
      select id, purpose, status, method, amount::text as amount,
             refunded_amount::text as refunded_amount,
             captured_at, failure_reason, created_at
        from payments
       where booking_id = ${bookingId}::uuid
       order by created_at asc
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      purpose: row.purpose as PaymentPurpose,
      status: row.status as PaymentStatusValue,
      method: (row.method as AdminBookingPayment['method']) ?? null,
      amountPaise: rupeeStringToPaise(row.amount as string),
      refundedAmountPaise: rupeeStringToPaise(row.refunded_amount as string),
      capturedAt: isoOrNull(row.captured_at),
      failureReason: (row.failure_reason as string | null) ?? null,
      createdAt: iso(row.created_at),
    }));
  }

  async refunds(bookingId: string): Promise<AdminBookingRefund[]> {
    const rows = (await this.db.execute(sql`
      select id, kind, amount::text as amount, reason, status,
             dispute_id, processed_at, created_at
        from refunds
       where booking_id = ${bookingId}::uuid
       order by created_at asc
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      kind: row.kind as RefundKind,
      amountPaise: rupeeStringToPaise(row.amount as string),
      reason: (row.reason as string | null) ?? '',
      status: row.status as RefundStatus,
      disputeId: (row.dispute_id as string | null) ?? null,
      processedAt: isoOrNull(row.processed_at),
      createdAt: iso(row.created_at),
    }));
  }

  /** At most one, by the partial unique index — but null when none is open. */
  async openDisputeId(bookingId: string): Promise<string | null> {
    const [row] = (await this.db.execute(sql`
      select id from disputes
       where booking_id = ${bookingId}::uuid and status <> 'resolved'
       limit 1
    `)) as unknown as Array<{ id: string }>;
    return row?.id ?? null;
  }
}

/** Display code, derived exactly as the fleet console derives its job codes. */
export function codeOf(bookingId: string): string {
  return `TW-${bookingId.slice(0, 8).toUpperCase()}`;
}

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}
