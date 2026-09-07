import type { NavigatorScreenParams } from '@react-navigation/native';

/** Nested inside the Bookings tab so the tab bar stays visible on the detail. */
export type BookingsStackParamList = {
  BookingsList: undefined;
  BookingDetails: { bookingId: string };
};

export type RootTabParamList = {
  Home: undefined;
  Bookings: NavigatorScreenParams<BookingsStackParamList> | undefined;
  Services: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  /** Shown once at boot while `authStore.hydrate()` reads the persisted session. */
  Splash: undefined;
  /**
   * Auth (spec §9.1.1) — rendered instead of Tabs while unauthenticated.
   * One screen for BOTH steps (phone → OTP): the step transition is an
   * in-screen shared-axis animation, so the challengeId/mobile state that the
   * old Otp route carried as params now lives inside LoginScreen.
   */
  Login: undefined;
  /** Pushed once, only when the just-verified identity has `isNew: true`. */
  ProfileSetup: undefined;

  Tabs: NavigatorScreenParams<RootTabParamList> | undefined;
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
  HelpCenter: undefined;
  ContactUs: undefined;
  Settings: undefined;
  EmergencyContacts: undefined;
  AddEmergencyContact: undefined;
  Legal: undefined;
};
