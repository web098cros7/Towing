import type { JobStatus } from '@towing/api-contracts';

/**
 * The full §5.1 machine, taken from the shared contract rather than restated —
 * the DB has all ten and a client must be able to render every one. Re-exported
 * so this feature stays the domain owner of the vocabulary its components read.
 */
export type { JobStatus };

/**
 * How the customer paid. Cash is a §29.4 roadmap item, not a launch payment
 * method — same reason TowGo's `BookingPaymentMethod` doesn't carry it.
 */
export type JobPayment = 'online';

/** Segmented filter on the Jobs screen. */
export type JobFilter = 'all' | 'assigned' | 'completed' | 'cancelled';

export type Job = {
  id: string;
  /** e.g. "Honda City". */
  vehicleName: string;
  /** Pickup area label. */
  pickup: string;
  /** Drop-off area label. */
  drop: string;
  /**
   * INTEGER PAISE since Phase 19. It was a rupee number fed by a mock while
   * every live money field on the wire was paise, which is the arrangement in
   * which one missed conversion is a 100× error on a driver's screen.
   */
  farePaise: number;
  payment: JobPayment;
  status: JobStatus;
  /** Derived tow-type label, e.g. "Car Tow" / "SUV Tow". */
  towTypeLabel: string;
  distanceKm: number;
  /** Preformatted, e.g. "12 May, 10:30 AM". */
  dateTimeLabel: string;
};
