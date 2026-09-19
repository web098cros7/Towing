import type { BookingTracking, JobStatus, TrackedDriver } from '@towing/api-contracts';
import { towMethodLabelFor } from '@/features/booking/data/towTypes.data';

/**
 * App-local, OPTIONAL extension of the tracked driver (Figma 18 · Driver En Route).
 *
 * The Vehicle Card draws "Tata 407 (Flatbed)" (`<make> <model> (<body type>)`).
 * `trackedDriverSchema` carries only `vehicleClass`, which gives the body type;
 * the make and model have no field in the contract yet (data gap). The mock
 * source fills these two, the live API leaves them absent, and the card then
 * keeps the model line's slot with a placeholder bar rather than rewording it.
 */
export type TrackedDriverDisplay = TrackedDriver & {
  /** e.g. "Tata". */
  vehicleMake?: string | null;
  /** e.g. "407". */
  vehicleModel?: string | null;
};

/**
 * App-local, OPTIONAL extension of the tracking payload (Figma 19 · Driver
 * Arriving). 19's timeline draws "Driver on the way" with the time the driver
 * set off (`assigned → en_route`), and `bookingTrackingSchema` has no field for
 * it: the server keeps it only in `booking_status_history` (data gap). The mock
 * fills it; the live API leaves it absent and the row keeps its time slot with
 * a placeholder bar. `assignedAt` is NOT a stand-in: 20 draws "Driver Assigned"
 * and "Driver on the way" as two separate times.
 */
export type BookingTrackingDisplay = BookingTracking & {
  /** ISO instant the booking entered `en_route`. */
  enRouteAt?: string | null;
};

/**
 * Which rebuilt design the Tracking screen draws for a status:
 * - `enRoute18`  Figma 18 · Driver En Route: `assigned`, and the first read (no status yet);
 * - `arriving19` Figma 19 · Driver Arriving: `en_route` (the backend's own "arriving"
 *                step is derived from the driver moving off, `EnRouteWatcher`);
 * - `arrived23`  Figma 23 · Driver Arrived: `arrived` (24 Collection Code is an
 *                in-screen step of it, opened by "Confirm Pickup");
 * - `legacy`     in progress, completed, paid, cancelled: the pre-redesign sheet
 *                until 25 onwards are rebuilt.
 */
export type TrackingDesign = 'enRoute18' | 'arriving19' | 'arrived23' | 'legacy';

export function trackingDesignFor(status: JobStatus | undefined): TrackingDesign {
  if (status === undefined || status === 'assigned') return 'enRoute18';
  if (status === 'en_route') return 'arriving19';
  if (status === 'arrived') return 'arrived23';
  return 'legacy';
}

/**
 * The driver's first name, for 24's "Rakesh is here" and "Share this code so
 * Rakesh can start your tow.": the first whitespace-separated word of `name`
 * (the contract has no first-name field; owner decision, data gap).
 */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * A clock time as the design draws it, "10:12 AM": 12-hour, no leading zero, a
 * normal space, AM / PM in capitals, device-local. Formatted by hand, because
 * Hermes' `toLocaleTimeString` can give "am" (en-IN) or a narrow no-break space.
 */
export function clockLabel(epochMs: number): string {
  const date = new Date(epochMs);
  const h24 = date.getHours();
  const h = h24 % 12 || 12;
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * The "<count>+" of "4.8 (500+ trips)". The design draws only the bucketed form,
 * so every count keeps the "+": hundreds from 100, tens from 10, the count itself
 * below that (a driver with 7 trips has at least 7).
 */
export function tripsLabel(trips: number): string {
  if (trips >= 100) return `${Math.floor(trips / 100) * 100}+`;
  if (trips >= 10) return `${Math.floor(trips / 10) * 10}+`;
  return `${trips}+`;
}

/**
 * Figma "4.8 (500+ trips)": `<rating 1 dp> (<count>+ trips)`, always both parts.
 * An unrated driver has no number to put in the drawn format, so the slot is
 * `null` and the row shows its placeholder (data gap: unrated-driver copy).
 */
export function ratingLabel(rating: number | null, trips: number): string | null {
  if (rating === null) return null;
  return `${rating.toFixed(1)} (${tripsLabel(trips)} trips)`;
}

/**
 * Figma "Tata 407 (Flatbed)". The body type comes from the contract's
 * `vehicleClass`; the make and model only from the app-local extension above.
 * When any of the three is missing the drawn format cannot be filled, so `null`.
 */
export function vehicleModelLabel(driver: TrackedDriverDisplay | null): string | null {
  const make = driver?.vehicleMake?.trim();
  const model = driver?.vehicleModel?.trim();
  if (!driver?.vehicleClass || !make || !model) return null;
  return `${make} ${model} (${towMethodLabelFor(driver.vehicleClass)})`;
}

/** Figma "KA 01 AB 1234"; `null` when the server has no plate yet. */
export function vehiclePlateLabel(driver: TrackedDriverDisplay | null): string | null {
  return driver?.vehiclePlate?.trim() || null;
}

export function displayDriver(tracking: BookingTracking | undefined): TrackedDriverDisplay | null {
  return (tracking?.driver as TrackedDriverDisplay | null | undefined) ?? null;
}
