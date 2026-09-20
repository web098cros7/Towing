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
  /** W2's admin directory (M1). */
  mockAdminAdminsState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_ADMINS_STATE ?? '') as MockState,
  /** W1's audit viewer (M1). */
  mockAdminAuditState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_AUDIT_STATE ?? '') as MockState,
  /** W21's admin notes (M1). */
  mockAdminNotesState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_NOTES_STATE ?? '') as MockState,
  /** W1's active-session list (M1). */
  mockAdminSessionsState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_SESSIONS_STATE ?? '') as MockState,
  /** W3's ops dashboard + W4's live map (M2). */
  mockAdminOpsState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_OPS_STATE ?? '') as MockState,
  mockAdminDirectoryState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_DIRECTORY_STATE ?? '') as MockState,
  /** W8's bookings console (M3). */
  mockAdminBookingsState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_BOOKINGS_STATE ?? '') as MockState,
  /** W8's dispute queue (M3). */
  mockAdminDisputesState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_DISPUTES_STATE ?? '') as MockState,
  /** W10's rate-card editor (M4). */
  mockAdminPricingState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_PRICING_STATE ?? '') as MockState,
  /** W11's commission editor (M4). */
  mockAdminCommissionState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_COMMISSION_STATE ??
    '') as MockState,
  /** W12's dispatch + app config screen (M4). */
  mockAdminDispatchState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_DISPATCH_STATE ?? '') as MockState,
  /** W13's service-zone editor (M4). */
  mockAdminZonesState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_ZONES_STATE ?? '') as MockState,
  /** W14's SOS console (M5). */
  mockAdminSosState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_SOS_STATE ?? '') as MockState,
  /** W15's support console (M5). */
  mockAdminSupportState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_SUPPORT_STATE ?? '') as MockState,
  /** W15's content editor (M5). */
  mockAdminContentState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_CONTENT_STATE ?? '') as MockState,
  /** W16's promotions console (M6). */
  mockAdminPromotionsState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_PROMOTIONS_STATE ?? '') as MockState,
  /** W17's analytics console (M6). */
  mockAdminAnalyticsState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_ANALYTICS_STATE ?? '') as MockState,
  /** W18's notification console (M6). */
  mockAdminNotificationsState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_NOTIFICATIONS_STATE ??
    '') as MockState,
  /** W19's privacy console (M6). */
  mockAdminPrivacyState: (process.env.NEXT_PUBLIC_MOCK_ADMIN_PRIVACY_STATE ?? '') as MockState,

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
