import type { BookingDetail } from '@/features/bookings/types';
import { PAYMENT_METHOD_LABEL } from '@/features/payments/labels';
import type { PaymentMethodKind } from '@/features/payments/types';
import { mockTripPhase, hasMockMatch } from '@/features/tracking/api/mockTripClock';
import { env } from '@/lib/env';
import {
  clockLabel,
  type BookingTrackingDisplay,
} from '@/screens/booking/tracking/trackingDisplay';
import { paidAtLabel } from '@/screens/payment/paymentDisplay';
import { formatEta } from '@/utils/format';

/**
 * Figma 35 · Completed Trip Details (`243:929`): the values it draws, derived from the booking
 * and the tracking payload 20 already reads. Pure functions, so the screen file stays layout.
 *
 * WHERE EACH DRAWN VALUE COMES FROM
 * - Trip window "10:15 AM – 10:50 AM" and "Total Time 35 mins": the tow's own two instants,
 *   `startedAt` and `completedAt` — the same fields 20's timeline reads for "Tow in Progress"
 *   and "Completed" (`booking-details/bookingProgress.ts`), so the two screens agree on every
 *   clock time.
 * - The two stop titles: the booking's address labels, which is what 20's Locations card prints
 *   as its Pickup and Drop values, so the two screens agree word for word.
 * - "Paid via UPI": `BookingDetail.paymentMethod`. On the live API this is null (the contract
 *   carries no such field — see `bookingsRestSource`), so the row keeps its drawn line with a
 *   placeholder bar rather than naming a method nobody told us.
 * - "12 Mar 2025, 10:52 AM": `paidAtLabel`, 30's own formatter, over an instant that has no
 *   contract field at all (see `paidAtFor`).
 */

/** The two instants 35's meta row is built from, straight off the tracking payload. */
export type TripStamps = {
  /** When the tow started (`arrived → in_progress`); null before that. */
  startedAt: string | null;
  /** When it finished (`in_progress → completed`); null before that. */
  completedAt: string | null;
};

export function tripStamps(tracking: BookingTrackingDisplay | undefined): TripStamps {
  return {
    startedAt: tracking?.startedAt ?? null,
    completedAt: tracking?.completedAt ?? null,
  };
}

/** An ISO instant as "10:15 AM", or null for a missing or unreadable one. */
function clock(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : clockLabel(ms);
}

export const startedClock = (stamps: TripStamps) => clock(stamps.startedAt);
export const completedClock = (stamps: TripStamps) => clock(stamps.completedAt);

/**
 * "12 Mar 2025" — the tow's day, taken from `startedAt` through 30's date formatter. ONE
 * instant for the whole row: the design draws a single date slot, so a tow that ran either
 * side of midnight is reported by the day it began.
 */
export function tripDateLabel(stamps: TripStamps): string | null {
  const full = stamps.startedAt ? paidAtLabel(stamps.startedAt) : null;
  return full?.split(',')[0] ?? null;
}

/**
 * "10:15 AM – 10:50 AM" — U+2013 EN DASH with a U+0020 space either side, verbatim. Null until
 * BOTH ends are known: half a window is not a window, and the drawn slot holds its bar instead.
 */
export function tripWindowLabel(stamps: TripStamps): string | null {
  const from = startedClock(stamps);
  const to = completedClock(stamps);
  return from && to ? `${from} \u2013 ${to}` : null;
}

/**
 * "35 mins" — whole minutes from start to completion, floored so a 35.9-minute tow claims 35
 * rather than a minute that has not passed. Null when either instant is missing or the pair is
 * out of order, so the slot keeps its bar.
 */
export function tripDurationLabel(stamps: TripStamps): string | null {
  if (!stamps.startedAt || !stamps.completedAt) return null;
  const from = Date.parse(stamps.startedAt);
  const to = Date.parse(stamps.completedAt);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return formatEta(Math.floor((to - from) / 60_000));
}

/**
 * A stop title from the booking's own label. The REST mapper stands U+2014 EM DASH in for an
 * address the server does not have (`bookingsRestSource`); that dash is not copy 35 draws, so
 * it reads as missing and the row shows a placeholder.
 */
export function stopTitle(label: string | null | undefined): string | null {
  const trimmed = label?.trim();
  return trimmed && trimmed !== '\u2014' ? trimmed : null;
}

/**
 * 35's Payment Details row title: "Paid via " then the method's label from
 * `features/payments/labels.ts` — the SAME string 27's rows and 30's "Payment Method" show, so
 * the three screens name a method identically. Null when the method is unknown.
 */
export function paidViaLabel(method: PaymentMethodKind | null): string | null {
  return method ? `Paid via ${PAYMENT_METHOD_LABEL[method]}` : null;
}

/** The method's own colour icon, the glyphs 27's rows and 30 draw. */
export function methodIconName(method: PaymentMethodKind) {
  return method;
}

/**
 * The instant the trip was paid, as "12 Mar 2025, 10:52 AM".
 *
 * The booking detail now carries `paidAt` (the server persists it when the payment
 * is captured), so the live API reads it straight off the booking. In test mode
 * the mock trip clock records the instant `paymentsMockSource.capture` ran for
 * that booking — the same clock 20 and 33 read for the status — and is used when
 * the booking has no `paidAt`.
 */
export function paidAtFor(booking: BookingDetail): string | null {
  if (booking.paidAt) return booking.paidAt;
  if (!env.useMocks) return null;
  // `hasMockMatch` first, deliberately: `mockTripPhase` STARTS a clock for a booking it has
  // never seen, so reading a fixture through it would set side-effect state.
  if (!hasMockMatch(booking.id)) return null;
  const at = mockTripPhase(booking.id).paidAt;
  return at === null ? null : new Date(at).toISOString();
}

/**
 * The booking's method, or null when the server did not say. The booking's
 * `paymentMethod` may be 'cash', which maps to the 'cash' kind the app's
 * `PaymentMethodKind` already includes.
 */
export function bookingMethod(booking: BookingDetail | undefined): PaymentMethodKind | null {
  const method = booking?.paymentMethod;
  if (!method) return null;
  if (method === 'cash') return 'cash';
  return method;
}
