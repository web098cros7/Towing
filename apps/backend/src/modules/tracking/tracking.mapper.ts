import {
  TRACK_COARSEN_DEGREES,
  type BookingTracking,
  type CoarsePosition,
  type JobStatus,
  type PublicTrack,
  type TrackedDriver,
  type TrackedPosition,
} from '@towing/api-contracts';
import type { DriverFixRow, TrackingBookingRow } from './tracking.repo';

/**
 * Row → DTO for the two tracking surfaces.
 *
 * BUILT FIELD BY FIELD, NEVER BY SPREADING A ROW. `bookings` carries
 * `commission_amount`, `driver_payout`, `booking_otp_hash` and the customer's
 * contact number; `drivers` carries a mobile. A spread here would publish some
 * subset of that on a route the customer polls every ten seconds, and — for the
 * public mapper below — on a route anyone holding a forwarded link can call.
 * `bookings.repo.ts` established this rule for `toBooking`; these are two more
 * places it applies.
 */

/** §9.1.7's driver card. Note what is absent: the mobile number. */
export function toTrackedDriver(row: TrackingBookingRow): TrackedDriver | null {
  if (!row.driverId || !row.driverName) return null;

  return {
    name: row.driverName,
    photoUrl: row.driverPhotoUrl,
    // NUMERIC comes back as a string from postgres.js. `null` stays null — a
    // driver nobody has rated has no rating, and defaulting to 5.0 would
    // advertise one that does not exist (the same call `jobOfferSchema` makes
    // for `customerRating`).
    rating: row.driverRating === null ? null : Number(row.driverRating),
    totalTrips: row.driverTotalTrips ?? 0,
    vehiclePlate: row.truckPlate,
    vehicleClass: (row.driverVehicleClass as TrackedDriver['vehicleClass']) ?? null,
  };
}

/**
 * The customer's own view of where their driver is.
 *
 * `lowAccuracy` is FALSE here rather than recomputed, and that deserves a note:
 * this is the Postgres-backed §19.2 rung, and `drivers.current_location` carries
 * no accuracy figure — it is the ~30 s flush of a fix whose accuracy metadata
 * lived only in the Redis hash. Claiming a fix is high-accuracy would be a
 * guess; the honest signal for a polled position is its AGE, which `at` carries
 * and which §11.6's thresholds are actually defined against.
 */
export function toTrackedPosition(fix: DriverFixRow | undefined): TrackedPosition | null {
  if (!fix) return null;

  return {
    lat: fix.lat,
    lng: fix.lng,
    // Neither is stored on the row; a socket frame carries both and this does
    // not. A polled marker does not rotate, which is correct — inventing a
    // heading from a single point is not possible.
    headingDeg: null,
    speedKph: null,
    lowAccuracy: false,
    at: (fix.lastPingAt ?? new Date()).toISOString(),
  };
}

export function toBookingTracking(
  row: TrackingBookingRow,
  fix: DriverFixRow | undefined,
  now: Date,
): BookingTracking {
  return {
    bookingId: row.id,
    status: row.status as JobStatus,
    driver: toTrackedDriver(row),
    position: toTrackedPosition(fix),
    etaSeconds: row.etaSeconds,
    etaSource: (row.routeSource as BookingTracking['etaSource']) ?? null,
    routePolyline: row.routePolyline,
    routeDropPolyline: row.routeDropPolyline,
    pickup: { lat: row.pickupLat, lng: row.pickupLng },
    drop:
      row.dropLat !== null && row.dropLng !== null
        ? { lat: row.dropLat, lng: row.dropLng }
        : null,
    // `updatedAt` is the closest thing to an assignment instant that predates
    // migration 0015 — the three columns below are real, this one is derived.
    // Only meaningful once a driver exists, hence the guard.
    assignedAt: row.driverId ? (row.updatedAt?.toISOString() ?? null) : null,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    shared: isShareLive(row, now),
    at: now.toISOString(),
  };
}

/**
 * §11.7's public projection — the allowlist, executed.
 *
 * EVERY FIELD BELOW IS TYPED OUT BY HAND, and the schema it satisfies is
 * hand-written rather than derived from the booking DTO for exactly this reason:
 * a `.omit()` inherits new fields silently, and the day somebody adds a phone
 * number to the row above, an omit-list that was not updated in the same commit
 * starts publishing it to the open internet.
 *
 * The three things a viewer gets that they could not get from the link alone —
 * the driver's FIRST name, the plate, and a ~100 m position — are the three
 * §11.7 names. Nothing else crosses.
 */
export function toPublicTrack(
  row: TrackingBookingRow,
  fix: DriverFixRow | undefined,
  now: Date,
): PublicTrack {
  return {
    status: row.status as JobStatus,
    // SPLIT SERVER-SIDE. Sending the full name and trimming it in the browser
    // would put the surname in the JSON either way, which is where anyone
    // curious would look first.
    driverFirstName: firstName(row.driverName),
    vehiclePlate: row.truckPlate,
    position: fix
      ? {
          ...coarsen(fix.lat, fix.lng),
          // No heading on the polled path; see `toTrackedPosition`.
          headingDeg: null,
          at: (fix.lastPingAt ?? now).toISOString(),
        }
      : null,
    // The pickup AREA, per §11.7's wording — coarsened for the same reason the
    // driver's position is. A viewer should see the neighbourhood the tow is
    // happening in, not the customer's doorstep.
    pickupArea: coarsen(row.pickupLat, row.pickupLng),
    etaSeconds: row.etaSeconds,
    // Driver→pickup only. The drop leg is deliberately withheld: it is the
    // customer's destination, which is a fact about them rather than about the
    // truck the viewer was invited to watch.
    routePolyline: row.routePolyline,
    expiresAt: row.shareExpiresAt?.toISOString() ?? null,
    at: now.toISOString(),
  };
}

/** First token of a name, or null. `"  "` is not a first name. */
function firstName(full: string | null): string | null {
  if (!full) return null;
  const first = full.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

/**
 * Snap to a ~100 m grid, the same treatment §11.9 gives anonymous nearby drivers.
 *
 * ROUNDING TO A FIXED GRID, NOT ADDING NOISE. Random jitter re-rolls on every
 * poll, so a viewer sampling the endpoint for a minute can average it back to
 * the true position — the coarsening would be decorative. A grid is stable: the
 * same true position always yields the same coarse one, and no amount of
 * sampling recovers a finer answer than the cell.
 */
function coarsen(lat: number, lng: number): { lat: number; lng: number } {
  const snap = (value: number) =>
    Math.round(value / TRACK_COARSEN_DEGREES) * TRACK_COARSEN_DEGREES;
  // Fixed to the grid's own precision so floating-point does not leak digits
  // past it — `12.345000000000001` would be a coarsened value that looks exact.
  return { lat: Number(snap(lat).toFixed(3)), lng: Number(snap(lng).toFixed(3)) };
}

/** A share link is live while it has a token and has not passed its grace. */
export function isShareLive(row: TrackingBookingRow, now: Date): boolean {
  if (!row.shareToken) return false;
  if (!row.shareExpiresAt) return true;
  return row.shareExpiresAt.getTime() > now.getTime();
}

export type { CoarsePosition };
