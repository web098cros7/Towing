import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ErasureStepLogEntry } from '@towing/api-contracts';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { keyFromFileUrl } from '../../common/storage/file-url';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import {
  addresses,
  bookingLocationPath,
  bookings,
  deletionRequests,
  devices,
  driverDocumentVersions,
  driverDocuments,
  drivers,
  emergencyContacts,
  erasureJobs,
  loginChallenges,
  otpVerifications,
  payouts,
  ratings,
  savedVehicles,
  socialIdentities,
  sosAlertContacts,
  sosAlerts,
  users,
  type ErasureStepLogEntry as ErasureStepLogEntryRow,
} from '../../db/schema';
import { TokenService } from '../auth/token.service';
import { sweepRetention } from './retention';

/** Statuses in which a booking still needs the person's data to be operable. */
const LIVE_BOOKING_STATUSES = ['searching', 'assigned', 'en_route', 'arrived', 'in_progress'] as const;

/** Money that has not landed yet: erasing the destination now would strand it. */
const OPEN_PAYOUT_STATUSES = ['requested', 'processing'] as const;

export interface ErasureRunResult {
  /** `completed`, `on_hold` (refused), or `failed` — the request's status after the run. */
  status: string;
  steps: ErasureStepLogEntry[];
}

/**
 * W19 — the erasure runner (§20.4 DPDP). Executes ONE approved deletion
 * request and records every step it took.
 *
 * WHAT THIS JOB MAY NOT TOUCH, and why it is the first thing the code says:
 *
 *   · `admin_actions` — the audit trail. An erasure that deletes who decided
 *     what is an audit failure wearing compliance clothing.
 *   · every money table — `wallets`, `wallet_transactions`, `payments`,
 *     `refunds`, `payouts`. Bookings and the ledger FK to the subject because
 *     tax and dispute obligations outlive the account. The acceptance test
 *     snapshots their row counts and fails if this job moved one.
 *
 * WHAT IT DOES NOT WRAP IN A TRANSACTION, deliberately: the steps interleave
 * database writes with storage-object deletes, and holding row locks across
 * network I/O is how a worker deadlocks a busy table. Every step is IDEMPOTENT
 * instead (tombstones are rewritten, DELETEs of already-deleted rows are
 * no-ops, `StoragePort.delete` treats a missing object as success), so a run
 * that dies halfway is completed by the next one — and the `erasure_jobs.steps`
 * log shows exactly how far it got, which a rolled-back transaction would
 * erase along with the evidence.
 *
 * THE HOLD IS A FEATURE. A legally due erasure that cannot run yet (a live
 * booking, an un-settled payout) is parked as `on_hold` WITH A REASON instead
 * of refused: the obligation stays visible, the reason is data, and the admin
 * who filed the hold re-queues it once the job or the payout has settled.
 */
@Injectable()
export class ErasureService implements OnModuleInit {
  private readonly logger = new Logger(ErasureService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly tokens: TokenService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.process('privacy.erasure', async (payload) => {
      await this.execute(payload.requestId);
    });

    this.queue.process('privacy.sweep', async (payload) => {
      await this.sweep(payload.reason);
    });

    await this.queue.schedule('privacy.sweep', { reason: 'cron' }, this.env.PRIVACY_SWEEP_CRON);
  }

  /** The nightly retention pass. Returns what each enforced policy removed. */
  async sweep(reason: 'cron' | 'manual'): Promise<void> {
    const results = await sweepRetention(this.db);
    const summary = results.map((row) => `${row.policyKey}=${row.deleted}`).join(' ');
    this.logger.log(`retention sweep (${reason}): ${summary || 'no enforced policies'}`);
  }

  /**
   * Runs one request. Idempotent end to end: a `completed` request is a no-op
   * (the route can be pressed twice, the queue can redeliver), and a request
   * that was half-done by a crashed run is completed by the next.
   */
  async execute(requestId: string): Promise<ErasureRunResult> {
    const [request] = await this.db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, requestId))
      .limit(1);

    if (!request) throw new Error(`Deletion request ${requestId} not found`);
    if (request.status === 'completed') {
      return { status: 'completed', steps: [] };
    }

    const [job] = await this.db
      .insert(erasureJobs)
      .values({
        requestId,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        status: 'running',
        startedAt: new Date(),
      })
      .returning({ id: erasureJobs.id });

    await this.db
      .update(deletionRequests)
      .set({ status: 'executing', updatedAt: new Date() })
      .where(eq(deletionRequests.id, requestId));

    const subjectType = request.subjectType === 'driver' ? 'driver' : 'user';
    const subjectId = request.subjectId;
    const steps: ErasureStepLogEntry[] = [];

    const record = async (
      step: string,
      outcome: 'done' | 'skipped' | 'refused',
      count: number,
      detail?: string,
    ): Promise<void> => {
      steps.push({ step, outcome, count, detail, at: new Date().toISOString() });
      await this.db
        .update(erasureJobs)
        .set({ steps: steps as ErasureStepLogEntryRow[], updatedAt: new Date() })
        .where(eq(erasureJobs.id, job!.id));
    };

    try {
      // ── 1. Holds, before anything irreversible ────────────────────────────
      const hold = await this.findHold(subjectType, subjectId);
      if (hold) {
        await record('holds', 'refused', hold.count, hold.reason);
        await this.db
          .update(deletionRequests)
          .set({ status: 'on_hold', holdReason: hold.reason, updatedAt: new Date() })
          .where(eq(deletionRequests.id, requestId));
        await this.db
          .update(erasureJobs)
          .set({ status: 'failed', error: hold.reason, finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(erasureJobs.id, job!.id));
        this.logger.warn(`erasure ${requestId} held: ${hold.reason}`);
        return { status: 'on_hold', steps };
      }
      await record('holds', 'done', 0, 'no live booking, no open payout');

      // ── 2. Authority dies first ───────────────────────────────────────────
      // Before the identity is tombstoned, so the revocation's `reason` reads
      // against a name that still exists in the trail the operator sees.
      const realm = subjectType === 'driver' ? 'driver' : 'customer';
      const revoked = await this.tokens.revokeSubject(subjectId, realm, 'account_deleted');
      await record('revoke_sessions', 'done', revoked, `${realm} realm`);

      // ── 3. Identity becomes a tombstone ───────────────────────────────────
      const identity = await this.anonymiseIdentity(subjectType, subjectId);
      await record(
        'anonymise_identity',
        identity ? 'done' : 'skipped',
        identity ? identity.deletedRows : 0,
        identity?.detail,
      );
      const phones = identity?.phones ?? [];

      // ── 4. Documents, devices and the small PII tables ────────────────────
      const erased = await this.eraseRecords(subjectType, subjectId, phones);
      await record('erase_records', 'done', erased.rows, erased.detail);

      // ── 5. The booking trail's free-text and location samples ─────────────
      const trail = await this.eraseBookingPii(subjectType, subjectId);
      await record('erase_booking_pii', 'done', trail.rows, trail.detail);

      // ── 6. Done — the evidence row, and the request's own tombstone ───────
      const now = new Date();
      await this.db
        .update(deletionRequests)
        .set({
          status: 'completed',
          executedAt: now,
          anonymisedAt: now,
          updatedAt: now,
        })
        .where(eq(deletionRequests.id, requestId));
      await this.db
        .update(erasureJobs)
        .set({ status: 'completed', finishedAt: now, updatedAt: now })
        .where(eq(erasureJobs.id, job!.id));
      await record('complete', 'done', 0);

      this.logger.log(`erasure ${requestId} completed (${subjectType})`);
      return { status: 'completed', steps };
    } catch (error) {
      // A crash is not a refusal: park the request so it stays actionable, and
      // keep the partial step log — the next run repeats the steps idempotently.
      const message = error instanceof Error ? error.message : String(error);
      await record('failed', 'refused', 0, message).catch(() => undefined);
      await this.db
        .update(deletionRequests)
        .set({ status: 'on_hold', holdReason: `Erasure failed: ${message}`, updatedAt: new Date() })
        .where(eq(deletionRequests.id, requestId));
      await this.db
        .update(erasureJobs)
        .set({ status: 'failed', error: message, finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(erasureJobs.id, job!.id));
      this.logger.error(`erasure ${requestId} failed: ${message}`);
      return { status: 'failed', steps };
    }
  }

  /**
   * The two holds that can stop an erasure. Both are "money or a live trip
   * still depends on this person's data", not policy preferences.
   */
  private async findHold(
    subjectType: 'user' | 'driver',
    subjectId: string,
  ): Promise<{ reason: string; count: number } | null> {
    const subjectColumn = subjectType === 'driver' ? bookings.driverId : bookings.userId;
    const liveBookings = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(eq(subjectColumn, subjectId), inArray(bookings.status, [...LIVE_BOOKING_STATUSES])),
      );
    if (liveBookings.length > 0) {
      return {
        reason: `live_booking:${liveBookings.length}`,
        count: liveBookings.length,
      };
    }

    if (subjectType === 'driver') {
      const openPayouts = await this.db
        .select({ id: payouts.id })
        .from(payouts)
        .where(
          and(
            eq(payouts.ownerType, 'driver'),
            eq(payouts.ownerId, subjectId),
            inArray(payouts.status, [...OPEN_PAYOUT_STATUSES]),
          ),
        );
      if (openPayouts.length > 0) {
        return { reason: `open_payout:${openPayouts.length}`, count: openPayouts.length };
      }
    }

    return null;
  }

  /**
   * Replaces the subject's own identifiers with tombstones. The mobile becomes
   * `deleted:<uuid>` — the uuid keeps the unique index satisfied forever, and
   * the prefix is what every reader can recognise as "no phone here" without a
   * second column saying so.
   */
  private async anonymiseIdentity(
    subjectType: 'user' | 'driver',
    subjectId: string,
  ): Promise<{ deletedRows: number; phones: string[]; detail: string } | null> {
    const tombstone = `deleted:${subjectId}`;
    const now = new Date();

    if (subjectType === 'driver') {
      const [existing] = await this.db
        .select({ mobile: drivers.mobile })
        .from(drivers)
        .where(eq(drivers.id, subjectId))
        .limit(1);
      if (!existing) return null;

      await this.db
        .update(drivers)
        .set({
          mobile: tombstone,
          name: null,
          email: null,
          photoUrl: null,
          kycStatus: 'suspended',
          isOnline: false,
          currentLocation: null,
          lastPingAt: null,
          currentZoneId: null,
          notificationPrefs: {},
          updatedAt: now,
        })
        .where(eq(drivers.id, subjectId));

      return { deletedRows: 1, phones: [existing.mobile], detail: tombstone };
    }

    const [existing] = await this.db
      .select({ mobile: users.mobile })
      .from(users)
      .where(eq(users.id, subjectId))
      .limit(1);
    if (!existing) return null;

    await this.db
      .update(users)
      .set({
        mobile: tombstone,
        name: null,
        email: null,
        photoUrl: null,
        defaultLat: null,
        defaultLng: null,
        notificationPrefs: {},
        updatedAt: now,
      })
      .where(eq(users.id, subjectId));

    return { deletedRows: 1, phones: [existing.mobile], detail: tombstone };
  }

  /**
   * Documents (row + storage object), saved vehicles' RC scans, addresses,
   * emergency contacts, SOS contact copies, social bindings, login challenges,
   * devices, and the OTP rows the subject's phones left behind.
   *
   * `ratings.review` is nulled rather than the row deleted: the star is a
   * measurement the other side's history depends on, the sentence beside it is
   * the subject's own words.
   */
  private async eraseRecords(
    subjectType: 'user' | 'driver',
    subjectId: string,
    phones: string[],
  ): Promise<{ rows: number; detail: string }> {
    let rows = 0;
    let objects = 0;

    // ── Storage objects first, rows second. The other order leaks: a crash
    // between the two would leave a scan in the bucket with nothing pointing
    // at it; this order leaves at worst a row pointing at a missing file,
    // which the next run deletes along with everything else.
    const fileUrls: string[] = [];
    if (subjectType === 'driver') {
      const docs = await this.db
        .select({ fileUrl: driverDocuments.fileUrl })
        .from(driverDocuments)
        .where(eq(driverDocuments.driverId, subjectId));
      const versions = await this.db
        .select({ fileUrl: driverDocumentVersions.fileUrl })
        .from(driverDocumentVersions)
        .where(eq(driverDocumentVersions.driverId, subjectId));
      fileUrls.push(...docs.map((row) => row.fileUrl), ...versions.map((row) => row.fileUrl));
    } else {
      const vehicles = await this.db
        .select({ rcUrl: savedVehicles.rcUrl })
        .from(savedVehicles)
        .where(eq(savedVehicles.userId, subjectId));
      fileUrls.push(...vehicles.map((row) => row.rcUrl).filter((url): url is string => url !== null));
    }

    for (const fileUrl of new Set(fileUrls)) {
      try {
        await this.storage.delete(keyFromFileUrl(fileUrl));
        objects += 1;
      } catch (error) {
        // A URL the disk adapter cannot parse is recorded and skipped, never
        // fatal: the erasure's obligation is the PII it can reach.
        this.logger.warn(`erasure: could not delete ${fileUrl}: ${String(error)}`);
      }
    }

    if (subjectType === 'driver') {
      const docRows = await this.db
        .delete(driverDocuments)
        .where(eq(driverDocuments.driverId, subjectId))
        .returning({ id: driverDocuments.id });
      const versionRows = await this.db
        .delete(driverDocumentVersions)
        .where(eq(driverDocumentVersions.driverId, subjectId))
        .returning({ id: driverDocumentVersions.id });
      rows += docRows.length + versionRows.length;

      const contactRows = await this.db
        .delete(sosAlertContacts)
        .where(
          inArray(
            sosAlertContacts.alertId,
            this.db
              .select({ id: sosAlerts.id })
              .from(sosAlerts)
              .where(
                and(eq(sosAlerts.subjectType, subjectType), eq(sosAlerts.subjectId, subjectId)),
              ),
          ),
        )
        .returning({ id: sosAlertContacts.id });
      rows += contactRows.length;
    } else {
      const vehicleRows = await this.db
        .delete(savedVehicles)
        .where(eq(savedVehicles.userId, subjectId))
        .returning({ id: savedVehicles.id });
      const addressRows = await this.db
        .delete(addresses)
        .where(eq(addresses.userId, subjectId))
        .returning({ id: addresses.id });
      const contactRows = await this.db
        .delete(emergencyContacts)
        .where(eq(emergencyContacts.userId, subjectId))
        .returning({ id: emergencyContacts.id });
      rows += vehicleRows.length + addressRows.length + contactRows.length;
    }

    const socialRows = await this.db
      .delete(socialIdentities)
      .where(
        and(
          eq(socialIdentities.subjectType, subjectType),
          eq(socialIdentities.subjectId, subjectId),
        ),
      )
      .returning({ id: socialIdentities.id });
    const challengeRows = await this.db
      .delete(loginChallenges)
      .where(
        and(eq(loginChallenges.subjectType, subjectType), eq(loginChallenges.subjectId, subjectId)),
      )
      .returning({ id: loginChallenges.id });
    const deviceRows = await this.db
      .delete(devices)
      .where(and(eq(devices.subjectType, subjectType), eq(devices.subjectId, subjectId)))
      .returning({ id: devices.id });

    let otpRows = 0;
    if (phones.length > 0) {
      const deleted = await this.db
        .delete(otpVerifications)
        .where(inArray(otpVerifications.phone, phones))
        .returning({ id: otpVerifications.id });
      otpRows = deleted.length;
    }

    const ratingClause =
      subjectType === 'driver' ? eq(ratings.driverId, subjectId) : eq(ratings.userId, subjectId);
    const ratingRows = await this.db
      .update(ratings)
      .set({ review: null, updatedAt: new Date() })
      .where(and(ratingClause, sql`${ratings.review} is not null`))
      .returning({ id: ratings.id });

    rows +=
      socialRows.length + challengeRows.length + deviceRows.length + otpRows + ratingRows.length;

    return {
      rows,
      detail: `${objects} storage object(s), ${socialRows.length} social binding(s), ` +
        `${deviceRows.length} device(s), ${otpRows} otp row(s), ${ratingRows.length} review(s)`,
    };
  }

  /**
   * The booking trail's free-text and location samples. Coordinates stay —
   * dispatch and finance read them, and a pair of numbers is not an identity —
   * while the address text, the handover contact and the drawn route go.
   */
  private async eraseBookingPii(
    subjectType: 'user' | 'driver',
    subjectId: string,
  ): Promise<{ rows: number; detail: string }> {
    const subjectColumn = subjectType === 'driver' ? bookings.driverId : bookings.userId;

    const bookingRows = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(subjectColumn, subjectId));
    if (bookingRows.length === 0) return { rows: 0, detail: 'no bookings' };

    const ids = bookingRows.map((row) => row.id);
    const pathRows = await this.db
      .delete(bookingLocationPath)
      .where(inArray(bookingLocationPath.bookingId, ids))
      .returning({ id: bookingLocationPath.id });

    const updated = await this.db
      .update(bookings)
      .set({
        pickupAddress: null,
        dropAddress: null,
        contactName: null,
        contactMobile: null,
        routePolyline: null,
        routeDropPolyline: null,
        shareToken: null,
        updatedAt: new Date(),
      })
      .where(inArray(bookings.id, ids))
      .returning({ id: bookings.id });

    return {
      rows: pathRows.length + updated.length,
      detail: `${updated.length} booking(s) scrubbed, ${pathRows.length} path sample(s)`,
    };
  }
}
