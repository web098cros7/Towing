import type { IconComponent, StatusTone } from '@towing/ui';
import { CalendarClock, CircleCheck, CircleX, Clock, Search, Truck, Navigation, MapPin, Receipt, X, CircleHelp } from '@/icons';
import type { BookingStatus } from './types';

/**
 * Pill label + tone per booking status — shared by the list card and details.
 * `icon` is only rendered by the details card's pill; the list card reads
 * `label`/`tone` and ignores it.
 *
 * ELEVEN ENTRIES, matching `jobStatusSchema` exactly. Another, `scheduled`,
 * lived here until Phase 15 and could never be reached: no such
 * `booking_status` value exists, so no server could ever send it. §9.1.5's
 * "later" is now a badge derived from `scheduledAt` (`isScheduled`), which is
 * what it always was.
 */
export const STATUS_META: Record<
  BookingStatus,
  { label: string; tone: StatusTone; icon: IconComponent }
> = {
  searching: { label: 'Searching', tone: 'info', icon: Search },
  assigned: { label: 'Driver Assigned', tone: 'info', icon: Truck },
  en_route: { label: 'On the Way', tone: 'info', icon: Navigation },
  arrived: { label: 'Driver Arrived', tone: 'info', icon: MapPin },
  in_progress: { label: 'In progress', tone: 'info', icon: Clock },
  completed: { label: 'Completed', tone: 'success', icon: CircleCheck },
  paid: { label: 'Paid', tone: 'success', icon: Receipt },
  cancelled: { label: 'Cancelled', tone: 'error', icon: CircleX },
  no_drivers_found: { label: 'No Drivers Found', tone: 'error', icon: X },
  disputed: { label: 'Disputed', tone: 'warning', icon: CircleHelp },
  // Not an error from the customer's side — they have their money back — so
  // neutral rather than red. `Receipt` is deliberate: it is still a trip with
  // a bill, just one that was reversed.
  refunded: { label: 'Refunded', tone: 'neutral', icon: Receipt },
};

/** §9.1.5's "later", rendered beside the status rather than instead of it. */
export const SCHEDULED_META = { label: 'Scheduled', tone: 'info' as StatusTone, icon: CalendarClock };
