import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { driverLocationEventSchema } from '@towing/api-contracts';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { bookings } from '../../db/schema';
import { DRIVER_LOCATION_CHANNEL, REDIS } from '../../redis/redis.constants';
import { RealtimeSubscriberService } from '../../realtime/realtime-subscriber.service';
import { haversineMeters } from '../pricing/pricing.math';
import { AssignmentCacheService } from '../tracking/assignment-cache.service';

/**
 * Records when a tow's loaded truck leaves the pickup (`bookings.in_transit_at`),
 * the time screen 25 draws beside "In transit".
 *
 * The sibling of `EnRouteWatcher`, for the same reason: a driver does not tap
 * "I have left", they drive off, and the fact is already on `location:driver`.
 * Unlike setting off, this is not a status change; `in_progress` covers both the
 * loading and the tow. It is one timestamp, written once.
 *
 * The anchor is the booking's pickup point, which is stored, so there is no
 * Redis anchor as there is for setting off. Redis only remembers that a booking
 * is settled either way, so a trip's remaining pings skip the database.
 */

/** The same 150 m as `EnRouteWatcher`: outside parked GPS drift, inside "has left". */
const IN_TRANSIT_METERS = 150;

/** How long a settled booking is remembered: longer than any tow. */
const SETTLED_TTL_SECONDS = 6 * 60 * 60;

@Injectable()
export class InTransitWatcher implements OnModuleInit {
  private readonly logger = new Logger(InTransitWatcher.name);

  constructor(
    private readonly subscriber: RealtimeSubscriberService,
    private readonly assignments: AssignmentCacheService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.REALTIME_ENABLED) {
      // No ping stream, so no departure to observe: 25's "In transit" keeps its
      // placeholder. Said out loud, as `EnRouteWatcher` does.
      this.logger.warn('REALTIME_ENABLED=false — in_transit_at will not be recorded');
      return;
    }

    await this.subscriber.subscribe(DRIVER_LOCATION_CHANNEL, (payload) => {
      const parsed = driverLocationEventSchema.safeParse(payload);
      if (!parsed.success) return; // counted by the tracking relay; not twice.
      void this.onPing(parsed.data.driverId, { lat: parsed.data.lat, lng: parsed.data.lng });
    });
  }

  /**
   * One driver ping. Records the departure the first time an `in_progress` tow's
   * driver is 150 m or more from its pickup; everything else returns early.
   * Returns whether it recorded one (for the tests).
   */
  async onPing(driverId: string, at: { lat: number; lng: number }): Promise<boolean> {
    try {
      const assignment = await this.assignments.forDriver(driverId);
      // The cheap gate: every idle driver, and every trip not being carried out.
      if (!assignment || assignment.status !== 'in_progress') return false;

      const settledKey = `intransit:settled:${assignment.bookingId}`;
      if (await this.isSettled(settledKey)) return false;

      const [booking] = await this.db
        .select({
          pickupLat: bookings.pickupLat,
          pickupLng: bookings.pickupLng,
          dropLat: bookings.dropLat,
          inTransitAt: bookings.inTransitAt,
        })
        .from(bookings)
        .where(eq(bookings.id, assignment.bookingId))
        .limit(1);
      if (!booking) return false;

      // Already recorded, or a roadside job (no drop, nothing to carry): settled.
      if (booking.inTransitAt || booking.dropLat === null) {
        await this.settle(settledKey);
        return false;
      }

      const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
      if (haversineMeters(at, pickup) < IN_TRANSIT_METERS) return false;

      // Conditional, so two instances seeing the same ping write one instant.
      const written = await this.db
        .update(bookings)
        .set({ inTransitAt: new Date() })
        .where(
          and(
            eq(bookings.id, assignment.bookingId),
            eq(bookings.status, 'in_progress'),
            isNull(bookings.inTransitAt),
            isNotNull(bookings.dropLat),
          ),
        )
        .returning({ id: bookings.id });
      await this.settle(settledKey);
      return written.length > 0;
    } catch (error) {
      this.logger.warn(`in_transit detection failed for ${driverId}: ${String(error)}`);
      return false;
    }
  }

  private async isSettled(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch {
      return false; // Redis down: fall through to the database, which decides anyway.
    }
  }

  private async settle(key: string): Promise<void> {
    try {
      await this.redis.set(key, '1', 'EX', SETTLED_TTL_SECONDS);
    } catch {
      /* the next ping reads the database again, which is harmless */
    }
  }
}
