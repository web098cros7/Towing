import type { SupportTicketStatus } from '@towing/api-contracts';
import type { StatusTone } from '@towing/ui';

/**
 * How a requester should READ a ticket status.
 *
 * Deliberately kinder than the console's vocabulary: `pending_requester` is
 * "Waiting on you" here and "Waiting" there, because from the requester's side
 * of the conversation it is an instruction, not a state.
 */
export const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: 'Raised',
  in_progress: 'We are on it',
  pending_requester: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const STATUS_TONE: Record<SupportTicketStatus, StatusTone> = {
  open: 'info',
  in_progress: 'info',
  pending_requester: 'warning',
  resolved: 'success',
  closed: 'neutral',
};
