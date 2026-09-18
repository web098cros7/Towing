import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCodes,
  LOW_ACCURACY_METERS,
  PING_CADENCE,
  type DriverConfigUpdateEvent,
  type DriverGoOnline,
  type DriverPresenceResponse,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';
import { ZoneResolverService } from '../pricing/zone-resolver.service';
import { DriverPresenceRepo } from './driver-presence.repo';
import { LocationFlushService } from './location-flush.service';
import { PresenceStore } from './presence-store';

/**
 * §3.1 layer 3 — going online, and everything that has to be true for it.
 *
 * The gate itself is `KycApprovedGuard` on the route (claim + a fresh DB read).
 * What lives here is the rest of the contract: a driver is only in the candidate
 * store if a zone could be resolved for them, and they leave it the moment they
 * go offline.
 */
@Injectable()
export class DriverPresenceService {
  private readonly logger = new Logger(DriverPresenceService.name);

  constructor(
    private readonly store: PresenceStore,
    private readonly repo: DriverPresenceRepo,
    private readonly zones: ZoneResolverService,
    private readonly config: DispatchConfigRepo,
    private readonly flush: LocationFlushService,
  ) {}

  /**
   * §6.1's candidate store is partitioned by ZONE, so a driver with no zone is
   * in no partition — online in their own UI and invisible to every search. That
   * failure is silent and unfalsifiable from the handset, which is why a fix
   * outside every active polygon is refused here with its own error code rather
   * than accepted optimistically.
   */
  async goOnline(driverId: string, body: DriverGoOnline): Promise<DriverPresenceResponse> {
    const zone = await this.zones.resolve(body.at);
    if (!zone) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCodes.DRIVER_OUTSIDE_ZONE,
        'You are outside every service area we operate in',
      );
    }

    const row = await this.repo.identity(driverId);
    if (!row) throw ApiException.notFound('Driver not found');

    // A14: a shelved suspension blocks going (back) online — evicting a driver
    // from presence while the toggle still works would just re-admit them on
    // the next tap, with the shelf still waiting.
    if (row.suspensionPending) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCodes.ACCOUNT_NOT_ACTIVE,
        'Your account is suspended pending review. Please contact support.',
      );
    }

    // A15: same for a suspended fleet — its drivers cannot go online however
    // approved they are themselves. Independents (null fleet) pass.
    if (row.fleetStatus === 'suspended') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCodes.ACCOUNT_NOT_ACTIVE,
        'Your fleet is suspended. Please contact your fleet owner or support.',
      );
    }

    // Postgres first, then Redis. If the process dies between them the driver is
    // flagged online with no GEO membership, which the very next ping repairs
    // through `LocationIngestService.rehydrate`. The other order leaves a member
    // in a live GEO set with no authoritative row to reconcile it against —
    // phantom supply that only the hash TTL eventually clears.
    await this.repo.goOnline(driverId, zone.id, body.at);
    await this.store.putIdentity(driverId, {
      zoneId: zone.id,
      fleetId: row.fleetId,
      truckId: row.truckId,
      vehicleClass: row.vehicleClass,
      longDistance: row.longDistance,
    });

    return this.presence({
      isOnline: true,
      zoneId: zone.id,
      zoneName: zone.name,
      // The handset restarts its sequence at go-online and so does the server:
      // `putIdentity` writes no `seq`, and a hash with no `seq` accepts the
      // first ping whatever number it carries.
      seq: 0,
      onJob: false,
    });
  }

  async goOffline(driverId: string): Promise<DriverPresenceResponse> {
    // §11.2's "final positions are persisted": up to a whole flush window of the
    // shift's last movement lives only in the in-memory buffer.
    await this.flush.flushDriver(driverId);

    const zoneId =
      (await this.store.zoneOf(driverId)) ?? (await this.repo.identity(driverId))?.zoneId ?? null;

    // Redis first here — the mirror image of go-online, and for the same reason.
    // Evicting before the row is updated means a crash in between leaves a
    // driver marked online who is in no GEO set: invisible to dispatch, which is
    // the safe direction. The reverse would leave them dispatchable after they
    // asked to stop.
    await this.store.evict(driverId, zoneId);
    await this.repo.goOffline(driverId);

    return this.presence({ isOnline: false, zoneId: null, zoneName: null, seq: 0, onJob: false });
  }

  /**
   * Evicts a driver whose authority was revoked — an admin suspension or a KYC
   * reversal. Called by the admin decision path, so a suspended driver stops
   * being dispatchable immediately rather than at their next ping.
   */
  async evictRevoked(driverId: string): Promise<void> {
    try {
      const zoneId = await this.store.zoneOf(driverId);
      await this.store.evict(driverId, zoneId);
      await this.repo.goOffline(driverId);
    } catch (err) {
      // The ping path re-checks approval on rehydrate and the hash expires in
      // 30s regardless, so a failure here delays the eviction rather than
      // defeating it — and must never fail the admin's decision.
      this.logger.warn(
        `failed to evict revoked driver ${driverId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * The `config:update` payload. Built HERE and not in the gateway, because the
   * socket frame and the REST response must never be able to disagree about the
   * cadence — a driver whose socket says 3s and whose REST call said 10s runs
   * whichever arrived last.
   */
  async configFor(driverId: string): Promise<DriverConfigUpdateEvent> {
    const [row, config] = await Promise.all([
      this.repo.identity(driverId),
      this.config.load(),
    ]);

    const online = row?.isOnline === true && row.kycStatus === 'approved';
    return {
      // §20.4: nothing is captured at all while offline. `null` says that;
      // a large interval would merely say "rarely", which is a different promise.
      pingIntervalMs: online ? PING_CADENCE.idleMs : PING_CADENCE.offlineMs,
      staleAfterMs: config.stalePingSeconds * 1000,
      lowAccuracyMeters: LOW_ACCURACY_METERS,
      at: new Date().toISOString(),
    };
  }

  private async presence(params: {
    isOnline: boolean;
    zoneId: string | null;
    zoneName: string | null;
    seq: number;
    onJob: boolean;
  }): Promise<DriverPresenceResponse> {
    const config = await this.config.load();
    return {
      isOnline: params.isOnline,
      zoneId: params.zoneId,
      zoneName: params.zoneName,
      pingIntervalMs: params.isOnline
        ? params.onJob
          ? PING_CADENCE.onJobMs
          : PING_CADENCE.idleMs
        : PING_CADENCE.offlineMs,
      // Read from `dispatch_config`, never a local constant: §6.7 makes this an
      // admin knob, and a handset ageing its own marker at a different threshold
      // than the matcher uses to exclude it is a driver who looks live to
      // themselves and is invisible to dispatch.
      staleAfterMs: config.stalePingSeconds * 1000,
      lowAccuracyMeters: LOW_ACCURACY_METERS,
      seq: params.seq,
    };
  }
}
