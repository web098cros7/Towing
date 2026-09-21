import type {
  AdminFinanceConfigDto,
  AdminInvariantsResponse,
  AdminLedgerQuery,
  AdminLedgerResponse,
  AdminPayoutsListResponse,
  AdminPayoutsQuery,
  AdminPayoutSlaResponse,
  AdminRefundIssue,
  AdminRefundIssueResponse,
  AdminRefundsQuery,
  AdminRefundsResponse,
  AdminTransactionsQuery,
  AdminTransactionsResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  adminFinanceConfigMock,
  adminInvariantsMock,
  adminLedgerMock,
  adminPayoutSlaMock,
  adminPayoutsMock,
  adminRefundsMock,
  adminTransactionsMock,
} from '../mocks/adminFinance.mock';

export interface AdminFinanceDataSource {
  payouts(query: AdminPayoutsQuery): Promise<AdminPayoutsListResponse>;
  approve(payoutId: string): Promise<void>;
  reject(payoutId: string, reason: string): Promise<void>;
  config(): Promise<AdminFinanceConfigDto>;
  updateConfig(patch: Partial<AdminFinanceConfigDto>): Promise<AdminFinanceConfigDto>;
  // ── W9 ──
  transactions(query: AdminTransactionsQuery): Promise<AdminTransactionsResponse>;
  ledger(query: AdminLedgerQuery): Promise<AdminLedgerResponse>;
  refunds(query: AdminRefundsQuery): Promise<AdminRefundsResponse>;
  invariants(): Promise<AdminInvariantsResponse>;
  payoutSla(windowDays: number): Promise<AdminPayoutSlaResponse>;
  issueRefund(body: AdminRefundIssue, idempotencyKey: string): Promise<AdminRefundIssueResponse>;
}

const mockSource: AdminFinanceDataSource = {
  payouts: async (query) => {
    const items = await resolveMock(env.mockAdminFinanceState, adminPayoutsMock, []);
    const probe = query.q?.toLowerCase();
    const filtered = items.filter((item) => {
      if (query.state !== 'all' && item.approvalState !== query.state) return false;
      if (probe && !(item.ownerName ?? '').toLowerCase().includes(probe)) return false;
      // Inclusive IST day bounds, compared on the date part — the same
      // semantics the server derives from a date string.
      if (query.from && item.requestedAt.slice(0, 10) < query.from) return false;
      if (query.to && item.requestedAt.slice(0, 10) > query.to) return false;
      return true;
    });
    // A20: the mock pages like the server (LIMIT/OFFSET), so the pagination
    // UI is exercised against a real envelope, not a full list.
    const start = (query.page - 1) * query.limit;
    return {
      items: filtered.slice(start, start + query.limit),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
    };
  },
  /**
   * The mock DECIDES NOTHING, and that is on purpose.
   *
   * `admin-kyc.spec.ts` sets the house rule its header writes down: a mocks-on
   * Playwright spec asserts renders and client-side validation, never
   * mutations — "a mock mutation here would only prove the mock data source
   * resolves". Approving a payout is the single most consequential button in
   * the console; proving it works belongs in `e2e-live/`, against a real ledger.
   */
  approve: async () => {
    await mockDelay();
  },
  reject: async () => {
    await mockDelay();
  },
  config: () =>
    resolveMock(env.mockAdminFinanceState, adminFinanceConfigMock, adminFinanceConfigMock),
  updateConfig: async (patch) => {
    await mockDelay();
    return { ...adminFinanceConfigMock, ...patch };
  },

  transactions: async (query) => {
    const items = await resolveMock(env.mockAdminFinanceState, adminTransactionsMock, []);
    const probe = query.q?.toLowerCase();
    const filtered = items.filter((item) => {
      if (query.status && item.status !== query.status) return false;
      if (query.purpose && item.purpose !== query.purpose) return false;
      if (probe) {
        const haystack = [item.bookingCode, item.customerName ?? '', item.gatewayRef ?? '']
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(probe)) return false;
      }
      return true;
    });
    const start = (query.page - 1) * query.limit;
    return {
      items: filtered.slice(start, start + query.limit),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
    };
  },

  ledger: async (query) => {
    const all = await resolveMock(env.mockAdminFinanceState, adminLedgerMock, []);
    const filtered = all
      .filter((entry) => {
        if (query.ownerType && entry.ownerType !== query.ownerType) return false;
        if (query.type && entry.type !== query.type) return false;
        if (query.refId && entry.refId !== query.refId) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // The mock cursor is an OFFSET in disguise — enough to exercise the
    // backwards walk and the explicit exhaustion the API models.
    const start = query.cursor ? Number(query.cursor) : 0;
    const page = filtered.slice(start, start + query.limit);
    const nextStart = start + query.limit;
    return {
      items: page,
      nextCursor: nextStart < filtered.length ? String(nextStart) : null,
    };
  },

  refunds: async (query) => {
    const items = await resolveMock(env.mockAdminFinanceState, adminRefundsMock, []);
    const filtered = items.filter((item) => {
      if (query.status && item.status !== query.status) return false;
      if (query.kind && item.kind !== query.kind) return false;
      return true;
    });
    const start = (query.page - 1) * query.limit;
    return {
      items: filtered.slice(start, start + query.limit),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
    };
  },

  invariants: async () => {
    await mockDelay();
    return { ...adminInvariantsMock, checkedAt: new Date().toISOString() };
  },

  payoutSla: async (windowDays) => {
    await mockDelay();
    return { ...adminPayoutSlaMock, windowDays, generatedAt: new Date().toISOString() };
  },

  /**
   * Issuing a refund decides money — the mock REFUSES (house rule, same as the
   * bookings console): a mocked success would only prove the mock resolves.
   */
  issueRefund: async () => {
    await mockDelay();
    throw new Error(
      'Mocks are on — issuing a refund needs the real backend. Set NEXT_PUBLIC_USE_MOCKS=false.',
    );
  },
};

const restSource: AdminFinanceDataSource = {
  payouts: (query) => {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
      state: query.state,
    });
    if (query.ownerType) params.set('ownerType', query.ownerType);
    if (query.q) params.set('q', query.q);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    return adminApiFetch<AdminPayoutsListResponse>(`finance/payouts?${params.toString()}`);
  },

  approve: async (payoutId) => {
    // NO `Idempotency-Key`. `decideApproval` is a guarded UPDATE whose
    // zero-row result is a 409 — a stronger mechanism than a replayed cached
    // response, and one that tells a second admin their click did nothing
    // rather than pretending it succeeded.
    await adminApiFetch<unknown>(`finance/payouts/${payoutId}/approve`, { method: 'POST' });
  },

  reject: async (payoutId, reason) => {
    await adminApiFetch<unknown>(`finance/payouts/${payoutId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  config: () => adminApiFetch<AdminFinanceConfigDto>('finance/config'),

  updateConfig: (patch) =>
    adminApiFetch<AdminFinanceConfigDto>('finance/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  transactions: (query) => {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
    });
    if (query.status) params.set('status', query.status);
    if (query.purpose) params.set('purpose', query.purpose);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.q) params.set('q', query.q);
    return adminApiFetch<AdminTransactionsResponse>(`finance/transactions?${params.toString()}`);
  },

  ledger: (query) => {
    const params = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.ownerType) params.set('ownerType', query.ownerType);
    if (query.ownerId) params.set('ownerId', query.ownerId);
    if (query.type) params.set('type', query.type);
    if (query.refId) params.set('refId', query.refId);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    return adminApiFetch<AdminLedgerResponse>(`finance/ledger?${params.toString()}`);
  },

  refunds: (query) => {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
    });
    if (query.status) params.set('status', query.status);
    if (query.kind) params.set('kind', query.kind);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.q) params.set('q', query.q);
    return adminApiFetch<AdminRefundsResponse>(`finance/refunds?${params.toString()}`);
  },

  invariants: () => adminApiFetch<AdminInvariantsResponse>('finance/invariants'),

  payoutSla: (windowDays) =>
    adminApiFetch<AdminPayoutSlaResponse>(`finance/payouts/sla?windowDays=${windowDays}`),

  /**
   * The Idempotency-Key rides the BFF proxy's allowlist — the proxy forwards
   * `idempotency-key` upstream, and the API refuses the request without it.
   */
  issueRefund: (body, idempotencyKey) =>
    adminApiFetch<AdminRefundIssueResponse>('finance/refunds', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
};

export const adminFinanceDataSource: AdminFinanceDataSource = env.useMocks
  ? mockSource
  : restSource;
