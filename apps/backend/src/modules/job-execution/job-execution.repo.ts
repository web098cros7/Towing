import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DriverJob, JobStatus } from '@towing/api-contracts';
import { rupeeStringToPaise } from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import { bookings, drivers, users } from '../../db/schema';

/** The booking as the §5.2 machine needs it — authorisation, timing and the locked money. */
export interface JobRow {
  id: string;
  userId: string;
  driverId: string | null;
  status: JobStatus;
  arrivedAt: Date | null;
  startedAt: Date | null;
  waitingFreeMinutes: number | null;
  waitingPerMinute: string | null;
  waitingCharge: string;
  total: string;
  customerName: string | null;
  customerMobile: string | null;
  contactName: string | null;
  contactMobile: string | null;
}

@Injectable()
export class JobExecutionRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * One read for the authorisation check and the fare finalizer.
   *
   * NO COMMISSION FIELDS AND NO OTP DIGEST. This row is consumed by a service
   * that builds a driver-facing DTO from it; keeping the columns it must never
   * publish out of the read is cheaper than remembering not to publish them.
   */
  async job(bookingId: string): Promise<JobRow | undefined> {
    const [row] = await this.db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        driverId: bookings.driverId,
        status: bookings.status,
        arrivedAt: bookings.arrivedAt,
        startedAt: bookings.startedAt,
        waitingFreeMinutes: bookings.waitingFreeMinutes,
        waitingPerMinute: bookings.waitingPerMinute,
        waitingCharge: bookings.waitingCharge,
        total: bookings.total,
        contactName: bookings.contactName,
        contactMobile: bookings.contactMobile,
        customerName: users.name,
        customerMobile: users.mobile,
      })
      .from(bookings)
      .leftJoin(users, eq(users.id, bookings.userId))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    return row as JobRow | undefined;
  }

  /** The attempt counter, read after a failed guess so the driver can be told what is left. */
  async otpAttempts(bookingId: string): Promise<number> {
    const [row] = await this.db
      .select({ attempts: bookings.otpAttempts })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    return row?.attempts ?? 0;
  }

  async driverName(driverId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: drivers.name })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    return row?.name ?? null;
  }

  /**
   * The job as it stands AFTER completion.
   *
   * `OfferService.currentJob` is scoped to `ACTIVE_JOB_STATUSES`, so the instant
   * a driver completes a trip it correctly returns null — the driver is idle and
   * eligible for the next offer. But the completion response still has to carry
   * the finished job: it is what §9.2.3's "completed (shows gross → commission →
   * net credited)" screen renders, and refetching would race the very state
   * change that just happened.
   *
   * So this rebuilds it from the row, including the freshly finalized waiting
   * charge and total, which is precisely the number the driver is owed an
   * explanation of.
   */
  async endedJob(bookingId: string): Promise<DriverJob | null> {
    const [row] = await this.db
      .select({ booking: bookings, customerName: users.name })
      .from(bookings)
      .leftJoin(users, eq(users.id, bookings.userId))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) return null;
    const booking = row.booking;

    const grossPaise = rupeeStringToPaise(booking.total);
    const commissionPct = booking.commissionPct === null ? null : Number(booking.commissionPct);
    // Recomputed from the LOCKED percentage rather than read from
    // `commission_amount`, which stays at zero until Phase 19 captures payment.
    // The driver is entitled to see what they earned the moment they finish,
    // not once somebody pays.
    const commissionPaise =
      commissionPct === null ? 0 : Math.round((grossPaise * commissionPct) / 100);

    return {
      bookingId: booking.id,
      reference: `TW-${booking.id.slice(0, 8).toUpperCase()}`,
      status: booking.status,
      serviceType: booking.serviceType,
      vehicleClass: booking.vehicleClass,
      earnings: {
        grossPaise,
        band: booking.commissionBand,
        commissionPct,
        commissionPaise,
        netPaise: grossPaise - commissionPaise,
      },
      pickup: { lat: booking.pickupLat, lng: booking.pickupLng },
      pickupAddress: booking.pickupAddress,
      drop:
        booking.dropLat !== null && booking.dropLng !== null
          ? { lat: booking.dropLat, lng: booking.dropLng }
          : null,
      dropAddress: booking.dropAddress,
      distanceKm: booking.distanceKm === null ? null : Number(booking.distanceKm),
      customerName: row.customerName,
      // The call button is gone once the trip is over; the number goes with it.
      customerMobile: null,
      customerRating: null,
      note: booking.note,
      otpPending: false,
      assignedAt: booking.updatedAt?.toISOString() ?? null,
      arrivedAt: booking.arrivedAt?.toISOString() ?? null,
      startedAt: booking.startedAt?.toISOString() ?? null,
      waiting: {
        freeMinutes: booking.waitingFreeMinutes ?? 0,
        perMinutePaise:
          booking.waitingPerMinute === null ? 0 : rupeeStringToPaise(booking.waitingPerMinute),
      },
      etaSeconds: null,
      routePolyline: null,
      routeDropPolyline: null,
    };
  }
}
