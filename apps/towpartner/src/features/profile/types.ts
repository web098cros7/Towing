export type DriverProfileStats = {
  jobsCompleted: number;
  /** `null` when the driver has no ratings yet. */
  rating: number | null;
  /** e.g. "1.5 yrs". */
  experienceLabel: string;
  /** `null` when the server has no completion-rate figure for this driver. */
  completionPercent: number | null;
};

export type DriverProfile = {
  name: string;
  /** Public partner id, e.g. "DRV12345". */
  driverId: string;
  verified: boolean;
  phone: string;
  /** `null` when the driver record has no email — the app's driver record does not carry one. */
  email: string | null;
  /**
   * A signed-GET URL from the server, or `null` when the driver has no photo —
   * never a bundled `require()` asset. The placeholder illustration is a
   * rendering fallback (`ProfileHeaderCard`), not a value the API can return.
   */
  avatar: string | null;
  stats: DriverProfileStats;
};
