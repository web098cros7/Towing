import type {
  AdminFinanceConfigDto,
  AdminPayoutsListResponse,
  AdminPayoutsQuery,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { adminFinanceConfigMock, adminPayoutsMock } from '../mocks/adminFinance.mock';

export interface AdminFinanceDataSource {
  payouts(query: AdminPayoutsQuery): Promise<AdminPayoutsListResponse>;
  approve(payoutId: string): Promise<void>;
  reject(payoutId: string, reason: string): Promise<void>;
  config(): Promise<AdminFinanceConfigDto>;
  updateConfig(patch: Partial<AdminFinanceConfigDto>): Promise<AdminFinanceConfigDto>;
}

const mockSource: AdminFinanceDataSource = {
  payouts: async (query) => {
    const items = await resolveMock(env.mockAdminFinanceState, adminPayoutsMock, []);
    const filtered =
      query.state === 'all' ? items : items.filter((item) => item.approvalState === query.state);
    return { items: filtered, page: query.page, limit: query.limit, total: filtered.length };
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
  config: () => resolveMock(env.mockAdminFinanceState, adminFinanceConfigMock, adminFinanceConfigMock),
  updateConfig: async (patch) => {
    await mockDelay();
    return { ...adminFinanceConfigMock, ...patch };
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
};

export const adminFinanceDataSource: AdminFinanceDataSource = env.useMocks ? mockSource : restSource;
