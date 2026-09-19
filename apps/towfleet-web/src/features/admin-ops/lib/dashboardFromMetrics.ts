import type { AdminOpsDashboardResponse, AdminOpsMetricsEvent } from '@towing/api-contracts';

/**
 * Apply one `ops:metrics` frame to the cached dashboard.
 *
 * Pure, so the socket handler stays a one-liner and the rule stays readable in
 * one place: the frame's `dispatchableNow === null` IS the degraded signal —
 * the broadcaster computed the payload while Redis was unreachable, and the
 * REST response would say exactly the same thing. The backend's own e2e spec
 * pins that pushed and fetched payloads are identical, so this patch cannot
 * disagree with a refetch.
 */
export function dashboardFromMetrics(event: AdminOpsMetricsEvent): AdminOpsDashboardResponse {
  return {
    kpis: event.kpis,
    at: event.at,
    degraded: event.kpis.dispatchableNow === null,
  };
}
