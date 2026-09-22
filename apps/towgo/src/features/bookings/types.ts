import type { ImageSourcePropType } from 'react-native';
import type { GeoPoint, JobStatus } from '@towing/api-contracts';

/**
 * The §5.1 statuses, exactly the ten the server can return.
 *
 * `'scheduled'` USED TO BE AN ELEVENTH VALUE HERE and was removed in Phase 15.
 * It was local-only — no `booking_status` enum value, no §5.1 state, nothing
 * that could ever arrive over the wire — so the display map carried a branch
 * that could not execute while the real statuses had to be handled anyway. A
 * scheduled trip is `searching` with a future `scheduledAt`, and the badge is
 * derived from that (`isScheduled` below).
 */
export type BookingStatus = JobStatus;

/** Origin-dot accent — maps to a theme color in the card. */
export type RouteTone = 'success' | 'info';

export type Booking = {
  id: string;
  /** Human-readable reference, e.g. `TW-3F9A21B4`. Server-assigned. */
  reference: string;
  /**
   * The booked service's `services.slug` (`car_tow`, `battery`, ...), the contract's
   * `serviceSlug`. 27 and 30 name the service from it (`serviceTitle`,
   * features/services/data/serviceTitles.ts).
   */
  serviceSlug: string;
  originLabel: string;
  destinationLabel: string;
  /**
   * Where the two labels are on the map: the contract's `pickup` / `drop`. No
   * screen draws them; 10's recent places reuse them to put a past trip's
   * addresses back on the map. Optional because the mock fixtures carry none;
   * `dropPoint` is also null for a roadside job with no drop.
   */
  pickupPoint?: GeoPoint | null;
  dropPoint?: GeoPoint | null;
  /**
   * ISO 8601, not the pre-formatted `date`/`time` pair this used to carry.
   * Phase 12 corrected the contract this way and deferred the booking feature's
   * own fields to "their own phases (15 bookings)"; formatting is the view's
   * job, and a server that hands out "17 May 2024" cannot be localised.
   */
  createdAt: string;
  /** Future-dated when the customer chose "later"; null for an immediate tow. */
  scheduledAt: string | null;
  status: BookingStatus;
  /**
   * INTEGER PAISE, not rupees. The whole API speaks paise (`formatPaise`), and
   * `formatINR` on a paise value misreports by 100× — which is exactly the bug
   * `utils/format.ts` carries a warning about.
   */
  farePaise: number;
  routeTone: RouteTone;
  /** Server-sourced, so a URL or nothing — never a bundled `require()`. */
  truckImage: string | null;
  /** Null until a driver is assigned (§9.1.7 forbids identity before then). */
  vehiclePlate: string | null;
  driverName: string | null;
  driverRating: number | null;
};

/** A trip the customer still has in flight — §9.1.10's "active trip card". */
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  'searching',
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
];

export function isActiveBooking(booking: Pick<Booking, 'status'>): boolean {
  return ACTIVE_BOOKING_STATUSES.includes(booking.status);
}

/** §9.1.5's "later" — a badge, not a status. */
export function isScheduled(booking: Pick<Booking, 'scheduledAt'>): boolean {
  return booking.scheduledAt !== null && new Date(booking.scheduledAt).getTime() > Date.now();
}

/**
 * How the trip was paid for. Booking-local on purpose, distinct from the
 * account's `PaymentKind` (saved instruments). Cash is now settled by the
 * driver's "cash collected" confirmation rather than through a saved
 * instrument, so it is a supported method alongside the instrument-backed
 * ones.
 */
export type BookingPaymentMethod = 'card' | 'upi' | 'wallet' | 'cash';

/**
 * Detail payload — what `GET /bookings/:id` returns: every list field plus the
 * fields only the details screen renders. `GET /bookings` keeps returning `Booking`.
 */
export type BookingDetail = Booking & {
  /** Server-computed billed distance. Null for flat-rated roadside jobs. */
  distanceKm: number | null;
  /** The §7 line items behind the total, all in paise. */
  breakdown: {
    basePaise: number;
    nightPaise: number;
    highwayPaise: number;
    accidentPaise: number;
    surgePaise: number;
    discountPaise: number;
    totalPaise: number;
  };
  note: string | null;
  contactName: string | null;
  contactMobile: string | null;
  cancellationReason: string | null;
  cancellationFeePaise: number;
  /** §9.1.7 — whether the OTP card should be shown at all. */
  otpAvailable: boolean;
  /**
   * §6.4 wave state while the booking is searching, `null` otherwise (Phase 17).
   *
   * §19.2's polling half of §9.1.6's "no fake progress": the `/customer` socket
   * pushes the same numbers the instant a wave advances, and this carries them
   * for a client whose socket never connected. `useSearchProgress` takes
   * whichever is fresher.
   */
  search: {
    wave: number;
    radiusKm: number;
    /** Cumulative across waves — a count that reset would read as progress lost. */
    driversContacted: number;
    deadlineAt: string | null;
  } | null;
  paymentMethod: BookingPaymentMethod | null;
  /** Server-sourced; a URL or nothing. */
  driverPhoto: string | null;
  driverTrips: number | null;
  /** ISO instant the payment was captured; null until then. */
  paidAt: string | null;
  /** ISO instant the driver was assigned; null until then. */
  assignedAt: string | null;
  /** ISO instant the driver set off; null until then. */
  enRouteAt: string | null;
  /** ISO instant the driver reached the pickup; null until then. */
  arrivedAt: string | null;
  /** ISO instant the tow started; null until then. */
  startedAt: string | null;
  /** ISO instant the truck reached the drop; null until then. */
  completedAt: string | null;
  /**
   * Minutes from `startedAt` to `completedAt`; null until both exist.
   * 45 -> formatEta(45) === "45 mins".
   */
  durationMinutes: number | null;
  /** Bundled artwork for the chosen duty class stays a local lookup, not a field. */
  towTypeId?: never;
};

/** Kept for the one screen that still renders bundled artwork by duty class. */
export type BookingTruckArtwork = ImageSourcePropType;
