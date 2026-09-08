export type JobStatus =
  | 'searching'
  | 'assigned'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'paid'
  | 'cancelled'
  | 'no_drivers_found'
  | 'disputed';

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
};

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  'searching',
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
];
