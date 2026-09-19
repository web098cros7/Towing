import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * The Bookings tab's own stack. `BookingDetails` is NOT in it: Figma 20 / 35
 * draw Booking Details with no tab bar, so it is a root route.
 */
export type BookingsStackParamList = {
  BookingsList: undefined;
};

export type RootTabParamList = {
  Home: undefined;
  Bookings: NavigatorScreenParams<BookingsStackParamList> | undefined;
  /**
   * The design's third tab (Figma Tab Item "Support", icon/headset). It has no
   * scene of its own: pressing it is intercepted in `BottomTabs` and pushes the
   * ROOT route `Support` (58), which Figma draws with a back chevron and no tab
   * bar. Never navigate to this tab directly; navigate to root `Support`. Named
   * `SupportTab` so a `navigate('Support')` from a tab scene cannot be caught by
   * the tab navigator (it handles any route name it owns).
   */
  SupportTab: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  /** Shown once at boot while `authStore.hydrate()` reads the persisted session. */
  Splash: undefined;
  /**
   * The landing screen while unauthenticated (Figma 02). Both its CTAs lead to
   * `Login`: signing up and logging in are the same phone-OTP action.
   */
  Welcome: undefined;
  /**
   * Auth step 1 (spec §9.1.1) — phone entry only.
   *
   * Phone and OTP were ONE screen between the Figma `38:2` redesign and this
   * one, with a shared-axis animation between steps, because re-entering a
   * whole stack screen visibly repainted the hero and header the two steps
   * shared. The MiTow design gives the OTP step its own background, nav bar and
   * headline and no hero at all, so there is nothing left to repaint-match and
   * the split costs nothing — see `VerifyOtpScreen`.
   */
  Login: undefined;
  /**
   * Auth step 2 — OTP entry (Figma 04). The params mirror the driver app's
   * `Otp` route (`apps/towpartner/src/navigation/types.ts`) so the two auth
   * flows stay legible as the same shape.
   */
  VerifyOtp: { challengeId: string; mobile: string; resendAfterSeconds: number };
  /** Pushed once, only when the just-verified identity has `isNew: true`. */
  ProfileSetup: undefined;

  Tabs: NavigatorScreenParams<RootTabParamList> | undefined;
  /**
   * The roadside service menu (Figma 09). A pushed screen rather than a tab —
   * the design gives it a back chevron — opened from Home's service shortcuts.
   */
  RoadsideAssistance: undefined;
  /** Step 1 — enter pickup / drop, schedule, for-whom. */
  BookLocation: undefined;
  /** Step 2 — map + tow-type selection + confirm. */
  BookTow: undefined;
  /**
   * §9.1.5's draggable pin (Phase 16). Carries WHICH end of the trip it is
   * setting, because the same screen serves both and the answer decides where
   * the camera opens as well as where the result lands.
   */
  MapPicker: { field: 'pickup' | 'drop' };
  /** Progressive-radius driver search (spec §9.1.6). Carries the booking it is searching for. */
  Searching: { bookingId: string };
  /** Live tracking of the assigned driver (spec §9.1.7). */
  Tracking: { bookingId: string };
  /** Figma 20 / 35 Booking Details: a pushed root screen, drawn with no tab bar. */
  BookingDetails: { bookingId: string };
  /**
   * Figma 22 Chat with Driver: a pushed root screen, drawn with no tab bar. Opened by
   * the Message button of 18, 19, 20, 23 and 24 through `openDriverChat`
   * (`features/chat/openDriverChat.ts`), which only routes here in mock mode: there
   * is no chat backend yet.
   */
  ChatWithDriver: { bookingId: string };

  // Account sub-screens (spec §9.1.11)
  PersonalInformation: undefined;
  MyVehicles: undefined;
  AddVehicle: { vehicleId?: string } | undefined;
  SavedLocations: undefined;
  AddSavedLocation: { locationId?: string } | undefined;
  PaymentMethods: undefined;
  /** §9.1.9's in-app wallet — refunds and §14.5 adjustments, read-only. */
  Wallet: undefined;
  NotificationsSettings: undefined;
  /** The in-app notification centre — what the AppHeader bell opens (Phase 13). */
  Notifications: undefined;
  /**
   * Figma 58 · Support: the help hub. Opened by the Support tab, every Help
   * chip and every "Get Help" button. Its FAQ / Help Center rows go to
   * `HelpCenter`; chat, report-an-issue and contact rows go to `ContactUs`
   * until 59–61 are rebuilt.
   */
  Support: undefined;
  HelpCenter: undefined;
  ContactUs: undefined;
  Settings: undefined;
  EmergencyContacts: undefined;
  AddEmergencyContact: undefined;
  Legal: undefined;
};
