import type {
  AdminDeletionDecision,
  AdminDeletionHold,
  AdminDeletionRequest,
  AdminDeletionRequestsQuery,
  AdminDeletionRequestsResponse,
  AdminRetentionPoliciesResponse,
  AdminRetentionUpdate,
  AdminSubjectExportResponse,
  AdminUserCorrection,
  AdminUserCorrectionResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  mockDeletionRequest,
  mockDeletionRequests,
  mockRetention,
  mockSubjectExport,
  mockUserCorrection,
  rememberDeletionTransition,
} from '../mocks/adminPrivacy.mock';

/**
 * W19's privacy console APIs (§20.4 DPDP).
 *
 * Every mutation here is a STATE TRANSITION (`approve`, `hold`, `execute`),
 * not a delete: the mock returns the row as the backend would return it, and
 * the UI re-reads the detail on success — which is also what makes the typed
 * confirmation meaningful in the mock walk.
 */
export interface AdminPrivacyDataSource {
  requests(query: AdminDeletionRequestsQuery): Promise<AdminDeletionRequestsResponse>;
  request(id: string): Promise<AdminDeletionRequest>;
  decide(
    id: string,
    decision: 'approve' | 'reject',
    body: AdminDeletionDecision,
  ): Promise<AdminDeletionRequest>;
  hold(id: string, body: AdminDeletionHold): Promise<AdminDeletionRequest>;
  execute(id: string): Promise<AdminDeletionRequest>;
  retention(): Promise<AdminRetentionPoliciesResponse>;
  updateRetention(body: AdminRetentionUpdate): Promise<AdminRetentionPoliciesResponse>;
  exportUser(userId: string): Promise<AdminSubjectExportResponse>;
  correctUser(userId: string, body: AdminUserCorrection): Promise<AdminUserCorrectionResponse>;
}

const mockSource: AdminPrivacyDataSource = {
  requests: async (query) => {
    await mockDelay(200);
    return resolveMock(env.mockAdminPrivacyState, mockDeletionRequests(query), {
      items: [],
      page: query.page,
      limit: query.limit,
      total: 0,
    });
  },
  request: async (id) => {
    await mockDelay(150);
    return mockDeletionRequest(id);
  },
  decide: async (id, decision, body) => {
    await mockDelay(300);
    return rememberDeletionTransition(id, {
      status: decision === 'approve' ? 'approved' : 'rejected',
      holdReason: null,
      decidedAt: new Date().toISOString(),
      reason: body.reason ?? null,
    });
  },
  hold: async (id, body) => {
    await mockDelay(300);
    return rememberDeletionTransition(id, { status: 'on_hold', holdReason: body.reason });
  },
  execute: async (id) => {
    await mockDelay(400);
    return rememberDeletionTransition(id, { status: 'executing' });
  },
  retention: async () => {
    await mockDelay(150);
    return resolveMock(env.mockAdminPrivacyState, mockRetention(), { items: [] });
  },
  updateRetention: async (body) => {
    await mockDelay(300);
    return mockRetention(body.policies);
  },
  exportUser: async () => {
    await mockDelay(300);
    return mockSubjectExport();
  },
  correctUser: async (_userId, body) => {
    await mockDelay(300);
    return mockUserCorrection(body);
  },
};

const restSource: AdminPrivacyDataSource = {
  requests: (query) => {
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
    if (query.status) params.set('status', query.status);
    if (query.subjectType) params.set('subjectType', query.subjectType);
    return adminApiFetch<AdminDeletionRequestsResponse>(
      `privacy/deletion-requests?${params.toString()}`,
    );
  },
  request: (id) => adminApiFetch<AdminDeletionRequest>(`privacy/deletion-requests/${id}`),
  decide: (id, decision, body) =>
    adminApiFetch<AdminDeletionRequest>(`privacy/deletion-requests/${id}/${decision}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  hold: (id, body) =>
    adminApiFetch<AdminDeletionRequest>(`privacy/deletion-requests/${id}/hold`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  execute: (id) =>
    adminApiFetch<AdminDeletionRequest>(`privacy/deletion-requests/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  retention: () => adminApiFetch<AdminRetentionPoliciesResponse>('privacy/retention'),
  updateRetention: (body) =>
    adminApiFetch<AdminRetentionPoliciesResponse>('privacy/retention', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  exportUser: (userId) => adminApiFetch<AdminSubjectExportResponse>(`users/${userId}/export`),
  correctUser: (userId, body) =>
    adminApiFetch<AdminUserCorrectionResponse>(`users/${userId}/correct`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const adminPrivacyDataSource: AdminPrivacyDataSource = env.useMocks
  ? mockSource
  : restSource;
