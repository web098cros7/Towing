import type { PayoutsListResponse, SplitsListResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { earningsEmptyMock, earningsMock, payoutsMock, splitsMock } from '../mocks/earnings.mock';
import type { DateRange, EarningsSummary, JobSplit, Payout, SplitsFilter } from '../types';

/**
 * Un-pinned in Phase 7. This was the last feature holding
 * `export const earningsDataSource = mockSource` regardless of
 * `NEXT_PUBLIC_USE_MOCKS`, because the earnings API did not exist yet.
 *
 * Three methods where there was one: the KPIs come from the `earnings_daily`
 * projection, the split feed is a keyset page over the ledger, and payouts are
 * their own paged resource. One fat aggregate would have let the slowest of the
 * three gate the whole screen.
 */
export interface EarningsDataSource {
  getSummary(range: DateRange): Promise<EarningsSummary>;
  listSplits(filter: SplitsFilter): Promise<JobSplit[]>;
  listPayouts(): Promise<Payout[]>;
  /**
   * The idempotency key is a PARAMETER, not something this function mints —
   * so it can be created once per user intent by the caller and survive a
   * retry. See `useRequestPayout`.
   */
  requestPayout(input: { amountPaise: number }, idempotencyKey: string): Promise<Payout>;
}

const mockSource: EarningsDataSource = {
  getSummary: () => resolveMock(env.mockEarningsState, earningsMock, earningsEmptyMock),
  listSplits: () => resolveMock(env.mockEarningsState, splitsMock, [] as JobSplit[]),
  listPayouts: () => resolveMock(env.mockEarningsState, payoutsMock, [] as Payout[]),
  requestPayout: async (input, _idempotencyKey) => {
    await mockDelay();
    return {
      id: `po-mock-${Date.now()}`,
      amountPaise: input.amountPaise,
      status: 'requested',
      // §14.4's threshold, mirrored so the queue branch is reachable here too.
      approvalState: input.amountPaise > 10_000_000 ? 'pending_approval' : 'auto_approved',
      rejectionReason: null,
      requestedAt: new Date().toISOString(),
      paidAt: null,
      providerRef: null,
      failureReason: null,
    };
  },
};

const restSource: EarningsDataSource = {
  getSummary: (range) => apiFetch<EarningsSummary>(`earnings${qs(range)}`),
  listSplits: async (filter) =>
    (await apiFetch<SplitsListResponse>(`earnings/split${qs({ ...filter, limit: '50' })}`)).items,
  listPayouts: async () => (await apiFetch<PayoutsListResponse>('payouts?page=1&limit=20')).items,
  requestPayout: (input, idempotencyKey) =>
    apiFetch<Payout>('payouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
};

export const earningsDataSource: EarningsDataSource = env.useMocks ? mockSource : restSource;

/** §9.3.7's monthly statement — the `jobsExportUrl` pattern, a plain download link. */
export function statementCsvUrl(month: string): string {
  return `/api/proxy/earnings/statement.csv?month=${encodeURIComponent(month)}`;
}

function qs(params: Partial<Record<string, string | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}
