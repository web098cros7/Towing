import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  SUBJECT_NOTIFICATION_PREF_DEFAULTS,
  type SubjectNotificationPrefs,
} from '@towing/api-contracts';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';
import { devices } from '../../db/schema/devices';
import { drivers } from '../../db/schema/drivers';
import { fleets } from '../../db/schema/fleets';
import { users } from '../../db/schema/users';
import type { Recipient } from './registry/trigger.types';

/**
 * THE ONLY THING IN THE SYSTEM THAT TURNS A SUBJECT ID INTO AN ADDRESS.
 *
 * That is the fix for the class of bug this phase inherited: before Phase 13,
 * `compliance.service.ts` passed a fleet id and `payouts.service.ts` an owner
 * id straight into `NotifyParams.to`, a field documented as "E.164 phone or
 * email address". Against `LogNotificationAdapter` that printed a UUID and
 * nobody noticed; against a real provider it is a 400 on every send, or worse a
 * silent accept. Producers now emit domain ids and never see an address at all
 * (invariant 69).
 *
 * Resolution happens at FAN-OUT time, not emit time, so a phone number changed
 * between the two yields the current one. It is also why a replayed event is
 * safe: the addresses are re-derived, never carried in the payload.
 */
@Injectable()
export class RecipientResolverService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The same lookups, run on `executor` instead of the pool.
   *
   * `NotificationService.emit` resolves recipients INSIDE the transaction that
   * writes the event. Querying the pool from in there holds one connection and
   * waits for a second, and a burst of emits as large as the pool deadlocked
   * it for good (found by `bench:payments`, 24 Sep). Passing the transaction
   * makes an emit need exactly one connection, whatever the load.
   */
  within(executor: DatabaseExecutor): RecipientResolverService {
    return new RecipientResolverService(executor as unknown as Database);
  }

  async resolveUser(userId: string): Promise<Recipient | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        mobile: users.mobile,
        email: users.email,
        prefs: users.notificationPrefs,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) return null;
    return {
      subjectType: 'user',
      subjectId: row.id,
      mobile: row.mobile,
      email: row.email,
      pushTokens: await this.pushTokensFor('user', row.id),
      prefs: mergePrefs(row.prefs),
    };
  }

  async resolveDriver(driverId: string): Promise<Recipient | null> {
    const [row] = await this.db
      .select({
        id: drivers.id,
        mobile: drivers.mobile,
        email: drivers.email,
        prefs: drivers.notificationPrefs,
      })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!row) return null;
    return {
      subjectType: 'driver',
      subjectId: row.id,
      mobile: row.mobile,
      email: row.email,
      pushTokens: await this.pushTokensFor('driver', row.id),
      prefs: mergePrefs(row.prefs),
    };
  }

  /**
   * A fleet's contact details are its OWNER's — `fleets` has no phone or email
   * column of its own, and the owner is a `users` row (`fleets.owner_id`).
   *
   * The recipient identity stays `fleet:<fleetId>` rather than
   * `user:<ownerId>`, because the §12.2 row is addressed to the business: the
   * console's own preference column is `fleets.notification_prefs`, and a
   * compliance alert must not be suppressible by whatever the owner set on
   * their personal customer account.
   *
   * Push tokens are deliberately EMPTY. A fleet owner's surface is the web
   * console, whose §12.1 "Web" channel has been satisfied since Phase 6 by the
   * `/alerts` page; there is no fleet mobile app to register a device from.
   */
  async resolveFleet(fleetId: string): Promise<Recipient | null> {
    const [row] = await this.db
      .select({
        id: fleets.id,
        prefs: fleets.notificationPrefs,
        ownerMobile: users.mobile,
        ownerEmail: users.email,
      })
      .from(fleets)
      .innerJoin(users, eq(users.id, fleets.ownerId))
      .where(eq(fleets.id, fleetId))
      .limit(1);

    if (!row) return null;
    return {
      subjectType: 'fleet',
      subjectId: row.id,
      mobile: row.ownerMobile,
      email: row.ownerEmail,
      pushTokens: [],
      // The fleet's own console toggles — `compliance`, `payouts`, `jobs`,
      // `weekly` — not the per-subject shape. `PreferenceService` branches on
      // `subjectType` for exactly this reason, so the switch a fleet owner can
      // already see and flip in the console is the one that is consulted.
      prefs: (row.prefs ?? {}) as Record<string, boolean>,
    };
  }

  /**
   * A single "who do I tell" for the polymorphic `wallet_owner_type`, whose
   * enum is `('user','driver','fleet')` — THREE values, not two. A payout's
   * `ownerType` flows straight from that column, and narrowing it to two here
   * is how a customer-wallet payout silently notifies nobody.
   */
  async resolveWalletOwner(
    ownerType: 'user' | 'driver' | 'fleet',
    ownerId: string,
  ): Promise<Recipient | null> {
    switch (ownerType) {
      case 'user':
        return this.resolveUser(ownerId);
      case 'driver':
        return this.resolveDriver(ownerId);
      case 'fleet':
        return this.resolveFleet(ownerId);
    }
  }

  /**
   * Every live device for a subject — the reason fan-out writes one delivery
   * row per device rather than one per recipient. A revoked row is never a
   * target, and a row whose owner denied the OS permission has a null token.
   */
  private async pushTokensFor(
    subjectType: 'user' | 'driver',
    subjectId: string,
  ): Promise<Array<{ deviceId: string; token: string }>> {
    const rows = await this.db
      .select({ id: devices.id, token: devices.pushToken })
      .from(devices)
      .where(
        and(
          eq(devices.subjectType, subjectType),
          eq(devices.subjectId, subjectId),
          isNull(devices.revokedAt),
        ),
      );

    return rows
      .filter((row): row is { id: string; token: string } => Boolean(row.token))
      .map((row) => ({ deviceId: row.id, token: row.token }));
  }

  /** Batch variant for a fan-out that reaches many subjects of the same type. */
  async resolveManyDrivers(driverIds: string[]): Promise<Recipient[]> {
    if (driverIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: drivers.id,
        mobile: drivers.mobile,
        email: drivers.email,
        prefs: drivers.notificationPrefs,
      })
      .from(drivers)
      .where(inArray(drivers.id, driverIds));

    return Promise.all(
      rows.map(async (row) => ({
        subjectType: 'driver' as const,
        subjectId: row.id,
        mobile: row.mobile,
        email: row.email,
        pushTokens: await this.pushTokensFor('driver', row.id),
        prefs: mergePrefs(row.prefs),
      })),
    );
  }
}

/**
 * Defaults merged on read, exactly as `settings.service.ts` already does for
 * fleets — so a subject who has never touched their preferences reads the
 * product default, and a key added in a later phase defaults correctly for
 * every existing row without a backfill.
 */
function mergePrefs(stored: Partial<SubjectNotificationPrefs> | null): Record<string, boolean> {
  return { ...SUBJECT_NOTIFICATION_PREF_DEFAULTS, ...(stored ?? {}) };
}
