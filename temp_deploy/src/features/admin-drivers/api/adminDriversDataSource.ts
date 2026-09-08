import type {
  AdminCapabilitiesResponse,
  AdminDocumentReviewResult,
  AdminKycResult,
  AdminPendingDriversResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { adminDriversMock } from '../mocks/adminDrivers.mock';
import type { AdminPendingDriver, KycDecision, VehicleClass } from '../types';

export interface CapabilitiesUpdateInput {
  vehicleClass?: VehicleClass;
  longDistanceEnabled?: boolean;
}

export interface AdminDriversDataSource {
  pending(): Promise<AdminPendingDriver[]>;
  decideKyc(driverId: string, decision: KycDecision, reason?: string): Promise<AdminKycResult>;
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

const mockSource: AdminDriversDataSource = {
  pending: () => resolveMock(env.mockAdminDriversState, adminDriversMock, []),
  decideKyc: async (driverId, decision) => {
    await mockDelay();
    const kycStatus = {
      approve: 'approved',
      reject: 'rejected',
      request_info: 'incomplete',
      suspend: 'suspended',
      reactivate: 'pending',
    } as const satisfies Record<KycDecision, string>;
    return {
      driverId,
      kycStatus: kycStatus[decision],
      rejectionReason: null,
      sessionsRevoked: 0,
    };
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
  updateCapabilities: async (_driverId, input) => {
    await mockDelay();
    return {
      vehicleClass: input.vehicleClass ?? null,
      longDistanceEnabled: input.longDistanceEnabled ?? false,
    };
  },
};

const restSource: AdminDriversDataSource = {
  pending: async () =>
    (await adminApiFetch<AdminPendingDriversResponse>('drivers/pending')).items,
  decideKyc: (driverId, decision, reason) =>
    adminApiFetch<AdminKycResult>(`drivers/${driverId}/kyc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
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
