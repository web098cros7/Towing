import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DriverCapabilitiesResponse,
  DriverCapabilitiesUpdate,
  DriverDocType,
  DriverKycConfirmRequest,
  DriverKycPresignResponse,
  DriverKycStatusResponse,
  DriverKycSubmitResponse,
} from '@towing/api-contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { PresignedUploadService } from '../../common/storage/presigned-upload.helper';
import { DB, type Database } from '../../db/db.module';
import { driverDocumentVersions, driverDocuments, drivers } from '../../db/schema';
import { toOptionalServices } from '../../common/drivers/services';

/** The 5 documents §3.1 requires before a driver can reach `pending`. */
export const REQUIRED_KYC_DOC_TYPES: readonly DriverDocType[] = [
  'license',
  'rc',
  'gov_id',
  'inspection',
  'selfie',
];

/** Every presigned driver-document key lives under this prefix — see `PresignedUploadService`. */
export const DRIVER_DOCUMENTS_KEY_PREFIX = 'driver-documents';

/**
 * Driver-facing KYC submission (Phase 11, §3.1 layer 1). Its MiTow Driver
 * consumer (the KYC wizard) is Phase 12 — this module itself predates it and
 * was proven standalone by `driver-kyc.e2e.spec.ts`.
 */
@Injectable()
export class DriverKycService {
  private readonly logger = new Logger(DriverKycService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly uploads: PresignedUploadService,
  ) {}

  async presign(driverId: string, docType: DriverDocType): Promise<DriverKycPresignResponse> {
    return this.uploads.presign(DRIVER_DOCUMENTS_KEY_PREFIX, driverId, docType);
  }

  async confirm(driverId: string, body: DriverKycConfirmRequest): Promise<void> {
    if (!this.uploads.isOwnKey(body.key, DRIVER_DOCUMENTS_KEY_PREFIX, driverId, body.docType)) {
      throw ApiException.forbidden('This key was not issued to you');
    }

    const fileUrl = `local://${body.key}`;
    const now = new Date();

    /**
     * W7: the same transaction writes BOTH the current row and its history.
     *
     * `driver_documents` is a verdict plus the latest file, so a resubmission
     * overwrites it and the previous object is orphaned — the history row is
     * what keeps that file findable (the admin's version list reads it, and
     * W19's erasure walks it to delete every object). The supersede-then-insert
     * order matters: marking superseded AFTER the insert would also mark the
     * row just written.
     */
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: driverDocuments.id })
        .from(driverDocuments)
        .where(
          and(eq(driverDocuments.driverId, driverId), eq(driverDocuments.docType, body.docType)),
        )
        .limit(1);

      if (existing) {
        // A resubmission over a previously-rejected (or pending) document resets
        // its review — the old verdict cannot survive new bytes.
        await tx
          .update(driverDocuments)
          .set({
            fileUrl,
            status: 'pending',
            rejectionReason: null,
            verifiedBy: null,
            verifiedAt: null,
            updatedAt: now,
          })
          .where(eq(driverDocuments.id, existing.id));
      } else {
        await tx.insert(driverDocuments).values({
          driverId,
          docType: body.docType,
          fileUrl,
          status: 'pending',
        });
      }

      await tx
        .update(driverDocumentVersions)
        .set({ supersededAt: now })
        .where(
          and(
            eq(driverDocumentVersions.driverId, driverId),
            eq(driverDocumentVersions.docType, body.docType),
            isNull(driverDocumentVersions.supersededAt),
          ),
        );

      await tx.insert(driverDocumentVersions).values({
        driverId,
        docType: body.docType,
        fileUrl,
        status: 'pending',
      });
    });
  }

  async status(driverId: string): Promise<DriverKycStatusResponse> {
    const [driver] = await this.db
      .select({ kycStatus: drivers.kycStatus, rejectionReason: drivers.rejectionReason })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (!driver) throw ApiException.notFound('Driver not found');

    const documents = await this.db
      .select({
        docType: driverDocuments.docType,
        status: driverDocuments.status,
        rejectionReason: driverDocuments.rejectionReason,
      })
      .from(driverDocuments)
      .where(eq(driverDocuments.driverId, driverId));

    return { kycStatus: driver.kycStatus, rejectionReason: driver.rejectionReason, documents };
  }

  async submit(driverId: string): Promise<DriverKycSubmitResponse> {
    const [driver] = await this.db
      .select({ kycStatus: drivers.kycStatus })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (!driver) throw ApiException.notFound('Driver not found');

    // Not a no-op guard for its own sake: submitting from `pending` would
    // re-stamp `kycSubmittedAt` and reopen a document an admin may already be
    // mid-review on; submitting from `approved`/`suspended` makes no sense at
    // all. Only `incomplete` — "gathering documents" — can transition forward.
    if (driver.kycStatus !== 'incomplete') {
      throw ApiException.conflict(
        `Cannot submit from kyc_status '${driver.kycStatus}' — only 'incomplete' can submit`,
      );
    }

    const submittedDocs = await this.db
      .select({ docType: driverDocuments.docType })
      .from(driverDocuments)
      .where(eq(driverDocuments.driverId, driverId));
    const submittedTypes = new Set(submittedDocs.map((d) => d.docType));
    const missing = REQUIRED_KYC_DOC_TYPES.filter((docType) => !submittedTypes.has(docType));

    if (missing.length > 0) {
      throw ApiException.validation('All 5 documents must be uploaded before submitting', {
        missing,
      });
    }

    const now = new Date();
    await this.db
      .update(drivers)
      .set({ kycStatus: 'pending', kycSubmittedAt: now, updatedAt: now })
      .where(eq(drivers.id, driverId));

    // §22.1 analytics event. Buffered as a log line rather than a new events
    // table for one event type — Phase 12 installs the real tracker and this
    // becomes a proper emit.
    this.logger.log(`kyc_submit driver=${driverId}`);

    return { kycStatus: 'pending', kycSubmittedAt: now.toISOString() };
  }

  async capabilities(driverId: string): Promise<DriverCapabilitiesResponse> {
    const [driver] = await this.db
      .select({
        vehicleClass: drivers.vehicleClass,
        longDistanceEnabled: drivers.longDistanceEnabled,
        services: drivers.services,
      })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!driver) throw ApiException.notFound('Driver not found');
    return { ...driver, services: toOptionalServices(driver.services) };
  }

  async updateCapabilities(
    driverId: string,
    body: DriverCapabilitiesUpdate,
  ): Promise<DriverCapabilitiesResponse> {
    const [updated] = await this.db
      .update(drivers)
      .set({
        ...(body.vehicleClass !== undefined ? { vehicleClass: body.vehicleClass } : {}),
        ...(body.longDistanceEnabled !== undefined
          ? { longDistanceEnabled: body.longDistanceEnabled }
          : {}),
        // Deduplicated, because the column is a set in meaning and an array in
        // storage: a client that sends `battery` twice must not make the GIN
        // containment check read two batteries.
        ...(body.services !== undefined ? { services: [...new Set(body.services)] } : {}),
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driverId))
      .returning({
        vehicleClass: drivers.vehicleClass,
        longDistanceEnabled: drivers.longDistanceEnabled,
        services: drivers.services,
      });

    if (!updated) throw ApiException.notFound('Driver not found');
    return { ...updated, services: toOptionalServices(updated.services) };
  }
}
