import type { JobStatus } from '@/features/jobs/types';

/** Today's headline numbers on the driver dashboard. */
export type DriverSummary = {
  jobsCompleted: number;
  /** INTEGER PAISE since Phase 19 — see `farePaise` below. */
  earningsPaise: number;
  rating: number;
};

/** A compact recent-activity entry (subset of a full Job). */
export type RecentJob = {
  id: string;
  vehicleName: string;
  pickup: string;
  drop: string;
  /**
   * INTEGER PAISE since Phase 19. It was a rupee number fed by a mock while
   * every live money field on the wire was paise, which is the arrangement in
   * which one missed conversion is a 100× error on a driver's screen.
   */
  farePaise: number;
  status: JobStatus;
};

export type DashboardData = {
  /** First name for the greeting, e.g. "Rahul". */
  driverName: string;
  summary: DriverSummary;
  recentActivity: RecentJob[];
};
