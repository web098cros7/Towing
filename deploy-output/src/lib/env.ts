/**
 * Typed access to build-time public env. `NEXT_PUBLIC_*` values are statically
 * inlined by Next, so this file is the single place the app reads them.
 * Mirrors apps/towpartner/src/lib/env.ts.
 */
type MockState = '' | 'empty' | 'error';

export const env = {
  /** Use the in-app mock data sources instead of the REST backend. */
  useMocks: (process.env.NEXT_PUBLIC_USE_MOCKS ?? 'true') !== 'false',

  /** Backend base URL (server-side proxy target). */
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',

  /** Dev-only: force a query into a state to preview §10.9 feedback UI. */
  mockDashboardState: (process.env.NEXT_PUBLIC_MOCK_DASHBOARD_STATE ?? '') as MockState,
  mockTrucksState: (process.env.NEXT_PUBLIC_MOCK_TRUCKS_STATE ?? '') as MockState,
  mockDriversState: (process.env.NEXT_PUBLIC_MOCK_DRIVERS_STATE ?? '') as MockState,
  mockJobsState: (process.env.NEXT_PUBLIC_MOCK_JOBS_STATE ?? '') as MockState,
  mockEarningsState: (process.env.NEXT_PUBLIC_MOCK_EARNINGS_STATE ?? '') as MockState,
  mockRealtimeState: (process.env.NEXT_PUBLIC_MOCK_REALTIME_STATE ?? '') as MockState,
  mockAlertsState: (process.env.NEXT_PUBLIC_MOCK_ALERTS_STATE ?? '') as MockState,
  mockSettingsState: (process.env.NEXT_PUBLIC_MOCK_SETTINGS_STATE ?? '') as MockState,
  mockReportsState: (process.env.NEXT_PUBLIC_MOCK_REPORTS_STATE ?? '') as MockState,
  mockAdminDriversState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_DRIVERS_STATE ?? '') as MockState,
  /** §9.4.10's Finance queue (Phase 19). */
  mockAdminFinanceState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_FINANCE_STATE ?? '') as MockState,

  /**
   * MapLibre style URL. Empty by default, which selects the built-in vendorless
   * style: token-coloured background plus the fleet's service-zone polygons, no
   * tile vendor and no API key. Set this to a MapTiler/Stadia/Protomaps style to
   * add a basemap — the truck and zone layers compose on top either way.
   *
   * NOTE: inlined at `next build`. Leaving it set while building the bundle
   * Playwright runs against would give the hermetic smoke a network dependency.
   */
  mapStyleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? '',
};

/** The socket's origin is NOT here on purpose — it arrives in the ticket response. */
