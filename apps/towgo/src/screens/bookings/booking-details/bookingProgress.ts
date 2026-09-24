import type { JobStatus } from '@towing/api-contracts';
import type { MiTimelineRowState } from '@/design';
import { formatClock } from '@/features/booking/components/enter-location/format';
import { ACTIVE_BOOKING_STATUSES } from '@/features/bookings/types';
import type { BookingTrackingDisplay } from '@/screens/booking/tracking/trackingDisplay';
import { formatEta } from '@/utils/format';

/**
 * Figma 20 · Booking Details (`238:554`): the status card and the six-row booking
 * timeline, derived from the booking status.
 *
 * ONLY `en_route` IS DRAWN (rows 1–2 Done, row 3 Current, rows 4–6 Upcoming;
 * "Driver on the way" / "Arriving in 5 mins"). Every other status is mapped onto
 * the same six drawn rows by the rule below, and the status card uses short
 * wording parallel to the drawn copy. Both are flagged for the owner
 * (DATA-GAPS-20-21.md, gaps 2 and 3).
 */

/** Title#234:2 of the six Timeline Row instances `239:577`–`239:631`, VERBATIM and in order. */
export const TIMELINE_TITLES = [
  'Booking Confirmed',
  'Driver Assigned',
  'Driver on the way',
  'Arriving Soon',
  'Tow in Progress',
  'Completed',
] as const;

/** Time#234:10 of a step not reached yet: three U+002D, VERBATIM. */
export const NOT_REACHED = '---';

/**
 * The step each LIVE status is at, which is the Current row.
 *
 * - `searching` → Booking Confirmed (confirmed, no driver yet).
 * - `assigned` → Driver Assigned.
 * - `en_route` → Driver on the way (the drawn state).
 * - `arrived` → Arriving Soon. The contract has no "arriving" status, so this row
 *   becomes Current once the driver is at the pickup (owner decision, 19 Sep).
 * - `in_progress` → Tow in Progress.
 */
const CURRENT_STEP: Partial<Record<JobStatus, number>> = {
  searching: 0,
  assigned: 1,
  en_route: 2,
  arrived: 3,
  in_progress: 4,
};

export function isLiveStatus(status: JobStatus | undefined): boolean {
  return status !== undefined && ACTIVE_BOOKING_STATUSES.includes(status);
}

/**
 * The furthest step a FINISHED booking reached, from the instants the tracking
 * payload carries. `completed` and `paid` reached every step. A cancelled,
 * no-drivers or disputed booking reached as far as its latest instant.
 */
function lastReachedStep(status: JobStatus, tracking: BookingTrackingDisplay | undefined): number {
  if (status === 'completed' || status === 'paid') return 5;
  if (tracking?.completedAt) return 5;
  if (tracking?.startedAt) return 4;
  if (tracking?.arrivedAt) return 3;
  if (tracking?.enRouteAt) return 2;
  if (tracking?.assignedAt) return 1;
  return 0;
}

export type TimelineRow = {
  title: (typeof TIMELINE_TITLES)[number];
  state: MiTimelineRowState;
  /** Formatted `h:mm AM`, `---` for a step not reached, or `null` when the step's instant is unknown. */
  time: string | null;
};

function clock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : formatClock(date);
}

/**
 * The six drawn rows for a status.
 *
 * - Live statuses: rows before the current step are Done, the current step is
 *   Current, the rest Upcoming (as drawn for `en_route`).
 * - `completed` / `paid`: every row Done, none Current (the trip is over).
 * - `cancelled` / `no_drivers_found` / `disputed`: rows up to the last reached
 *   step Done, the rest Upcoming, none Current.
 *
 * Times: an Upcoming row reads "---" as drawn. A reached row shows the instant
 * its step began: Booking Confirmed = the booking's `createdAt`, Driver Assigned
 * = `assignedAt`, Driver on the way = `enRouteAt`, Arriving Soon = `arrivedAt`,
 * Tow in Progress = `startedAt`, Completed = `completedAt`. `enRouteAt` is the
 * app-local extension 19 uses: the contract has no such field (data gap 3a), so
 * on the live API that row holds its time slot with a placeholder bar, as does
 * any reached step whose instant is missing. Times are device-local.
 */
export function timelineRows(
  status: JobStatus,
  createdAt: string,
  tracking: BookingTrackingDisplay | undefined,
): TimelineRow[] {
  const current = CURRENT_STEP[status];
  const reached = current ?? lastReachedStep(status, tracking);
  const instants = [
    createdAt,
    tracking?.assignedAt,
    tracking?.enRouteAt,
    tracking?.arrivedAt,
    tracking?.startedAt,
    tracking?.completedAt,
  ];

  return TIMELINE_TITLES.map((title, index) => {
    let state: MiTimelineRowState;
    if (current !== undefined) {
      state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
    } else {
      state = index <= reached ? 'done' : 'upcoming';
    }
    return {
      title,
      state,
      time: state === 'upcoming' ? NOT_REACHED : clock(instants[index]),
    };
  });
}

/** Figma subtitle "Arriving in 5 mins": static "Arriving in " + count + " mins". */
export function arrivingIn(minutes: number): string {
  return `Arriving in ${formatEta(minutes)}`;
}

export type StatusCardCopy = {
  title: string;
  /** `null` = the ETA is not known yet; the card holds the line with a placeholder bar. */
  subtitle: string | null;
};

/**
 * Status card `239:567` (Info Banner): title and subtitle per status.
 *
 * Drawn: `en_route` "Driver on the way" / "Arriving in 5 mins". The title is the
 * Current timeline row's title, so `assigned` and `in_progress` follow that rule
 * and keep the drawn ETA subtitle (the ETA is to the pickup, then to the drop
 * once the tow starts, as the contract's `etaSeconds` says). `arrived` reuses 23
 * Driver Arrived's drawn heading VERBATIM. Everything else is short wording
 * parallel to the drawn copy, not from Figma, and flagged (DATA-GAPS-20-21.md, gap 2).
 */
export function statusCardCopy(status: JobStatus, etaMinutes: number | null): StatusCardCopy {
  const eta = etaMinutes === null ? null : arrivingIn(etaMinutes);
  switch (status) {
    case 'searching':
      return { title: 'Booking Confirmed', subtitle: 'Finding you a driver' };
    case 'assigned':
      return { title: 'Driver Assigned', subtitle: eta };
    case 'en_route':
      return { title: 'Driver on the way', subtitle: eta };
    case 'arrived':
      return { title: 'Driver has arrived', subtitle: 'Your driver is at the pickup location' };
    case 'in_progress':
      return { title: 'Tow in Progress', subtitle: eta };
    case 'completed':
      return { title: 'Completed', subtitle: 'Your tow is complete' };
    case 'paid':
      return { title: 'Completed', subtitle: 'Payment received' };
    case 'cancelled':
      return { title: 'Cancelled', subtitle: 'This booking was cancelled' };
    case 'no_drivers_found':
      return { title: 'No tow trucks nearby', subtitle: 'This booking has ended' };
    case 'disputed':
    default:
      return { title: 'Under review', subtitle: 'Our team is looking into this trip' };
  }
}
