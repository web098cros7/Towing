/**
 * Typed access to build-time public env. `EXPO_PUBLIC_*` values are statically
 * inlined by Metro, so this file is the single place the app reads them.
 */
type MockState = '' | 'empty' | 'error';

export const env = {
  /** Use the in-app mock data sources instead of the real REST backend. */
  useMocks: (process.env.EXPO_PUBLIC_USE_MOCKS ?? 'true') !== 'false',

  /**
   * Backend base URL (Phase 12). `localhost` works from an iOS simulator and
   * web; an Android emulator needs `http://10.0.2.2:4000`, a physical device
   * needs the host machine's LAN IP — set `EXPO_PUBLIC_API_URL` per
   * environment, see `.env.example`.
   */
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',

  /** Dev-only: force a query into a state to preview §10.9 UI. */
  mockDriversState: (process.env.EXPO_PUBLIC_MOCK_DRIVERS_STATE ?? '') as MockState,
  mockBookingsState: (process.env.EXPO_PUBLIC_MOCK_BOOKINGS_STATE ?? '') as MockState,
  /** Dev-only: force the `/me` (profile/vehicles/addresses/emergency-contacts) mocks into empty/error. */
  mockAccountState: (process.env.EXPO_PUBLIC_MOCK_ACCOUNT_STATE ?? '') as MockState,
  /** Dev-only: force the notification centre's mocks into empty/error. */
  mockNotificationsState: (process.env.EXPO_PUBLIC_MOCK_NOTIFICATIONS_STATE ?? '') as MockState,
  /** Dev-only: force the service catalogue mock into empty/error. */
  mockServicesState: (process.env.EXPO_PUBLIC_MOCK_SERVICES_STATE ?? '') as MockState,
  /**
   * Dev-only: force the fare estimate into error, or into a SURGING zone —
   * §9.1.5's surge badge is otherwise unreachable in mock mode, since no seeded
   * mock zone surges.
   */
  mockPricingState: (process.env.EXPO_PUBLIC_MOCK_PRICING_STATE ?? '') as MockState | 'surge',
  /** Dev-only: force address search into empty/error (Phase 16). */
  mockPlacesState: (process.env.EXPO_PUBLIC_MOCK_PLACES_STATE ?? '') as MockState,
  /** Dev-only: force the nearby-driver supply read into empty/error. */
  mockNearbyState: (process.env.EXPO_PUBLIC_MOCK_NEARBY_STATE ?? '') as MockState,
  /**
   * Dev-only: forces §11.6's honesty states, which a mock cannot reach on its
   * own because a mock fix never goes stale. `stale` ages the position past
   * `PRESENCE_STALE_MS` (ghost marker + "reconnecting…"), `offline` past
   * `PRESENCE_OFFLINE_MS` (the support banner), `error` fails the request.
   */
  mockTrackingState: (process.env.EXPO_PUBLIC_MOCK_TRACKING_STATE ?? '') as
    | MockState
    | 'stale'
    | 'offline',
  /**
   * Dev-only (Phase 19): forces §19.2's `COMPLETED (unpaid)` branch, which a
   * mock gateway cannot reach on its own — a fake capture never fails. Without
   * it the failure ladder would be code nobody had ever seen run, and a ladder
   * that has never executed is not a ladder.
   */
  mockPaymentState: (process.env.EXPO_PUBLIC_MOCK_PAYMENT_STATE ?? '') as MockState | 'failed',
  /** Dev-only: force the §9.1.9 wallet into empty/error. */
  mockWalletState: (process.env.EXPO_PUBLIC_MOCK_WALLET_STATE ?? '') as MockState,
  /** Dev-only: force §9.4.11's coupon check into error. */
  mockCouponState: (process.env.EXPO_PUBLIC_MOCK_COUPON_STATE ?? '') as MockState,

  /**
   * Google Maps SDK key for ANDROID (Phase 16).
   *
   * Android has no keyless map provider, so without this `react-native-maps`
   * renders a blank grey grid with a Google watermark — worse than the themed
   * placeholder, because it looks like the app is broken rather than like a map
   * is pending. Empty (the default) keeps the placeholder on Android; iOS is
   * unaffected either way, since it renders through Apple Maps with no key.
   *
   * Not the same value as the SERVER's `GOOGLE_MAPS_API_KEY`: a key shipped in
   * an app binary is extractable, so this one must be restricted to the Android
   * package name + signing certificate and to the Maps SDK alone. Places,
   * Geocoding and Distance Matrix stay server-side behind our own proxies.
   * SETUP-CHECKLIST item 7.
   */
  mapsAndroidKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? '',


  /**
   * The Google Sign-In **seam**, not a working flow. This flag gates the
   * "Continue with Google" button in `LoginScreen`, whose `onPress` is
   * still an empty function: the client OAuth flow is NOT implemented (no
   * `expo-auth-session` dependency, no `AuthDataSource` social method). The
   * backend half is real — `POST /v1/auth/social` shipped in Phase 10 — but
   * `GOOGLE_OAUTH_CLIENT_IDS` is empty server-side, so the route 403s anyway
   * (`ToBeDoneEhsan.md` §0ii, `SETUP-CHECKLIST.md` item 8). Default `false`:
   * a hidden button beats a button that does nothing. Building the client
   * flow is deferred until the OAuth client IDs exist.
   */
  googleSignInEnabled: (process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED ?? 'false') === 'true',

  /**
   * Lets a RELEASE build auto-fill the login code from the backend's dev OTP
   * echo (`LoginScreen.echoDevOtp`). In `__DEV__` the echo is always attempted;
   * this flag extends it to the `preview` EAS environment only, because a
   * standalone staging APK has no other way to log in — no SMS provider
   * exists (SETUP-CHECKLIST item 2) and `__DEV__` is false in a release bundle.
   *
   * Never set for `production`. Even if it were, the server side is the real
   * gate: the echo route 404s unless `AUTH_DEV_OTP_ECHO`, and the backend
   * refuses to boot production with that set.
   */
  devOtpEcho: (process.env.EXPO_PUBLIC_DEV_OTP_ECHO ?? 'false') === 'true',

  /** Empty by default — analytics falls back to the log adapter until a real GA4 property exists. */
  ga4MeasurementId: process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID ?? '',
  ga4ApiSecret: process.env.EXPO_PUBLIC_GA4_API_SECRET ?? '',
};
