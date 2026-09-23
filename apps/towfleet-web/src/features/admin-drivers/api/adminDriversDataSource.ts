import type {
  AdminCapabilitiesResponse,
  OptionalServiceType,
  AdminDocumentReviewResult,
  AdminKycResult,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay } from '@/lib/mockUtils';
import {
  adminDriversMock,
  adminDriversMockVersions,
  mockDecidedDrivers,
  mockPartialFailure,
  mockVersionFallback,
} from '../mocks/adminDrivers.mock';
import type {
  AdminDocumentVersion,
  AdminPendingDriver,
  AdminPendingDriversPage,
  KycBulkDecision,
  KycBulkResult,
  KycDecision,
  VehicleClass,
} from '../types';

export interface CapabilitiesUpdateInput {
  vehicleClass?: VehicleClass;
  longDistanceEnabled?: boolean;
  /**
   * The driver's roadside opt-ins, as a COMPLETE set. Omit the key to leave
   * them alone; send `[]` to take them all away. Ops uses this to correct a
   * driver who ticked kit they turned out not to carry.
   */
  services?: OptionalServiceType[];
}

export interface AdminDriversDataSource {
  pending(page: number, limit: number): Promise<AdminPendingDriversPage>;
  /** W7 — every upload of every document for one driver, newest first. */
  versions(driverId: string): Promise<AdminDocumentVersion[]>;
  decideKyc(
    driverId: string,
    decision: KycDecision,
    reason?: string,
    mode?: 'after_current_job' | 'immediate',
    /** `approve` only: the name exactly as printed on the licence being approved. */
    licenceName?: string,
  ): Promise<AdminKycResult>;
  /** W7 — per-item results, never all-or-nothing. */
  bulkDecide(
    decision: KycBulkDecision,
    driverIds: string[],
    reason?: string,
  ): Promise<KycBulkResult>;
  reviewDocument(
    driverId: string,
    documentId: string,
    decision: 'approve' | 'reject',
    reason?: string,
  ): Promise<AdminDocumentReviewResult>;
  updateCapabilities(
    driverId: string,
    input: CapabilitiesUpdateInput,
  ): Promise<AdminCapabilitiesResponse>;
}

/** The queue after a mock decision, and the page window over it. */
function mockPage(page: number, limit: number): AdminPendingDriversPage {
  const remaining = adminDriversMock.filter((driver) => !mockDecidedDrivers.has(driver.id));
  const start = (page - 1) * limit;
  return {
    items: remaining.slice(start, start + limit),
    page,
    limit,
    total: remaining.length,
  };
}

const mockSource: AdminDriversDataSource = {
  pending: async (page, limit) => {
    if (env.mockAdminDriversState === 'error') {
      await mockDelay();
      throw new Error('Mock error state (forced via env)');
    }
    await mockDelay();
    const empty = env.mockAdminDriversState === 'empty';
    return empty ? { items: [], page: 1, limit, total: 0 } : mockPage(page, limit);
  },

  versions: async (driverId) => {
    await mockDelay();
    const recorded = adminDriversMockVersions[driverId];
    if (recorded) return recorded;
    // Every other driver has exactly one version per document — the shape a
    // driver who has never resubmitted has.
    const driver = adminDriversMock.find((row) => row.id === driverId);
    return driver ? driver.documents.map(mockVersionFallback) : [];
  },

  decideKyc: async (driverId, decision, reason) => {
    await mockDelay();
    // A19: sentinel rejection so the drawer's error UI is testable mocks-on.
    // Route interception cannot reach mockSource (it never fetches), and this
    // asserts the drawer's rendering — product UI code — never backend
    // behaviour, which stays e2e-live territory per the house rule.
    if (reason === 'mock-failure') {
      throw new Error('Mock failure (sentinel reason rejected by the mock)');
    }
    const kycStatus = {
      approve: 'approved',
      reject: 'rejected',
      request_info: 'incomplete',
      suspend: 'suspended',
      reactivate: 'pending',
    } as const satisfies Record<KycDecision, string>;
    mockDecidedDrivers.add(driverId);
    return {
      driverId,
      kycStatus: kycStatus[decision],
      rejectionReason: null,
      sessionsRevoked: 0,
      // Mocks decide nothing (see adminFinanceDataSource's note); the pending
      // shelf only exists against a real backend (A14).
      suspensionPending: false,
    };
  },

  bulkDecide: async (decision, driverIds, reason) => {
    await mockDelay();
    if (decision === 'reject' && !reason) {
      throw new Error('A shared rejection reason is required');
    }
    const results = driverIds.map((driverId, index) => {
      // Sentinel mirroring the drawer's `mock-failure`: the first driver fails,
      // so the per-item result UI — including a partial failure — is reachable
      // mocks-on. Backend behaviour stays e2e-live territory.
      if (reason === mockPartialFailure && index === 0) {
        return {
          driverId,
          ok: false,
          kycStatus: null,
          error: { code: 'conflict', message: 'Mock partial failure (sentinel reason)' },
        };
      }
      const known = adminDriversMock.some((row) => row.id === driverId);
      if (!known) {
        return {
          driverId,
          ok: false,
          kycStatus: null,
          error: { code: 'not_found', message: 'Driver not found' },
        };
      }
      mockDecidedDrivers.add(driverId);
      return {
        driverId,
        ok: true,
        kycStatus: decision === 'approve' ? ('approved' as const) : ('rejected' as const),
        error: null,
      };
    });

    const succeeded = results.filter((result) => result.ok).length;
    return { decision, succeeded, failed: results.length - succeeded, results };
  },

  reviewDocument: async (_driverId, documentId, decision, reason) => {
    await mockDelay();
    return {
      documentId,
      docType: 'license',
      status: decision === 'approve' ? 'approved' : 'rejected',
      rejectionReason: decision === 'reject' ? (reason ?? null) : null,
    };
  },

  updateCapabilities: async (driverId, input) => {
    await mockDelay();
    // Kept on the mock row, so the drawer shows the change on its next read.
    const driver = adminDriversMock.find((row) => row.id === driverId);
    if (driver) {
      if (input.vehicleClass !== undefined) driver.vehicleClass = input.vehicleClass;
      if (input.longDistanceEnabled !== undefined) {
        driver.longDistanceEnabled = input.longDistanceEnabled;
      }
      if (input.services !== undefined) driver.services = input.services;
    }
    return {
      vehicleClass: driver?.vehicleClass ?? input.vehicleClass ?? null,
      longDistanceEnabled: driver?.longDistanceEnabled ?? input.longDistanceEnabled ?? false,
      services: driver?.services ?? input.services ?? [],
    };
  },
};

const restSource: AdminDriversDataSource = {
  pending: (page, limit) =>
    adminApiFetch<AdminPendingDriversPage>(`drivers/pending?page=${page}&limit=${limit}`),

  versions: async (driverId) =>
    (
      await adminApiFetch<{ items: AdminDocumentVersion[] }>(
        `drivers/${driverId}/document-versions`,
      )
    ).items,

  decideKyc: (driverId, decision, reason, mode, licenceName) =>
    adminApiFetch<AdminKycResult>(`drivers/${driverId}/kyc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision,
        ...(reason ? { reason } : {}),
        ...(mode ? { mode } : {}),
        // Sent on approval only. The backend ignores it on every other
        // decision, but not sending it keeps the request honest about what
        // the admin was actually looking at.
        ...(decision === 'approve' && licenceName ? { licenceName } : {}),
      }),
    }),

  bulkDecide: (decision, driverIds, reason) =>
    adminApiFetch<KycBulkResult>('drivers/kyc/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, driverIds, ...(reason ? { reason } : {}) }),
    }),

  reviewDocument: (driverId, documentId, decision, reason) =>
    adminApiFetch<AdminDocumentReviewResult>(`drivers/${driverId}/documents/${documentId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
    }),

  updateCapabilities: (driverId, input) =>
    adminApiFetch<AdminCapabilitiesResponse>(`drivers/${driverId}/capabilities`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
};

export const adminDriversDataSource: AdminDriversDataSource = env.useMocks ? mockSource : restSource;
