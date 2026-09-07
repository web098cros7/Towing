import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  type BookingShareResponse,
  type BookingTracking,
  type CallContact,
  type PublicTrack,
} from '@towing/api-contracts';
import { randomBytes } from 'node:crypto';
import { ApiException } from '../../common/errors/api-exception';
import { TELEPHONY, type TelephonyPort } from '../../common/telephony/telephony.port';
import { ENV, type Env } from '../../config/env';
import { PresenceStore } from '../driver-presence/presence-store';
import { isShareLive, toBookingTracking, toPublicTrack } from './tracking.mapper';
import { TrackingRepo, type DriverFixRow, type TrackingBookingRow } from './tracking.repo';

/**
 * §9.1.7's tracking surface and §11.7's share link.
 *
 * Reads only — every write that moves a booking goes through
 * `JobExecutionService` and the state machine. The two exceptions are the share
 * token, which is not booking state in any §5.1 sense, and the ETA, which
 * `EtaService` owns.
 */
@Injectable()
export class TrackingService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(TELEPHONY) private readonly telephony: TelephonyPort,
    private readonly repo: TrackingRepo,
    private readonly presence: PresenceStore,
  ) {}

  /** §19.2's polling rung. Same facts the socket pushes, by construction. */
  async tracking(bookingId: string, userId: string): Promise<BookingTracking> {
    const row = await this.owned(bookingId, userId);
    const fix = row.driverId ? await this.freshestFix(row.driverId) : undefined;
    return toBookingTracking(row, fix, new Date());
  }

  /**
   * The driver's position, Redis first and Postgres second.
   *
   * WHY BOTH, AND WHY THIS ORDER — found by running `bench:tracking`, which
   * reported `carried a fix: no` on a trip whose driver had been pinging for
   * eight seconds.
   *
   * `drivers.current_location` is written by `LocationFlushService` on a ~30 s
   * coalescing cadence, which is exactly right for its own purposes (analytics,
   * recovery, the §6.1 authoritative store) and useless as the sole source here:
   * a customer whose socket is down — the entire case this route exists for —
   * would see NO driver at all for the first half-minute of their trip, and then
   * a position up to thirty seconds stale for the rest of it. The one moment
   * §19.2's fallback matters most is the moment it had nothing to say.
   *
   * The Redis hash is the hot fix, refreshed every ping, and `PresenceStore`
   * already exposes it for `EtaService`. Postgres remains the fallback for the
   * case Redis cannot answer — an evicted or expired hash — which is precisely
   * the split `GET /v1/fleet/realtime/positions` has used since Phase 5:
   * Postgres is authoritative for WHICH entities exist, Redis only makes them
   * fresher.
   */
  private async freshestFix(driverId: string): Promise<DriverFixRow | undefined> {
    const hot = await this.presence.lastFix(driverId).catch(() => null);
    if (hot) {
      return {
        lat: hot.lat,
        lng: hot.lng,
        // The PING's own timestamp, so §11.6's staleness thresholds measure the
        // age of the fix rather than the age of this request.
        lastPingAt: hot.at ? new Date(hot.at) : null,
      };
    }

    return this.repo.driverFix(driverId);
  }

  /**
   * §11.7 — mint a share link, or return the live one.
   *
   * IDEMPOTENT BY DESIGN, WITHOUT AN IDEMPOTENCY KEY. Tapping "Share trip" twice
   * must not invalidate the link that was sent thirty seconds ago to somebody
   * who is now watching it: rotating on every call would mean the second tap
   * silently kills the first recipient's page. So a live token is returned as-is
   * and only an absent or expired one mints.
   *
   * 128 BITS, per §11.7. `randomBytes(16)` base64url is 22 characters — short
   * enough to survive being pasted into a message and long enough that guessing
   * is not a strategy. The partial unique index (`uq_bookings_share_token`,
   * migration 0012) is the collision backstop; at 2^128 it will never fire, and
   * it is there because "will never" is not "cannot".
   */
  async share(bookingId: string, userId: string): Promise<BookingShareResponse> {
    const row = await this.owned(bookingId, userId);

    if (row.status === 'searching') {
      // Nothing to watch: no driver, no position, no route. A link that shows an
      // empty map is worse than a button that says "not yet".
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'A trip can be shared once a driver is assigned',
      );
    }

    const now = new Date();
    if (row.shareToken && isShareLive(row, now)) {
      return this.shareResponse(row.shareToken, row.shareExpiresAt);
    }

    const token = randomBytes(16).toString('base64url');
    // No expiry while the trip runs; the finalizer stamps completion + grace.
    await this.repo.setShareToken(bookingId, token, null);
    return this.shareResponse(token, null);
  }

  /** §11.7's "revocable from the tracking screen". */
  async revokeShare(bookingId: string, userId: string): Promise<void> {
    await this.owned(bookingId, userId);
    // Nulled rather than expired-in-place: it frees the unique index slot, and a
    // revoked link should read as gone, not as a tombstone somebody could
    // reason about.
    await this.repo.setShareToken(bookingId, null, null);
  }

  /**
   * §11.7's public page. NO AUTHENTICATION — the token is the credential.
   *
   * Three refusals, and the last is the interesting one:
   *   · unknown token → 404, because it is genuinely not a thing
   *   · expired token → `SHARE_LINK_EXPIRED`, NOT a 404. Somebody was sent this
   *     link because a person they care about was in trouble; "no such trip"
   *     invites them to think they mistyped it, and "this trip has ended" is
   *     both true and the answer they actually need.
   */
  async publicTrack(shareToken: string): Promise<PublicTrack> {
    const row = await this.repo.bookingByShareToken(shareToken);
    if (!row) throw ApiException.notFound('Trip not found');

    const now = new Date();
    if (!isShareLive(row, now)) {
      throw new ApiException(
        HttpStatus.GONE,
        ErrorCodes.SHARE_LINK_EXPIRED,
        'This trip link has ended',
      );
    }

    // Same freshness as the customer's own poll — it is the same underlying
    // question, and the ~100 m coarsening in `toPublicTrack` is what makes the
    // answer safe to publish, not the staleness.
    const fix = row.driverId ? await this.freshestFix(row.driverId) : undefined;
    return toPublicTrack(row, fix, now);
  }

  /** §9.1.7's call button, customer side. */
  async customerContact(bookingId: string, userId: string): Promise<CallContact> {
    const row = await this.owned(bookingId, userId);
    if (!row.driverId) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'No driver is assigned to this booking yet',
      );
    }

    const call = await this.telephony.maskedNumber({
      bookingId,
      from: 'customer',
      customerMobile: null,
      driverMobile: row.driverMobile,
    });

    return {
      dialNumber: call.dialNumber,
      masked: call.masked,
      party: 'driver',
      displayName: row.driverName,
      reference: call.reference,
    };
  }

  private shareResponse(token: string, expiresAt: Date | null): BookingShareResponse {
    return {
      token,
      // Composed here, not in the app. Two clients building this string would
      // eventually build it differently, and moving the page must not need a
      // mobile release — the same argument `wsUrl` won on the ticket response.
      url: `${this.env.PUBLIC_TRACK_BASE_URL.replace(/\/$/, '')}/t/${token}`,
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Ownership, checked the same way `BookingsService` checks it.
   *
   * A 404 rather than a 403 for someone else's booking: confirming that an id
   * exists is itself information, and there is no legitimate caller who needs to
   * tell "not yours" from "not there".
   */
  private async owned(bookingId: string, userId: string): Promise<TrackingBookingRow> {
    const row = await this.repo.booking(bookingId);
    if (!row || row.userId !== userId) throw ApiException.notFound('Booking not found');
    return row;
  }
}
