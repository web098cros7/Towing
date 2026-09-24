import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountDeletionResponse,
  AccountExportResponse,
  ConsentPolicyType,
  ConsentRecordRequest,
  ConsentStatus,
  ConsentWithdrawRequest,
} from '@towing/api-contracts';
import { and, desc, eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { DeviceRegistryService } from '../../common/notifications/device-registry.service';
import { DB, type Database } from '../../db/db.module';
import { consentRecords, deletionRequests, drivers, users } from '../../db/schema';
import { NotificationCentreService } from '../notification-centre/notification-centre.service';
import { TokenService } from '../auth/token.service';
import { buildSubjectExport } from '../privacy/subject-export';

export type PrivacySubjectType = 'user' | 'driver';

/**
 * §20.4 DPDP, dual-realm (Phase 12) — `DELETE /v1/me`, `GET /v1/me/export`,
 * `POST /v1/me/consent` and `POST /v1/me/consent/withdraw`. A customer and a driver call the exact same routes;
 * what differs is which tables `subjectType` reads from.
 */
@Injectable()
export class AccountPrivacyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly devices: DeviceRegistryService,
    private readonly tokens: TokenService,
    private readonly centre: NotificationCentreService,
  ) {}

  /**
   * A16 (W19): the request row, the suspension and the revocation commit
   * TOGETHER. Before this, a customer could file a deletion request and keep a
   * working refresh token for the rest of its 30 days — the row said "marked
   * for deletion" while the account carried on booking.
   *
   * `users.status` / `drivers.kyc_status` is the suspension the whole REST of
   * the system already honours: booking creation checks the account status and
   * the realm policy checks the driver's standing at refresh, so no new gate
   * had to be invented for this phase.
   */
  async requestDeletion(
    subjectType: PrivacySubjectType,
    subjectId: string,
    reason?: string,
  ): Promise<AccountDeletionResponse> {
    let row: { id: string; requestedAt: Date } | undefined;

    try {
      row = await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(deletionRequests)
          .values({ subjectType, subjectId, reason })
          .returning({ id: deletionRequests.id, requestedAt: deletionRequests.requestedAt });

        if (subjectType === 'driver') {
          await tx
            .update(drivers)
            .set({
              kycStatus: 'suspended',
              isOnline: false,
              pendingSuspensionReason: 'account_deletion_requested',
              updatedAt: new Date(),
            })
            .where(eq(drivers.id, subjectId));
        } else {
          await tx
            .update(users)
            .set({
              status: 'suspended',
              suspendedAt: new Date(),
              suspensionReason: 'account_deletion_requested',
              updatedAt: new Date(),
            })
            .where(eq(users.id, subjectId));
        }

        // A15's transactional form: the session dies in the same commit as the
        // request that says why.
        await this.tokens.revokeSubject(
          subjectId,
          subjectType === 'driver' ? 'driver' : 'customer',
          'account_deletion_requested',
          { tx },
        );

        return inserted;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // `uq_deletion_requests_one_open_per_subject` — a second request while
      // one is still open is a no-op from the subject's point of view, not a
      // new fact worth a second row for W19's erasure worker to race on.
      throw ApiException.conflict('An account deletion request is already open');
    }

    // Invariant 73: a push token is device-scoped state and must be revoked
    // when the account it belongs to ends, not merely orphaned. W19's erasure
    // worker runs much later (a human approves first); between now and then
    // every notification for this subject would otherwise keep rendering on
    // their lock screen — including on a handset they may have already sold.
    await this.devices.revokeAllForSubject(subjectType, subjectId, 'account_deletion_requested');

    return {
      requestId: row!.id,
      status: 'requested',
      requestedAt: row!.requestedAt.toISOString(),
    };
  }

  /**
   * The newest agreement per policy (see `consentStatusSchema`). Withdrawals are
   * skipped on purpose: they stop marketing, they do not undo the one-time
   * consent, so a customer who withdrew is not asked again on their next phone.
   */
  async consentStatus(subjectType: PrivacySubjectType, subjectId: string): Promise<ConsentStatus> {
    const rows = await this.db
      .selectDistinctOn([consentRecords.policyType], {
        policyType: consentRecords.policyType,
        policyVersion: consentRecords.policyVersion,
        consentedAt: consentRecords.consentedAt,
      })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.subjectType, subjectType),
          eq(consentRecords.subjectId, subjectId),
          eq(consentRecords.action, 'granted'),
        ),
      )
      .orderBy(consentRecords.policyType, desc(consentRecords.consentedAt));

    return {
      granted: rows.map((row) => ({
        policyType: row.policyType as ConsentPolicyType,
        policyVersion: row.policyVersion,
        action: 'granted' as const,
        consentedAt: row.consentedAt.toISOString(),
      })),
    };
  }

  async recordConsent(
    subjectType: PrivacySubjectType,
    subjectId: string,
    body: ConsentRecordRequest,
  ): Promise<void> {
    await this.db.insert(consentRecords).values({
      subjectType,
      subjectId,
      policyType: body.policyType,
      policyVersion: body.policyVersion,
      action: 'granted',
    });
  }

  /**
   * §20.4's withdrawal, which the consent overlay has always promised
   * ("You can withdraw consent anytime from Settings") and nothing could do.
   *
   * WITHDRAWAL STOPS MARKETING AND LEAVES THE ACCOUNT WORKING (Ehsan, 23 Sep).
   * Booking, payment and safety messages carry on, because they are how MiTow
   * runs a trip the customer has paid for; stopping those would be abandoning
   * a service mid-delivery rather than honouring a preference. Ending the
   * account entirely is `DELETE /v1/me`, and the app names that separately so
   * one button never means two things.
   *
   * TWO WRITES, AND THE ORDER MATTERS. The preference is what actually silences
   * the marketing, so it goes first; the log row is the audit trail. If the
   * second failed we would have honoured a request we could not prove, which is
   * the better way round — the reverse would be a promise on paper that the
   * fan-out worker never heard about.
   *
   * The newest row per (subject, policy) is the current state, so a withdrawal
   * needs no version: it withdraws whatever was last agreed to, and the version
   * that was agreed is already on the row above it.
   */
  async withdrawConsent(
    subjectType: PrivacySubjectType,
    subjectId: string,
    body: ConsentWithdrawRequest,
  ): Promise<void> {
    await this.centre.updatePrefs(subjectType, subjectId, { promotions: false });

    const [latest] = await this.db
      .select({ policyVersion: consentRecords.policyVersion })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.subjectType, subjectType),
          eq(consentRecords.subjectId, subjectId),
          eq(consentRecords.policyType, body.policyType),
        ),
      )
      .orderBy(desc(consentRecords.consentedAt))
      .limit(1);

    await this.db.insert(consentRecords).values({
      subjectType,
      subjectId,
      policyType: body.policyType,
      // The version they are withdrawing from. `unknown` only when a client
      // withdraws consent it never recorded giving, which the route allows
      // rather than 404s: refusing to honour a withdrawal on a bookkeeping
      // technicality is not a defensible reading of §20.4.
      policyVersion: latest?.policyVersion ?? 'unknown',
      action: 'withdrawn',
    });
  }

  /**
   * Delegates to the shared builder (`modules/privacy/subject-export.ts`) — the
   * admin lane serves the same bundle for the same subject, and two
   * implementations of a legal response is how the two versions drift. The
   * driver-scope note that used to live here moved with the code.
   */
  async exportData(
    subjectType: PrivacySubjectType,
    subjectId: string,
  ): Promise<AccountExportResponse> {
    return buildSubjectExport(this.db, subjectType, subjectId);
  }
}
