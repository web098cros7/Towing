import type { BookingTracking, JobStatus, TrackedDriver } from '@towing/api-contracts';
import { towMethodLabelFor } from '@/features/booking/data/towTypes.data';

/**
 * The tracked driver, as the contract now carries it (Figma 18 · Driver En
 * Route). The Vehicle Card draws "Tata 407 (Flatbed)" (`<make> <model> (<body
 * type>)`): `vehicleClass` gives the body type, and `vehicleMake` /
 * `vehicleModel` now come from the server alongside it. The alias is kept so
 * existing imports keep working.
 */
export type TrackedDriverDisplay = TrackedDriver;

/**
 * App-local extension of the tracking payload.
 *
 * - `enRouteAt` (Figma 19 · Driver Arriving): 19's timeline draws "Driver on the
 *   way" with the time the driver set off (`assigned → en_route`). The server
 *   now carries this instant on the tracking payload, so it comes straight from
 *   the wire.
 * - `inTransitAt` (Figma 25 · Trip in Progress): 25's timeline draws "In transit"
 *   with the time the loaded truck left the pickup. The server now records it
 *   (`InTransitWatcher`) and sends it on the payload; the mock keeps its own
 *   clock value. Optional here only because the mock's type predates it.
 */
export type BookingTrackingDisplay = BookingTracking & {
  /** ISO instant the loaded truck left the pickup; null while the vehicle is loaded. */
  inTransitAt?: string | null;
};

/**
 * Which rebuilt design the Tracking screen draws for a status:
 * - `enRoute18`   Figma 18 · Driver En Route: `assigned`, and the first read (no status yet);
 * - `arriving19`  Figma 19 · Driver Arriving: `en_route` (the backend's own "arriving"
 *                 step is derived from the driver moving off, `EnRouteWatcher`);
 * - `arrived23`   Figma 23 · Driver Arrived: `arrived` (24 Collection Code is an
 *                 in-screen step of it, opened by "Confirm Pickup");
 * - `inTransit25` Figma 25 · Trip in Progress: `in_progress`. Also `completed` and
 *                 `paid`, but only for the instant before the screen hands over
 *                 (27 Payment, 20 Booking Details), so nothing else flashes; the
 *                 screen draws it with the last `in_progress` payload then;
 * - `legacy`      the statuses no rebuilt screen draws: `searching` and
 *                 `no_drivers_found` after a driver drops out mid-trip (the server
 *                 re-dispatches), and `disputed`. `cancelled` maps here too, but
 *                 the Tracking screen never draws it: it keeps the design that was
 *                 up for the instant before Home.
 */
export type TrackingDesign = 'enRoute18' | 'arriving19' | 'arrived23' | 'inTransit25' | 'legacy';

export function trackingDesignFor(status: JobStatus | undefined): TrackingDesign {
  if (status === undefined || status === 'assigned') return 'enRoute18';
  if (status === 'en_route') return 'arriving19';
  if (status === 'arrived') return 'arrived23';
  if (status === 'in_progress' || status === 'completed' || status === 'paid') return 'inTransit25';
  return 'legacy';
}

/**
 * A roadside job (battery, flat tyre, fuel, lockout, minor repair): the server's
 * trip has no drop, because the work happens where the customer is. Figma draws
 * 25 for a tow only, so a roadside job's 25 swaps the tow copy for its own and
 * shows 23's map (the driver at the customer's location). `false` until the first
 * read, which keeps the drawn tow version for that instant.
 */
export function isRoadsideTrip(tracking: { drop: unknown } | undefined): boolean {
  return tracking !== undefined && tracking.drop === null;
}

/**
 * A booking address as a design slot: `null` when the server has none. The
 * REST mapper stands "—" in for a missing address (`bookingsRestSource`); 25
 * never draws it, because it is not the design's copy, so it is missing too.
 */
export function addressOrNull(label: string | null | undefined): string | null {
  const trimmed = label?.trim();
  return trimmed && trimmed !== '—' ? trimmed : null;
}

/**
 * The area of 25's "On the way to Indiranagar": the first comma-separated part
 * of the drop address ("Indiranagar, Bengaluru" → "Indiranagar"). The contract
 * has no locality field and the drop address is free text, so this is the same
 * kind of rule as `firstNameOf` (owner decision, data gap).
 */
export function areaOf(address: string | null): string | null {
  const first = address?.split(',')[0]?.trim();
  return first ? first : null;
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
