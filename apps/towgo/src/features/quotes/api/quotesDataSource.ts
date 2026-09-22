import type {
  Quote,
  QuoteAcceptResponse,
  QuoteRequest,
  QuotesResponse,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import { quotesMockSource } from './quotesMockSource';
import { quotesRestSource } from './quotesRestSource';

/**
 * The manual-quote lane (§7.3, W20).
 *
 * The estimate route refuses >600 km with `manual_quote_required`; THIS is the
 * app's answer to that refusal. A request is filed with the trip the customer
 * already configured, an operator prices it, and accepting turns the written
 * number into a booking — the same booking the confirm button would have made,
 * at the price a human committed to.
 */
export interface QuotesDataSource {
  list(): Promise<QuotesResponse>;
  request(body: QuoteRequest): Promise<Quote>;
  /** Creates the booking. Idempotent server-side per quote; the screen navigates on `booking.id`. */
  accept(id: string): Promise<QuoteAcceptResponse>;
}

export const quotesDataSource: QuotesDataSource = env.useMocks
  ? quotesMockSource
  : quotesRestSource;
