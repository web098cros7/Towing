import type {
  AdminSupportTicket,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@towing/api-contracts';
import type { StatusTone } from '@towing/web-ui';

/**
 * W15's first-response SLA, in one place because the queue and the thread must
 * agree about what "overdue" means (§9.4.12's response targets).
 *
 * The clock is the FIRST public response, not the last: a thread that has been
 * answered and is waiting on the requester is `pending_requester`'s job, and
 * `firstResponseAt` is the stamp the backend writes when an admin replies.
 */
export const SLA_TARGET_HOURS: Record<SupportTicketPriority, number> = {
  urgent: 1,
  high: 4,
  normal: 24,
  low: 72,
};

export type SlaState =
  | { kind: 'awaiting'; overdue: boolean; dueInHours: number }
  | { kind: 'answered'; hours: number }
  | { kind: 'finished' };

export function slaState(ticket: AdminSupportTicket, now = Date.now()): SlaState {
  if (ticket.status === 'resolved' || ticket.status === 'closed') return { kind: 'finished' };

  if (ticket.firstResponseAt) {
    const hours = (Date.parse(ticket.firstResponseAt) - Date.parse(ticket.createdAt)) / 3_600_000;
    return { kind: 'answered', hours };
  }

  const dueAt = Date.parse(ticket.createdAt) + SLA_TARGET_HOURS[ticket.priority] * 3_600_000;
  const dueInHours = (dueAt - now) / 3_600_000;
  return { kind: 'awaiting', overdue: dueInHours < 0, dueInHours };
}

export const SUPPORT_STATUS_TONE: Record<SupportTicketStatus, StatusTone> = {
  // `open` is the one that needs a human, so it is the loud one.
  open: 'error',
  in_progress: 'info',
  pending_requester: 'warning',
  resolved: 'success',
  closed: 'neutral',
};

export const SUPPORT_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  pending_requester: 'Waiting on requester',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const SUPPORT_PRIORITY_LABEL: Record<SupportTicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** `/admin/users/:id` or `/admin/drivers/list/:id` — wherever the console can show this person. */
export function requesterHref(ticket: AdminSupportTicket): string {
  if (ticket.requesterType === 'user') return `/admin/users/${ticket.requesterId}`;
  if (ticket.requesterType === 'driver') return `/admin/drivers/list/${ticket.requesterId}`;
  return `/admin/fleets/${ticket.requesterId}`;
}
