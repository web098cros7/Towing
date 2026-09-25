import type {
  SupportTicketCreateRequest,
  SupportTicketCreateResponse,
  SupportTicketDetail,
  SupportTicketsResponse,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import { supportMockSource } from './supportMockSource';
import { supportRestSource } from './supportRestSource';

/**
 * W15's support rail (§9.4.12) — raise a ticket, read your tickets, answer.
 *
 * The identity is derived server-side from the JWT: the app never sends who it
 * is, only what happened. Public replies only — the requester rail has no
 * vocabulary for an internal note, and `SupportTicketDetail.messages` carries
 * public rows alone.
 */
export interface SupportDataSource {
  list(): Promise<SupportTicketsResponse>;
  detail(ticketId: string): Promise<SupportTicketDetail>;
  create(input: SupportTicketCreateRequest): Promise<SupportTicketCreateResponse>;
  reply(ticketId: string, body: string): Promise<SupportTicketDetail>;
  /** The requester ends the conversation ("End chat"): the ticket becomes `resolved`. */
  resolve(ticketId: string): Promise<SupportTicketDetail>;
  presignAttachment(): Promise<{ uploadUrl: string; key: string; expiresAt: string }>;
}

export const supportDataSource: SupportDataSource = env.useMocks
  ? supportMockSource
  : supportRestSource;
