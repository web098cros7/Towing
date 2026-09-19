/**
 * Query keys for W3's ops dashboard (and W4's live map).
 *
 * One `all` root so the socket's resync can invalidate everything the admin
 * realtime connection feeds, and so `ops:metrics` / `ops:badges` patches land
 * on keys the REST queries already own.
 */
export const adminOpsKeys = {
  all: ['admin-ops'] as const,
  dashboard: () => ['admin-ops', 'dashboard'] as const,
  badges: () => ['admin-ops', 'badges'] as const,
  activity: () => ['admin-ops', 'activity'] as const,
  /** Filter-parameterised: the zone narrowing is a room join AND a query param. */
  live: (filters: { zoneId: string | null; status: string | null }) =>
    ['admin-ops', 'live', filters.zoneId, filters.status] as const,
  /** W5: the live-searches list. */
  dispatchList: () => ['admin-ops', 'dispatch'] as const,
  /** W5: one booking's wave history. */
  dispatch: (bookingId: string) => ['admin-ops', 'dispatch', bookingId] as const,
};
