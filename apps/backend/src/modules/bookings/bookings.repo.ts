import { Inject, Injectable } from '@nestjs/common';
import {
  resolveDispatchConfig,
  rupeeStringToPaise,
  type Booking,
  type BookingDetail,
} from '@towing/api-contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../../db/db.module';
import { bookings, services, serviceZones } from '../../db/schema';
import { decodeCursor, encodeCursor } from '../jobs/jobs.cursor';
import { OPEN_BOOKING_STATUSES } from './booking-state-machine.service';

/**
 * The customer's own view of `bookings`.
 *
 * Every existing reader of this table is fleet-scoped (`WHERE fleet_id = ?`);
 * this is the first that is customer-scoped, and it is backed by
 * `idx_bookings_user_feed`, the twin of `idx_bookings_fleet_feed` that migration
 * 0012 added for exactly this query.
 */
type BookingRow = typeof bookings.$inferSelect & { serviceSlug: string | null };

@Injectable()
export class BookingsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Newest first, keyset paginated.
   *
   * Reuses `jobs.cursor.ts` rather than hand-rolling the predicate — that file
   * is `jobs`-namespaced but generic, and `earnings.repo.ts` already made a
   * second inline copy. A third would guarantee the three disagree about a
   * boundary row eventually.
   */
  async list(userId: string, limit: number, cursor?: string): Promise<{ items: Booking[]; nextCursor: string | null }> {
    const decoded = cursor ? decodeCursor(cursor) : null;

    const rows = await this.db
      .select({ booking: bookings, serviceSlug: services.slug })
      .from(bookings)
      .leftJoin(services, eq(services.serviceType, bookings.serviceType))
      .where(
        and(
          eq(bookings.userId, userId),
          decoded
            ? sql`(${bookings.createdAt}, ${bookings.id}) < (${decoded.createdAt.toISOString()}::timestamptz, ${decoded.id}::uuid)`
            : undefined,
        ),
      )
      // `desc nulls last` spelled out: the index is DESC NULLS LAST and Postgres
      // matches null-ordering when picking a sortless plan — a bare DESC forces
      // a Sort node even though both columns are NOT NULL.
      .orderBy(sql`${bookings.createdAt} desc nulls last`, sql`${bookings.id} desc nulls last`)
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map((r) => toBooking({ ...r.booking, serviceSlug: r.serviceSlug })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.booking.createdAt, id: last.booking.id })
          : null,
    };
  }

  /** Scoped by `userId` in the WHERE, never checked afterwards — a filter that runs is a filter. */
  async detail(userId: string, bookingId: string): Promise<BookingDetail | null> {
    const [row] = await this.db
      .select({ booking: bookings, serviceSlug: services.slug })
      .from(bookings)
      .leftJoin(services, eq(services.serviceType, bookings.serviceType))
      .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)))
      .limit(1);

    if (!row) return null;
    const booking = { ...row.booking, serviceSlug: row.serviceSlug };

    return {
      ...toBooking(booking),
      note: booking.note,
      contactName: booking.contactName,
      contactMobile: booking.contactMobile,
      cancellationReason: booking.cancellationReason,
      cancelledBy: booking.cancelledBy,
      cancellationFeePaise: rupeeStringToPaise(booking.cancellationFee),
      // §9.1.7: "OTP never visible before assignment". Sent so the app can hide
      // the card rather than probe a route that would 409.
      otpAvailable: isOtpAvailable(booking.status),
      search: await this.searchProgress(booking),
    };
  }

  /**
   * §6.4 wave state for §19.2's polling fallback (Phase 17).
   *
   * `null` unless the booking is ACTUALLY searching. A `no_drivers_found`
   * booking still carries its last `search_wave` on the row — deliberately, so
   * §9.1.6's "retry / widen" can resume from it — but reporting that as live
   * progress would leave the customer's screen claiming a search that stopped.
   *
   * A SECOND QUERY, AND ONLY FOR A LIVE SEARCH. Every non-searching booking —
   * the whole trip list, every completed job — pays nothing. The one case that
   * does pay is the one the customer is polling every ten seconds, and the
   * alternative was worse in both directions: snapshotting the radius onto the
   * booking row would go stale the moment an admin tuned the zone's ladder
   * (§6.7 says these change with no deploy), and reporting zeros would be
   * exactly the invented progress §9.1.6 forbids.
   */
  private async searchProgress(booking: BookingRow): Promise<BookingDetail['search']> {
    if (booking.status !== 'searching' || booking.searchWave === null) return null;

    const [row] = await this.db
      .select({
        dispatchConfig: serviceZones.dispatchConfig,
        // DISTINCT: §6.5's re-dispatch can offer the same driver again on a
        // later wave, and telling the customer "8 drivers contacted" when it was
        // the same three people twice is the kind of true-ish number that
        // destroys trust in every other number on the screen.
        contacted: sql<number>`(
          select count(distinct driver_id)::int
          from dispatch_attempts
          where booking_id = ${booking.id}
        )`,
      })
      .from(serviceZones)
      .where(eq(serviceZones.id, booking.zoneId ?? sql`null`))
      .limit(1);

    // `resolveDispatchConfig` is the ONLY sanctioned reader of the JSONB — a
    // caller re-inventing the NULL handling is how a second radius ladder gets
    // hard-coded, which is the outcome that file exists to prevent.
    const ladder = resolveDispatchConfig(row?.dispatchConfig, booking.serviceType).radiusLadderKm;
    // Waves are 1-based; a search that has outrun the ladder sits on its last
    // rung until the deadline terminates it.
    const radiusKm = ladder[Math.min(booking.searchWave, ladder.length) - 1] ?? ladder[0]!;

    return {
      wave: booking.searchWave,
      radiusKm,
      driversContacted: row?.contacted ?? 0,
      deadlineAt: booking.dispatchDeadlineAt?.toISOString() ?? null,
    };
  }

  /** The §3.8 guard: does this customer already have a trip in flight? */
  async findOpenBooking(userId: string): Promise<{ id: string; status: string } | null> {
    const [row] = await this.db
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.userId, userId), inArray(bookings.status, [...OPEN_BOOKING_STATUSES])))
      .limit(1);
    return row ?? null;
  }

  /**
   * §3.8's "customer with unpaid prior balance".
   *
   * `completed` and not `paid` — §5.1 distinguishes delivered from settled, so
   * the condition needs no new table and no customer wallet (`wallet_owner_type`
   * reserves `'user'` and nothing has ever created one). §19.2's "Razorpay down
   * → bookings complete as COMPLETED (unpaid)" is precisely this state.
   */
  async findUnpaidBooking(userId: string): Promise<{ id: string } | null> {
    const [row] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.userId, userId), eq(bookings.status, 'completed')))
      .limit(1);
    return row ?? null;
  }
}

/** §9.1.7 — assignment is the earliest a code may be read. */
export function isOtpAvailable(status: string): boolean {
  return ['assigned', 'en_route', 'arrived', 'in_progress'].includes(status);
}

/**
 * Row → DTO, built field by field.
 *
 * NO COMMISSION, for the §7.6 reason the estimate has none: the row carries
 * `commission_band`, `commission_pct`, `commission_amount` and `driver_payout`,
 * and a spread would hand all four to the customer.
 */
function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    // Matches `jobs.mapper.ts`'s synthesis exactly — a customer and a fleet
    // operator reading different codes for the same trip is a support call.
    reference: `TW-${row.id.slice(0, 8).toUpperCase()}`,
    status: row.status,
    serviceSlug: row.serviceSlug ?? row.serviceType,
    serviceType: row.serviceType,
    vehicleClass: row.vehicleClass,
    pickupAddress: row.pickupAddress,
    pickup: { lat: row.pickupLat, lng: row.pickupLng },
    dropAddress: row.dropAddress,
    drop: row.dropLat !== null && row.dropLng !== null ? { lat: row.dropLat, lng: row.dropLng } : null,
    distanceKm: row.distanceKm === null ? null : Number(row.distanceKm),
    breakdown: {
      basePaise: rupeeStringToPaise(row.baseFare),
      nightPaise: rupeeStringToPaise(row.nightCharge),
      highwayPaise: rupeeStringToPaise(row.highwayCharge),
      accidentPaise: rupeeStringToPaise(row.accidentCharge),
      waitingPaise: rupeeStringToPaise(row.waitingCharge),
      surgePaise: rupeeStringToPaise(row.surgeAmount),
      discountPaise: rupeeStringToPaise(row.discount),
      taxPaise: rupeeStringToPaise(row.taxAmount),
      totalPaise: rupeeStringToPaise(row.total),
    },
    band: row.commissionBand,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

