import type {
  AdminDisputeAssignBody,
  AdminDisputeDetail,
  AdminDisputeEvidenceConfirmBody,
  AdminDisputeEvidencePresignResponse,
  AdminDisputeNoteBody,
  AdminDisputeOpenBody,
  AdminDisputeOpenResponse,
  AdminDisputeResolveBody,
  AdminDisputeResolveResponse,
  AdminDisputesQuery,
  AdminDisputesResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { adminDisputeDetailMock, adminDisputesMock } from '../mocks/adminDisputes.mock';

/**
 * W8's dispute APIs.
 *
 * `open` lives here even though its route hangs off the booking
 * (`POST /admin/bookings/:id/dispute`): the SUBJECT is the dispute, and the
 * booking-detail dialog that calls it should not have to know two data layers
 * to file one complaint.
 *
 * Writes refuse under mocks for the reason written into the bookings source:
 * a mocked resolution would only prove the mock resolves, and this screen's
 * buttons decide where the booking lands and what money moves.
 */
export interface AdminDisputesDataSource {
  list(query: AdminDisputesQuery): Promise<AdminDisputesResponse>;
  detail(disputeId: string): Promise<AdminDisputeDetail>;
  open(bookingId: string, body: AdminDisputeOpenBody): Promise<AdminDisputeOpenResponse>;
  assign(disputeId: string, body: AdminDisputeAssignBody): Promise<AdminDisputeDetail>;
  note(disputeId: string, body: AdminDisputeNoteBody): Promise<AdminDisputeDetail>;
  resolve(
    disputeId: string,
    body: AdminDisputeResolveBody,
  ): Promise<AdminDisputeResolveResponse>;
  evidencePresign(disputeId: string): Promise<AdminDisputeEvidencePresignResponse>;
  evidenceConfirm(
    disputeId: string,
    body: AdminDisputeEvidenceConfirmBody,
  ): Promise<AdminDisputeDetail>;
}

const MOCKS_NEED_BACKEND =
  'Mocks are on — dispute writes need the real backend. Set NEXT_PUBLIC_USE_MOCKS=false.';

const mockSource: AdminDisputesDataSource = {
  list: async (query) => {
    const all = await resolveMock(env.mockAdminDisputesState, adminDisputesMock, []);
    const filtered = all
      .filter((row) => {
        if (query.status && row.status !== query.status) return false;
        if (query.reasonCode && row.reasonCode !== query.reasonCode) return false;
        if (query.assignedAdminId && row.assignedAdminId !== query.assignedAdminId) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (query.page - 1) * query.limit;
    return {
      items: filtered.slice(start, start + query.limit),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
    };
  },

  detail: async (disputeId) =>
    resolveMock(
      env.mockAdminDisputesState,
      adminDisputeDetailMock(disputeId),
      adminDisputeDetailMock(disputeId),
    ),

  open: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  assign: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  note: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  resolve: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  evidencePresign: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  evidenceConfirm: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
};

const restSource: AdminDisputesDataSource = {
  list: (query) => {
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
    if (query.status) params.set('status', query.status);
    if (query.reasonCode) params.set('reasonCode', query.reasonCode);
    if (query.assignedAdminId) params.set('assignedAdminId', query.assignedAdminId);
    return adminApiFetch<AdminDisputesResponse>(`disputes?${params.toString()}`);
  },

  detail: (disputeId) => adminApiFetch<AdminDisputeDetail>(`disputes/${disputeId}`),

  open: (bookingId, body) =>
    adminApiFetch<AdminDisputeOpenResponse>(`bookings/${bookingId}/dispute`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  assign: (disputeId, body) =>
    adminApiFetch<AdminDisputeDetail>(`disputes/${disputeId}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // No Idempotency-Key: assignment is a guarded UPDATE and the resolver
  // releases its one-open-dispute slot transactionally, so a replay is a 409
  // / no-op rather than a second effect. The refund drawer's gateway writes
  // (W9) are the ones that carry keys.
  note: (disputeId, body) =>
    adminApiFetch<AdminDisputeDetail>(`disputes/${disputeId}/note`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  resolve: (disputeId, body) =>
    adminApiFetch<AdminDisputeResolveResponse>(`disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  evidencePresign: (disputeId) =>
    adminApiFetch<AdminDisputeEvidencePresignResponse>(`disputes/${disputeId}/evidence/presign`, {
      method: 'POST',
    }),

  evidenceConfirm: (disputeId, body) =>
    adminApiFetch<AdminDisputeDetail>(`disputes/${disputeId}/evidence`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const adminDisputesDataSource: AdminDisputesDataSource = env.useMocks
  ? mockSource
  : restSource;
