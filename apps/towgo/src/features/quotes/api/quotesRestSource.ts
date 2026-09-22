import type { Quote, QuoteAcceptResponse, QuoteRequest, QuotesResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { QuotesDataSource } from './quotesDataSource';

export const quotesRestSource: QuotesDataSource = {
  list: () => apiFetch<QuotesResponse>('quotes'),
  request: (body: QuoteRequest) =>
    apiFetch<Quote>('quotes', { method: 'POST', body: JSON.stringify(body) }),
  /**
   * `idempotent: true` — the server's accept is guarded by a conditional
   * status update (one winner), and the minted key makes a retried tap the SAME
   * attempt rather than a second one racing the first.
   */
  accept: (id: string) =>
    apiFetch<QuoteAcceptResponse>(`quotes/${id}/accept`, {
      method: 'POST',
      idempotent: true,
      body: JSON.stringify({}),
    }),
};
