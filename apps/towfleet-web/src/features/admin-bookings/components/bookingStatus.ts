import type { JobStatus } from '@towing/api-contracts';
import type { StatusTone } from '@towing/web-ui';

/**
 * Status → tone, once, for every W8 surface. `disputed` is amber rather than
 * red on purpose: it is a live exception someone is working, not a failure —
 * the same reasoning the payout queue uses for `pending_approval`.
 */
export const BOOKING_STATUS_TONES: Record<JobStatus, StatusTone> = {
  searching: 'info',
  no_drivers_found: 'warning',
  assigned: 'brand',
  en_route: 'brand',
  arrived: 'brand',
  in_progress: 'info',
  completed: 'warning',
  paid: 'success',
  cancelled: 'neutral',
  disputed: 'warning',
  // Neutral, not a warning: a refund is a closed decision, and colouring it
  // amber would put it back in the pile of things somebody still has to work.
  refunded: 'neutral',
};

/** The list's one-click "live problems" chip (§9.4.7). */
export const LIVE_PROBLEM_STATUSES: JobStatus[] = ['searching', 'no_drivers_found'];

/** Statuses the admin cancel accepts — pre-payment only (the service 409s past
 * them, pointing at the dispute route; the UI does not offer what it refuses). */
export const CANCELABLE_STATUSES: JobStatus[] = [
  'searching',
  'no_drivers_found',
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
];

/** Statuses where a reassign makes sense (a driver is holding the job). */
export const REASSIGNABLE_STATUSES: JobStatus[] = ['assigned', 'en_route', 'arrived'];

/** The three origins a dispute can open from (§5.6's exit table). */
export const DISPUTABLE_STATUSES: JobStatus[] = ['in_progress', 'completed', 'paid'];

export const DISPUTE_REASON_LABELS: Record<string, string> = {
  service_not_completed: 'Service not completed',
  vehicle_damage: 'Vehicle damage',
  overcharge: 'Overcharge',
  driver_conduct: 'Driver conduct',
  customer_conduct: 'Customer conduct',
  payment_issue: 'Payment issue',
  unable_to_deliver: 'Unable to deliver',
  other: 'Other',
};
