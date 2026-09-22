/**
 * Re-exported from the contract rather than retyped.
 *
 * It was a hand-written copy of the same union, which is how it came to be
 * missing `refunded` the moment the contract gained one — a local copy of a
 * server vocabulary drifts silently until something downstream fails to
 * compile, and here that was a mock, not the console.
 */
export type { JobStatus } from '@towing/api-contracts';
import type { JobStatus } from '@towing/api-contracts';

export type Job = {
  id: string;
  code: string;
  serviceType: string;
  status: JobStatus;
  driverName: string | null;
  truckPlate: string | null;
  pickupArea: string;
  dropArea: string | null;
  distanceKm: number;
  grossPaise: number;
  /** Locked at confirm; null for bookings that never confirmed. */
  commissionBand: 'A' | 'B' | 'C' | null;
  commissionPct: number | null;
  commissionPaise: number;
  poolPaise: number;
  createdAt: string;
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  searching: 'Searching',
  assigned: 'Assigned',
  en_route: 'En route',
  arrived: 'Arrived',
  in_progress: 'In progress',
  completed: 'Completed',
  paid: 'Paid',
  cancelled: 'Cancelled',
  no_drivers_found: 'No drivers found',
  disputed: 'Disputed',
  refunded: 'Refunded',
};

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  'searching',
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
];
