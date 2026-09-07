import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ETA_RECOMPUTE,
  type EtaUpdateEvent,
  type GeoPoint,
} from '@towing/api-contracts';
import type { Redis } from 'ioredis';
import { DIRECTIONS, type DirectionsPort, type RouteSource } from '../../common/routing/directions.port';
import { decodePolyline } from '@towing/api-contracts';
import { ENV, type Env } from '../../config/env';
import { REDIS } from '../../redis/redis.constants';
import { CustomerGateway } from '../bookings/customer.gateway';
import { haversineMeters } from '../pricing/pricing.math';
import {
  distanceToPolylineMeters,
  remainingRouteMeters,
  secondsForMeters,
  smoothEta,
} from './eta.math';
import { TrackingRepo, type TrackingBookingRow } from './tracking.repo';

/**
 * §11.5's ETA engine.
 *
 * ONE DIRECTIONS CALL PER BOOKING, AT ASSIGNMENT, AND THAT IS THE DESIGN
 * DECISION EVERYTHING ELSE HERE FOLLOWS FROM.
 *
 * §11.5 read literally asks for a Directions request at assignment and a
 * recompute "every 60s · driver deviates > 200 m · driver stationary > 90s ·
 * status transition". Implemented literally that is roughly one billable call
 * per active booking per minute — 500 concurrent bookings is 30,000 calls an
 * hour — against a Google account with **no hard spend cap**, because both cap
 * routes were checked and both are closed for Maps (SETUP-CHECKLIST item 7).
 * That is not a risk worth carrying for a number the customer reads to the
 * nearest minute.
 *
 * So the engine asks Google ONCE, with the pickup as a waypoint, and gets both
 * legs with their polylines and traffic-aware durations. Every recompute after
 * that walks the stored polyline from the driver's live position and converts
 * the remaining metres at the pace THAT ROUTE implied — see `secondsForMeters`.
 * All four of §11.5's triggers are honoured; none of them re-bills.
 *
 * WHAT IS ACTUALLY LOST BY NOT RE-ASKING: traffic that changes mid-trip. A jam
 * that forms after assignment will not be seen. What is kept: the route's own
 * traffic-aware pace at the time it was requested, which is the dominant term,
 * and the driver's real progress along it, which is the other one. A tow is
 * typically ten to twenty minutes; the error this leaves is materially smaller
 * than the ±40 % smoothing §11.5 already imposes.
 *
 * THE STATE IS IN REDIS, NOT IN A FIELD. Recomputes fire from the location relay,
 * which runs on whichever task holds the driver's socket — not necessarily the
 * one that ran the last recompute, and not necessarily the same one twice. An
 * in-process "last recomputed at" would mean N tasks each recomputing every
 * 60 s, and a stationary-detection window that resets whenever a driver's socket
 * moves. The keys are short-lived and expire with the trip.
 */

/** Per-booking recompute state, small enough to live in one Redis hash. */
interface EtaState {
  /** When we last recomputed, ms epoch. The 60 s trigger. */
  lastAt: number;
  /** Where the driver was then. The stationary trigger measures against it. */
  lastLat: number;
  lastLng: number;
  /** When the driver last actually moved. The 90 s stationary trigger. */
  movedAt: number;
  /** The leg the stored ETA describes, so a leg change can bypass smoothing. */
  leg: 'pickup' | 'drop';
}

/** A driver is "stationary" below this. Roughly a walking pace of GPS jitter. */
const STATIONARY_METERS = 25;

@Injectable()
export class EtaService {
  private readonly logger = new Logger(EtaService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DIRECTIONS) private readonly directions: DirectionsPort,
    private readonly repo: TrackingRepo,
    private readonly gateway: CustomerGateway,
  ) {}

  private static key(bookingId: string): string {
    return `eta:${bookingId}`;
  }

  /**
   * The one Directions call. Invoked from `OfferService.afterAssign`, AFTER the
   * assignment has committed.
   *
   * AFTER, not inside, and never awaited by the accept response. A Directions
   * timeout must not roll back a driver's assignment, and a driver who tapped
   * Accept must not wait four seconds for a map line. Failures are logged and
   * swallowed: the trip runs perfectly well with a null polyline and a straight
   * -line ETA, which is exactly what the router falls back to anyway.
   */
  async planRoute(bookingId: string, driverPosition: GeoPoint | null): Promise<void> {
    try {
      const booking = await this.repo.booking(bookingId);
      if (!booking) return;

      const from = driverPosition ?? (await this.driverPosition(booking));
      if (!from) {
        // No fix for the driver at all. Nothing honest to route from, and a
        // route drawn from the pickup to the pickup is worse than no route.
        return;
      }

      const pickup: GeoPoint = { lat: booking.pickupLat, lng: booking.pickupLng };
      const drop: GeoPoint | null =
        booking.dropLat !== null && booking.dropLng !== null
          ? { lat: booking.dropLat, lng: booking.dropLng }
          : null;

      // The waypoint form when there is a drop: one call, two legs. Without a
      // drop (roadside assistance, a jump start) it is a single leg to the
      // pickup and there is no second polyline to store.
      const route = drop
        ? await this.directions.route(from, pickup, drop)
        : await this.directions.route(from, null, pickup);

      const pickupLeg = route.legs[0];
      const dropLeg = drop ? route.legs[1] : undefined;

      await this.repo.saveRoute(bookingId, {
        polyline: pickupLeg?.polyline ?? null,
        dropPolyline: dropLeg?.polyline ?? null,
        source: route.source,
        etaSeconds: pickupLeg?.durationSeconds ?? null,
      });

      await this.resetState(bookingId, from, 'pickup');

      if (pickupLeg) {
        this.emit(bookingId, pickupLeg.durationSeconds, 'pickup', route.source);
      }
    } catch (error) {
      // The router already degraded to Haversine before this could throw, so
      // reaching here means something structural — a missing booking, a dead
      // Redis. The trip is unaffected.
      this.logger.warn(`route planning failed for ${bookingId}: ${String(error)}`);
    }
  }

  /**
   * Called on every relayed position. Decides whether §11.5 wants a recompute
   * and does it if so.
   *
   * CHEAP BY DEFAULT. This runs at the on-job cadence — every 3 s per active
   * booking — so the common path is one Redis `HGETALL` and four comparisons. No
   * database read happens unless a trigger has actually fired.
   */
  async onPosition(
    bookingId: string,
    position: GeoPoint,
    status: string,
  ): Promise<void> {
    try {
      const state = await this.readState(bookingId);
      const now = Date.now();
      const leg: 'pickup' | 'drop' = status === 'in_progress' ? 'drop' : 'pickup';

      if (!state) {
        // First fix we have seen for this booking on any task — seed the window
        // and recompute, so a customer joining mid-trip is not waiting a minute
        // for a first number.
        await this.recompute(bookingId, position, leg, null);
        return;
      }

      const movedMeters = haversineMeters(position, { lat: state.lastLat, lng: state.lastLng });
      const movedAt = movedMeters > STATIONARY_METERS ? now : state.movedAt;

      const legChanged = state.leg !== leg;
      const dueByTime = now - state.lastAt >= ETA_RECOMPUTE.intervalMs;
      const stationary = now - movedAt >= ETA_RECOMPUTE.stationaryMs;

      if (!legChanged && !dueByTime && !stationary) {
        // Not due. The one remaining trigger — deviation from the polyline —
        // needs the route, so it is checked only when the cheap ones have all
        // said no AND the driver has actually travelled since the last check.
        // Checking it every 3 s would mean decoding a polyline per ping.
        if (movedMeters <= STATIONARY_METERS) {
          await this.touchState(bookingId, position, movedAt, leg);
          return;
        }

        const deviating = await this.isDeviating(bookingId, position, leg);
        if (!deviating) {
          await this.touchState(bookingId, position, movedAt, leg);
          return;
        }
      }

      // A leg change means the previous value described a different journey, so
      // §11.5's "unless a route change explains it" applies and smoothing is
      // bypassed by passing a null previous.
      await this.recompute(bookingId, position, leg, legChanged ? null : undefined);
    } catch (error) {
      this.logger.warn(`ETA update failed for ${bookingId}: ${String(error)}`);
    }
  }

  /**
   * §11.5's "status transition" trigger, called by the job machine.
   *
   * Separate from `onPosition` because a status change must move the number
   * immediately — a customer who has just been told the driver arrived should
   * not watch a four-minute ETA for another 57 seconds.
   */
  async onStatusChange(bookingId: string, status: string): Promise<void> {
    const booking = await this.repo.booking(bookingId).catch(() => undefined);
    if (!booking?.driverId) return;

    const fix = await this.driverPosition(booking);
    if (!fix) return;

    const leg: 'pickup' | 'drop' = status === 'in_progress' ? 'drop' : 'pickup';
    await this.recompute(bookingId, fix, leg, null).catch((error: unknown) => {
      this.logger.warn(`ETA status recompute failed for ${bookingId}: ${String(error)}`);
    });
  }

  /** The trip is over. Nothing left to estimate, and the keys should not linger. */
  async forget(bookingId: string): Promise<void> {
    try {
      await this.redis.del(EtaService.key(bookingId));
    } catch {
      /* the TTL will get it */
    }
  }

  // -------------------------------------------------------------------------

  private async recompute(
    bookingId: string,
    position: GeoPoint,
    leg: 'pickup' | 'drop',
    previousOverride: number | null | undefined,
  ): Promise<void> {
    const booking = await this.repo.booking(bookingId);
    if (!booking) return;

    const destination = this.destinationFor(booking, leg);
    if (!destination) return;

    const encoded = leg === 'drop' ? booking.routeDropPolyline : booking.routePolyline;
    const path = encoded ? decodePolyline(encoded) : [];

    const remaining = remainingRouteMeters(position, destination, path);
    const legMeters = path.length >= 2 ? routeLengthMeters(path) : null;
    const raw = secondsForMeters(
      remaining,
      legMeters,
      // The stored ETA at plan time WAS this leg's Directions duration, so it is
      // the pace anchor. Only usable for the leg it was measured on.
      leg === 'pickup' ? booking.etaSeconds : null,
      this.env.FALLBACK_SPEED_KPH,
    );

    const previous =
      previousOverride === undefined ? booking.etaSeconds : previousOverride;
    const smoothed = smoothEta(previous, raw);

    await this.repo.saveEta(bookingId, smoothed, new Date());
    await this.resetState(bookingId, position, leg);

    this.emit(bookingId, smoothed, leg, (booking.routeSource as RouteSource) ?? 'haversine');
  }

  private destinationFor(booking: TrackingBookingRow, leg: 'pickup' | 'drop'): GeoPoint | null {
    if (leg === 'drop') {
      return booking.dropLat !== null && booking.dropLng !== null
        ? { lat: booking.dropLat, lng: booking.dropLng }
        : null;
    }
    return { lat: booking.pickupLat, lng: booking.pickupLng };
  }

  private async isDeviating(
    bookingId: string,
    position: GeoPoint,
    leg: 'pickup' | 'drop',
  ): Promise<boolean> {
    const booking = await this.repo.booking(bookingId);
    const encoded = leg === 'drop' ? booking?.routeDropPolyline : booking?.routePolyline;
    if (!encoded) return false;

    const path = decodePolyline(encoded);
    if (path.length < 2) return false;

    return distanceToPolylineMeters(position, path) > ETA_RECOMPUTE.deviationMeters;
  }

  private emit(
    bookingId: string,
    etaSeconds: number,
    leg: 'pickup' | 'drop',
    source: RouteSource,
  ): void {
    const payload: EtaUpdateEvent = {
      bookingId,
      etaSeconds,
      leg,
      source,
      at: new Date().toISOString(),
    };
    this.gateway.emitEtaUpdate(payload);
  }

  private async driverPosition(booking: TrackingBookingRow): Promise<GeoPoint | null> {
    if (!booking.driverId) return null;
    const fix = await this.repo.driverFix(booking.driverId);
    return fix ? { lat: fix.lat, lng: fix.lng } : null;
  }

  private async readState(bookingId: string): Promise<EtaState | null> {
    try {
      const raw = await this.redis.hgetall(EtaService.key(bookingId));
      if (!raw || Object.keys(raw).length === 0) return null;
      return {
        lastAt: Number(raw.lastAt),
        lastLat: Number(raw.lastLat),
        lastLng: Number(raw.lastLng),
        movedAt: Number(raw.movedAt),
        leg: raw.leg === 'drop' ? 'drop' : 'pickup',
      };
    } catch {
      // Redis down means every ping looks like the first one, which recomputes
      // more often than needed and costs nothing external — the recompute is
      // local arithmetic. Degrading loudly here would take out tracking.
      return null;
    }
  }

  private async resetState(
    bookingId: string,
    position: GeoPoint,
    leg: 'pickup' | 'drop',
  ): Promise<void> {
    const now = Date.now();
    await this.writeState(bookingId, {
      lastAt: now,
      lastLat: position.lat,
      lastLng: position.lng,
      movedAt: now,
      leg,
    });
  }

  private async touchState(
    bookingId: string,
    position: GeoPoint,
    movedAt: number,
    leg: 'pickup' | 'drop',
  ): Promise<void> {
    const state = await this.readState(bookingId);
    await this.writeState(bookingId, {
      // `lastAt` is NOT bumped — it is the recompute clock, and touching it here
      // would mean the 60-second trigger never fires on a moving driver.
      lastAt: state?.lastAt ?? Date.now(),
      lastLat: position.lat,
      lastLng: position.lng,
      movedAt,
      leg,
    });
  }

  private async writeState(bookingId: string, state: EtaState): Promise<void> {
    try {
      const key = EtaService.key(bookingId);
      await this.redis.hset(key, {
        lastAt: String(state.lastAt),
        lastLat: String(state.lastLat),
        lastLng: String(state.lastLng),
        movedAt: String(state.movedAt),
        leg: state.leg,
      });
      // Longer than any trip and shorter than forever. `forget()` is the normal
      // end; this is what covers a booking that ends in a way nobody expected.
      await this.redis.expire(key, 6 * 60 * 60);
    } catch {
      /* see readState — a missing window costs a recompute, not correctness */
    }
  }
}

function routeLengthMeters(path: readonly GeoPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) total += haversineMeters(path[i]!, path[i + 1]!);
  return total;
}
