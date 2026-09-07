import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  driverLocationEventSchema,
  type CustomerLocationUpdateEvent,
  type DriverLocationEvent,
} from '@towing/api-contracts';
import { ENV, type Env } from '../../config/env';
import { DRIVER_LOCATION_CHANNEL } from '../../redis/redis.constants';
import { RealtimeSubscriberService } from '../../realtime/realtime-subscriber.service';
import { CustomerGateway } from '../bookings/customer.gateway';
import { AssignmentCacheService } from './assignment-cache.service';
import { EtaService } from './eta.service';

/**
 * §11.4's ping → the customer's map (Phase 18).
 *
 * THE SECOND SUBSCRIBER ON `location:driver`, WHICH IS WHY THAT CHANNEL EXISTS.
 * Phase 16 published a driver-shaped event alongside the truck-shaped one the
 * fleet console had consumed since Phase 5, with a docblock saying exactly this:
 * "this carries what a consumer following a PERSON needs — Phase 18's customer
 * tracking, which watches a driver approach a pickup and has no truck id to key
 * on until an assignment exists." Nothing subscribed to it until now.
 *
 * It composes with the fleet relay because `RealtimeSubscriberService` holds a
 * LIST of handlers per channel rather than one — the Phase 5 bug that made
 * `ops:metrics` silently never arrive, fixed there and relied on here.
 *
 * THREE GATES BEFORE ANY WORK HAPPENS, in increasing cost order, because this
 * runs at 3 s per active driver on every task:
 *
 *   1. Is this driver on a job? A Redis lookup, cached, no database.
 *   2. Is anybody watching that booking ON THIS NODE? `localRoomSize`, in-memory.
 *      A node with no subscribers for a booking does zero work for its entire
 *      ping stream — the same property `RealtimeRelayService.flush` has.
 *   3. Only then: coalesce, emit, and let the ETA engine decide about a recompute.
 *
 * COALESCED TO ONE FRAME PER BOOKING PER `REALTIME_FLUSH_MS`, like the fleet
 * relay and for the same reason: §11.4 animates the marker over ~1 s, so
 * delivering three pings inside that window buys nothing and costs three frames
 * on a mobile connection. `LocationBatcher` is not reused — it is keyed by fleet
 * and truck, which is the wrong shape here — but the discipline is copied,
 * including the out-of-order drop.
 */
@Injectable()
export class TrackingRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingRelayService.name);

  /** bookingId → newest frame seen this window. */
  private pending = new Map<string, CustomerLocationUpdateEvent>();
  /** bookingId → the booking's status, carried so the ETA leg can be chosen. */
  private statuses = new Map<string, string>();
  private flushTimer?: NodeJS.Timeout;
  private destroyed = false;
  private malformed = 0;

  constructor(
    private readonly subscriber: RealtimeSubscriberService,
    private readonly gateway: CustomerGateway,
    private readonly assignments: AssignmentCacheService,
    private readonly eta: EtaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.REALTIME_ENABLED) {
      // §19.2: TowGo polls `GET /bookings/:id/tracking` every ten seconds and
      // that route carries the same facts, so refusing to relay costs the
      // customer freshness rather than information.
      this.logger.warn('REALTIME_ENABLED=false — customer tracking relay not installed');
      return;
    }

    await this.subscriber.subscribe(DRIVER_LOCATION_CHANNEL, (payload) => {
      void this.onDriverPing(payload);
    });

    // unref: a stray interval must never be why a test worker or a draining ECS
    // task refuses to exit. Phase 5 note 7, the hard way.
    this.flushTimer = setInterval(() => this.flush(), this.env.REALTIME_FLUSH_MS);
    this.flushTimer.unref();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.pending.clear();
    this.statuses.clear();
  }

  private async onDriverPing(raw: unknown): Promise<void> {
    // `JSON.parse` is `any`, and the wire is the one place a shape change is
    // silent instead of a type error. Counted, never thrown — a malformed
    // payload must not take down the subscriber for every other consumer.
    const parsed = driverLocationEventSchema.safeParse(raw);
    if (!parsed.success) {
      this.malformed += 1;
      if (this.malformed % 100 === 1) {
        this.logger.warn(`dropped ${this.malformed} malformed driver location payloads`);
      }
      return;
    }

    const ping = parsed.data;

    try {
      const assignment = await this.assignments.forDriver(ping.driverId);
      if (!assignment) return;

      // Gate 2. The cheapest possible check, and the one that makes this scale:
      // with N tasks, N-1 of them do nothing for any given booking.
      if (this.gateway.localRoomSize(assignment.bookingId) === 0) return;

      this.accept(assignment.bookingId, assignment.status, ping);
    } catch (error) {
      this.logger.warn(`tracking relay failed for driver ${ping.driverId}: ${String(error)}`);
    }
  }

  private accept(bookingId: string, status: string, ping: DriverLocationEvent): void {
    const existing = this.pending.get(bookingId);
    // §11.3's out-of-order rule, applied at the fan-out as well as at ingest. A
    // delayed packet arriving after a newer one drags the marker backwards,
    // which reads to a customer as the driver turning around and leaving.
    if (existing && Date.parse(existing.at) > Date.parse(ping.at)) return;

    this.pending.set(bookingId, {
      bookingId,
      lat: ping.lat,
      lng: ping.lng,
      headingDeg: ping.headingDeg,
      speedKph: ping.speedKph,
      lowAccuracy: ping.lowAccuracy,
      // The PING's timestamp, never the flush's. §11.6's staleness thresholds
      // are ages measured from this value, so stamping it here would make a
      // driver whose phone died look live for as long as we kept re-sending.
      at: ping.at,
    });
    this.statuses.set(bookingId, status);
  }

  private flush(): void {
    if (this.destroyed || this.pending.size === 0) return;

    const batch = [...this.pending.entries()];
    const statuses = new Map(this.statuses);
    this.pending.clear();
    this.statuses.clear();

    for (const [bookingId, frame] of batch) {
      try {
        this.gateway.emitLocationUpdate(frame);
      } catch (error) {
        // Never rethrow from a setInterval callback (Phase 5 note 7) — an
        // unhandled rejection here surfaces in an unrelated spec.
        this.logger.warn(`emitting position for ${bookingId} failed: ${String(error)}`);
      }

      // §11.5's triggers are evaluated against the freshest fix, after the
      // marker has already been sent. The position is what the customer is
      // watching; the ETA is a slower, derived number and must never delay it.
      void this.eta
        .onPosition(bookingId, { lat: frame.lat, lng: frame.lng }, statuses.get(bookingId) ?? '')
        .catch(() => undefined);
    }
  }
}

