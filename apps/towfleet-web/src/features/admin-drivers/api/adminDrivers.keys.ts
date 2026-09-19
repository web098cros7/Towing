export const adminDriversKeys = {
  all: ['admin-drivers'] as const,
  /**
   * EVERY page. A decision (single or bulk) moves drivers out of the queue, so
   * it invalidates the family — a page-scoped key would leave the operator
   * looking at a stale page 2 after deciding everyone on it.
   */
  pendingRoot: () => [...adminDriversKeys.all, 'pending'] as const,
  pending: (page: number, limit: number) => [...adminDriversKeys.pendingRoot(), page, limit] as const,
  /** W7's per-document history. */
  versions: (driverId: string) => [...adminDriversKeys.all, 'versions', driverId] as const,
};
