import type {
  AdminQuote,
  AdminQuoteDecision,
  AdminQuoteReject,
  AdminQuotesQuery,
  AdminQuotesResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  mockAdminQuote,
  mockAdminQuotes,
  mockQuoteDecision,
  rememberQuoteTransition,
} from '../mocks/adminQuotes.mock';

/**
 * W20's manual-quote queue (§7.3).
 *
 * The three writes are state transitions on one row, and the mock remembers
 * them for the session so the e2e can walk price → accept-ready → expire
 * against a screen that actually changes.
 */
export interface AdminQuotesDataSource {
  list(query: AdminQuotesQuery): Promise<AdminQuotesResponse>;
  detail(id: string): Promise<AdminQuote>;
  quote(id: string, body: AdminQuoteDecision): Promise<AdminQuote>;
  reject(id: string, body: AdminQuoteReject): Promise<AdminQuote>;
  expire(id: string): Promise<AdminQuote>;
}

const mockSource: AdminQuotesDataSource = {
  list: async (query) => {
    await mockDelay(200);
    return resolveMock(env.mockAdminQuotesState, mockAdminQuotes(query), {
      items: [],
      page: query.page,
      limit: query.limit,
      total: 0,
    });
  },
  detail: async (id) => {
    await mockDelay(150);
    return mockAdminQuote(id);
  },
  quote: async (id, body) => {
    await mockDelay(400);
    return mockQuoteDecision(id, body);
  },
  reject: async (id, body) => {
    await mockDelay(300);
    return rememberQuoteTransition(id, {
      status: 'rejected',
      rejectionReason: body.reason,
      decidedAt: new Date().toISOString(),
    });
  },
  expire: async (id) => {
    await mockDelay(300);
    return rememberQuoteTransition(id, {
      status: 'expired',
      decidedAt: new Date().toISOString(),
    });
  },
};

const restSource: AdminQuotesDataSource = {
  list: (query) => {
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
    if (query.status) params.set('status', query.status);
    return adminApiFetch<AdminQuotesResponse>(`quotes?${params.toString()}`);
  },
  detail: (id) => adminApiFetch<AdminQuote>(`quotes/${id}`),
  quote: (id, body) =>
    adminApiFetch<AdminQuote>(`quotes/${id}/quote`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reject: (id, body) =>
    adminApiFetch<AdminQuote>(`quotes/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  expire: (id) =>
    adminApiFetch<AdminQuote>(`quotes/${id}/expire`, { method: 'POST', body: JSON.stringify({}) }),
};

export const adminQuotesDataSource: AdminQuotesDataSource = env.useMocks ? mockSource : restSource;
