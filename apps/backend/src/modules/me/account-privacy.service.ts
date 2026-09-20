import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountDeletionResponse,
  AccountExportResponse,
  ConsentRecordRequest,
} from '@towing/api-contracts';
import { and, eq } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { DeviceRegistryService } from '../../common/notifications/device-registry.service';
import { DB, type Database } from '../../db/db.module';
import { consentRecords, deletionRequests, drivers, users } from '../../db/schema';
import { TokenService } from '../auth/token.service';
import { buildSubjectExport } from '../privacy/subject-export';

export type PrivacySubjectType = 'user' | 'driver';

/**
 * §20.4 DPDP, dual-realm (Phase 12) — `DELETE /v1/me`, `GET /v1/me/export`,
 * `POST /v1/me/consent`. A customer and a driver call the exact same routes;
 * what differs is which tables `subjectType` reads from.
 */
@Injectable()
export class AccountPrivacyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly devices: DeviceRegistryService,
    private readonly tokens: TokenService,
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
