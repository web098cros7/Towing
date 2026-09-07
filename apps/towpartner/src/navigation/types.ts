import type { NavigatorScreenParams } from '@react-navigation/native';

/** Bottom tabs — the 5-slot driver nav (New Job is the center FAB). */
export type DriverTabParamList = {
  Home: undefined;
  Jobs: undefined;
  NewJob: undefined;
  Earnings: undefined;
  Profile: undefined;
};

/**
 * Root stack. Auth + KYC-gate screens first (see `RootNavigator`'s gating),
 * then Tabs and detail/sub-screens. The screens beyond the five designed tabs
 * are lightweight placeholders (Figma not yet designed).
 */
export type RootStackParamList = {
  /** Shown once at boot while `authStore.hydrate()` reads the persisted session. */
  Splash: undefined;
  // Auth — rendered instead of Tabs while unauthenticated.
  PhoneEntry: undefined;
  Otp: { challengeId: string; mobile: string; resendAfterSeconds: number };

  // §3.1 KYC gate — forced while `identity.kycStatus !== 'approved'`, also
  // reachable from Profile once approved (Documents row).
  KycWizard: undefined;
  KycStatus: undefined;

  Tabs: NavigatorScreenParams<DriverTabParamList> | undefined;

  JobDetails: { jobId: string } | undefined;

  /**
   * §6.3's offer, full-screen (Phase 17).
   *
   * NO PARAMS. The offer is read from the query cache, which is the one place
   * the socket frame, the §19.2 poll and a push tap all agree — passing a
   * booking id here would let a stale route param disagree with the cache about
   * which offer is live, and the loser of that disagreement is a driver tapping
   * Accept on the wrong booking.
   */
  OfferTakeover: undefined;

  /**
   * The job the driver holds (Phase 17). Was `ActiveJob`, a placeholder taking
   * an `offerId` — which was the wrong key: a driver has at most one active
   * booking (§3.8) and `GET /v1/driver/jobs/current` is its authority, so there
   * is nothing to identify. Phase 18 adds arrive/start/complete to this same
   * screen rather than replacing it.
   */
  AssignedJob: undefined;

  // Account (Profile) sub-screens
  PersonalInformation: undefined;
  /** Vehicle class + long-distance opt-in (`PUT /driver/capabilities`). Was `MyVehicles`. */
  Capabilities: undefined;
  /** §9.2.4's Route linked-account onboarding. A `PlaceholderScreen` until Phase 19. */
  BankDetails: undefined;

  // §9.2.4 money (Phase 19)
  /** Payout history plus the request entry point. */
  Payouts: undefined;
  /** §12.2's weekly summary, on screen — the "View Report" the Earnings tab has always offered. */
  WeeklyEarnings: undefined;
  /** §9.2.4's per-trip gross → commission → net feed — the "View All". */
  EarningsTrips: undefined;
  Insurance: undefined;
  HelpSupport: undefined;
  /** Privacy/terms copy plus the §20.4 DPDP export + account-deletion actions. */
  Legal: undefined;
  Notifications: undefined;
};
