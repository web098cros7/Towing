import { Inject, Injectable } from '@nestjs/common';
import {
  GLOBAL_DISPATCH_CONFIG_DEFAULTS,
  resolveDispatchConfig,
  type AdminDispatchConfig,
  type AdminDispatchConfigUpdate,
} from '@towing/api-contracts';
import { asc, eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { KillSwitchService } from '../../common/killswitch/killswitch.service';
import { DB, type Database } from '../../db/db.module';
import { dispatchConfig, serviceZones } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { DispatchConfigRepo } from '../bookings/dispatch-config.repo';

/**
 * §16.5's `GET/PUT /v1/admin/dispatch-config` — Phase 17.
 *
 * §6.7 REQUIRES EVERY KNOB HERE TO CHANGE WITH NO DEPLOY, and the engine reads
 * all of them at query time, so an edit lands on the next wave. That is only
 * true because Phase 14 created the `dispatch_config` table and the per-zone
 * JSONB column three phases before anything read them — had the weights been
 * constants when the matcher was written, this route would be a rewrite rather
 * than a form over existing state.
 *
 * EVERY WRITE IS AUDITED, through the same `AdminAuditService` that records KYC
 * decisions and commission changes. These knobs decide which driver gets which
 * job, which is to say who earns what; a change with no attribution is not
 * something anyone should be able to make.
 */
@Injectable()
export class AdminDispatchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
    private readonly config: DispatchConfigRepo,
    private readonly killSwitch: KillSwitchService,
  ) {}

  async get(): Promise<AdminDispatchConfig> {
    const [globalRow] = await this.db.select().from(dispatchConfig).limit(1);
    const zones = await this.db
      .select({
        id: serviceZones.id,
        name: serviceZones.name,
        isActive: serviceZones.isActive,
        dispatchConfig: serviceZones.dispatchConfig,
        serviceTypeless: serviceZones.id,
      })
      .from(serviceZones)
      .orderBy(asc(serviceZones.name));

    const [pausedZoneIds, longDistanceDisabled, forcePolling, sosStandaloneDisabled] =
      await Promise.all([
        this.killSwitch.pausedZoneIds(),
        this.killSwitch.isLongDistanceDisabled(),
        this.killSwitch.isPollingForced(),
        this.killSwitch.isSosStandaloneEnabled().then((enabled) => !enabled),
      ]);

    return {
      global: globalRow
        ? {
            weights: {
              proximity: Number(globalRow.weightProximity),
              rating: Number(globalRow.weightRating),
              acceptance: Number(globalRow.weightAcceptance),
              completion: Number(globalRow.weightCompletion),
            },
            stalePingSeconds: globalRow.stalePingSeconds,
            oneActiveBookingPerCustomer: globalRow.oneActiveBookingPerCustomer,
            blockOnUnpaidBalance: globalRow.blockOnUnpaidBalance,
            // ── W12 ──
            redispatchPriority: globalRow.redispatchPriority as 'front' | 'normal',
            pingOnJobMs: globalRow.pingOnJobMs,
            pingIdleMs: globalRow.pingIdleMs,
            perServiceMaxOffers: (globalRow.perServiceMaxOffers ?? null) as AdminDispatchConfig['global']['perServiceMaxOffers'],
          }
        : // A fresh or half-seeded database reports the documented defaults
          // rather than 500ing. `DispatchConfigRepo` takes the same view, so the
          // form shows exactly what the engine would use.
          { ...GLOBAL_DISPATCH_CONFIG_DEFAULTS, blockOnUnpaidBalance: true },
      zones: zones.map((zone) => ({
        zoneId: zone.id,
        zoneName: zone.name,
        isActive: zone.isActive,
        // The RAW override, so an admin editing a form does not save the code
        // defaults as explicit overrides on first touch — which would silently
        // stop that zone tracking any future change to those defaults.
        override: zone.dispatchConfig ?? null,
        resolved: resolveDispatchConfig(zone.dispatchConfig),
      })),
      killSwitches: {
        pausedZoneIds: [...pausedZoneIds],
        longDistanceDisabled,
        forcePolling,
        sosStandaloneDisabled,
      },
    };
  }

  async update(
    adminId: string,
    body: AdminDispatchConfigUpdate,
    context: SessionContext,
  ): Promise<AdminDispatchConfig> {
    const before = await this.get();

    // Zone ids are validated against the table BEFORE anything is written. A
    // typo'd id in a `zones` array would otherwise update nothing and report
    // success, and the admin would spend a while wondering why their ladder had
    // no effect.
    if (body.zones && body.zones.length > 0) {
      const known = new Set(before.zones.map((zone) => zone.zoneId));
      const unknown = body.zones.filter((zone) => !known.has(zone.zoneId));
      if (unknown.length > 0) {
        throw ApiException.validation('Unknown service zone', {
          zones: unknown.map((zone) => zone.zoneId),
        });
      }
    }

    if (
      body.weights ||
      body.stalePingSeconds !== undefined ||
      body.oneActiveBookingPerCustomer !== undefined ||
      body.blockOnUnpaidBalance !== undefined ||
      body.redispatchPriority !== undefined ||
      body.pingOnJobMs !== undefined ||
      body.pingIdleMs !== undefined ||
      body.perServiceMaxOffers !== undefined
    ) {
      await this.updateGlobal(body);
    }

    for (const zone of body.zones ?? []) {
      await this.db
        .update(serviceZones)
        // `null` CLEARS the override back to the code defaults, which is
        // different from omitting the zone (leave it alone). An admin must be
        // able to undo a bad ladder without knowing what the defaults were.
        .set({ dispatchConfig: zone.override, updatedAt: new Date() })
        .where(eq(serviceZones.id, zone.zoneId));
    }

    if (body.killSwitches) {
      const { pausedZoneIds, longDistanceDisabled, forcePolling, sosStandaloneDisabled } =
        body.killSwitches;
      if (pausedZoneIds) await this.killSwitch.setPausedZones(pausedZoneIds);
      if (longDistanceDisabled !== undefined) {
        await this.killSwitch.setLongDistanceDisabled(longDistanceDisabled);
      }
      if (forcePolling !== undefined) await this.killSwitch.setPollingForced(forcePolling);
      if (sosStandaloneDisabled !== undefined) {
        await this.killSwitch.setSosStandaloneDisabled(sosStandaloneDisabled);
      }
    }

    // §6.7 means "no deploy", not "no deploy but wait for a TTL" — the same
    // rule `PricingConfigRepo.invalidate()` follows for the rate card.
    await this.config.invalidate();

    const after = await this.get();
    await this.audit.record({
      adminId,
      action: 'dispatch_config.update',
      subjectType: 'dispatch_config',
      subjectId: null,
      before,
      after,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return after;
  }

  /**
   * The singleton row, upserted.
   *
   * Phase 14 seeds it, but a database that has never been seeded — a fresh
   * staging environment, most plausibly — would otherwise make this route fail
   * silently: the UPDATE would match nothing and report success.
   */
  private async updateGlobal(body: AdminDispatchConfigUpdate): Promise<void> {
    const [existing] = await this.db.select().from(dispatchConfig).limit(1);

    const values = {
      ...(body.weights
        ? {
            weightProximity: body.weights.proximity.toFixed(2),
            weightRating: body.weights.rating.toFixed(2),
            weightAcceptance: body.weights.acceptance.toFixed(2),
            weightCompletion: body.weights.completion.toFixed(2),
          }
        : {}),
      ...(body.stalePingSeconds !== undefined ? { stalePingSeconds: body.stalePingSeconds } : {}),
      ...(body.oneActiveBookingPerCustomer !== undefined
        ? { oneActiveBookingPerCustomer: body.oneActiveBookingPerCustomer }
        : {}),
      ...(body.blockOnUnpaidBalance !== undefined
        ? { blockOnUnpaidBalance: body.blockOnUnpaidBalance }
        : {}),
      // ── W12. `null` is a VALUE here ("no platform per-service offers"), not an
      // omission, which is why it is checked against `undefined` explicitly.
      ...(body.redispatchPriority !== undefined
        ? { redispatchPriority: body.redispatchPriority }
        : {}),
      ...(body.pingOnJobMs !== undefined ? { pingOnJobMs: body.pingOnJobMs } : {}),
      ...(body.pingIdleMs !== undefined ? { pingIdleMs: body.pingIdleMs } : {}),
      ...(body.perServiceMaxOffers !== undefined
        ? { perServiceMaxOffers: body.perServiceMaxOffers }
        : {}),
      updatedAt: new Date(),
    };

    if (existing) {
      await this.db.update(dispatchConfig).set(values).where(eq(dispatchConfig.id, existing.id));
      return;
    }

    await this.db.insert(dispatchConfig).values(values);
  }
}
