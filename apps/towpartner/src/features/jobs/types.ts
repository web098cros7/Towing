import type { JobStatus } from '@towing/api-contracts';

/**
 * The full §5.1 machine, taken from the shared contract rather than restated —
 * the DB has all ten and a client must be able to render every one. Re-exported
 * so this feature stays the domain owner of the vocabulary its components read.
 */
export type { JobStatus };

/**
 * How the customer paid. Cash is live since the Pay Cash flow (§29.4) — the
 * driver collects it on the spot and the server records it against the booking.
 */
export type JobPayment = 'online' | 'cash';

/**
 * Segmented filter on the Jobs screen.
 *
 * `'assigned'` means ACTIVE — the driver currently holds the job, i.e. any of
 * `assigned` / `en_route` / `arrived` / `in_progress`. The label on screen is
 * "Active"; the key stays `'assigned'` because that is what the server's
 * `status` vocabulary calls the first of those states.
 */
export type JobFilter = 'all' | 'assigned' | 'completed' | 'cancelled';

export type Job = {
  id: string;
  /** e.g. "Honda City". */
  vehicleName: string;
  /** Pickup area label. */
  pickup: string;
  /** Drop-off area label. "At the spot" for roadside jobs. */
  drop: string;
  /**
   * INTEGER PAISE since Phase 19. It was a rupee number fed by a mock while
   * every live money field on the wire was paise, which is the arrangement in
   * which one missed conversion is a 100× error on a driver's screen.
   */
  farePaise: number;
  /** `null` when the server has not recorded a payment method yet. */
  payment: JobPayment | null;
  status: JobStatus;
  /** Derived tow-type label, e.g. "Car Tow" / "SUV Tow". */
  towTypeLabel: string;
  /** `null` when the server has no distance for the job. */
  distanceKm: number | null;
  /** Preformatted, e.g. "12 May, 10:30 AM". */
  dateTimeLabel: string;
};
