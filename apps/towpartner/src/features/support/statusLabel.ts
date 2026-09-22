import type { StatusTone } from '@towing/ui';
import type { SupportTicketStatus } from '@towing/api-contracts';

/**
 * The driver-facing label per ticket status.
 *
 * `pending_requester` is the one that earns its keep: the contract's name is
 * written for the agent's queue, and a driver reading "Pending requester" has
 * to work out that the requester is them. "Waiting for you" says it.
 */
export const SUPPORT_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: 'Open',
  pending_requester: 'Waiting for you',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

/**
 * `SupportTicketStatus` → `StatusTone`, for `StatusBadge`.
 *
 * The same five semantic tones the jobs surface maps into, so a resolved ticket
 * and a paid job read as the same kind of green. `pending_requester` is the
 * warning tone because it is the one status that asks the driver to act.
 */
export function supportStatusTone(status: SupportTicketStatus): StatusTone {
  switch (status) {
    case 'resolved':
    case 'closed':
      return 'success';
    case 'pending_requester':
      return 'warning';
    default:
      return 'info';
  }
}
