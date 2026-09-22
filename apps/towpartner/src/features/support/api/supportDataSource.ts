import type {
  SupportTicketCreateRequest,
  SupportTicketDetail,
  SupportTicketSummary,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import { supportMockSource } from './supportMockSource';
import { supportRestSource } from './supportRestSource';

/**
 * The driver app's half of the shared support-ticket API.
 *
 * The same routes the customer app and the admin console use — a driver's
 * request lands in the same queue an agent already watches, which is the point:
 * a second, driver-only inbox would be a second place for a reply to get lost.
 */
export interface SupportDataSource {
  list(): Promise<SupportTicketSummary[]>;
  get(id: string): Promise<SupportTicketDetail>;
  create(input: SupportTicketCreateRequest): Promise<{ ticketId: string; reference: string }>;
  reply(id: string, body: string): Promise<void>;
}

export const supportDataSource: SupportDataSource = env.useMocks
  ? supportMockSource
  : supportRestSource;
