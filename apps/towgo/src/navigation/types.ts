import type { NavigatorScreenParams } from '@react-navigation/native';
import type { PaymentMethodKind } from '@/features/payments/types';

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
   * The services list (screen 09's content) as the third tab, where Figma draws
   * Support (owner decision, 24 Sep 2026). Support stays the ROOT route
   * `Support` (58), opened by every Help chip.
   */
  Services: undefined;
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
  /**
   * Figma 27 · Payment: a pushed root screen, drawn with no tab bar. 28 · Apply Coupon is a sheet
   * inside it and 29 · Payment Failed is a phase of it (29 spec, D1 = A), so neither has a route
   * of its own. Opened when the trip reaches `completed` (25 spec, D5).
   */
  Payment: { bookingId: string };
  /**
   * Figma 30 · Payment Successful. Shown only after a capture comes back `captured`, by a stack
   * RESET to `[Tabs, PaymentSuccess]`, so nothing under it can pay again and its Back is a
   * popToTop() to Home. `payment` is what the payment told the app: `method` is 27's selection,
   * `transactionId` the gateway reference when known (else null), `paidAt` an ISO instant (the
   * device clock at capture until the contract returns the server's `paidAt`), `amountPaise`
   * what was charged (30's Service price).
   */
  PaymentSuccess: {
    bookingId: string;
    payment: {
      method: PaymentMethodKind;
      transactionId: string | null;
      paidAt: string;
      amountPaise: number;
    };
  };
  /**
   * Figma 31b · Pay Cash to Driver. Shown after the customer chooses Cash on 27 and taps Pay,
   * until the DRIVER confirms the cash in the driver app. Polls the booking every 3 s and
   * resets to `[Tabs, PaymentSuccess]` once it turns `paid`. Back and "Pay Online Instead"
   * both return to 27, where Cash is still selected.
   */
  PayCash: { bookingId: string; amountPaise: number };
  /**
   * Figma 26 · Emergency: a pushed root screen with no tab bar, signed-in only. `bookingId` is the
   * trip to share; without it the screen falls back to the active booking. Figma draws no caller
   * (26 spec, Data gap 1): 25 Trip in Progress's Help chip opens it, an owner decision (26
   * follows 25 in the flow, and Help is 25's only extra control).
   */
  Emergency: { bookingId?: string } | undefined;

  // Account sub-screens (spec §9.1.11)
  PersonalInformation: undefined;
  MyVehicles: undefined;
  AddVehicle: { vehicleId?: string } | undefined;
  SavedLocations: undefined;
  AddSavedLocation: { locationId?: string } | undefined;
  PaymentMethods: undefined;
  /** §9.1.9's in-app wallet — refunds and §14.5 adjustments, read-only. */
  Wallet: undefined;
  /** Figma 45 · Refer & Earn: opened by 38 Profile's "Refer & Earn" row. No referral backend exists yet, so its values are placeholders. */
  ReferEarn: undefined;
  NotificationsSettings: undefined;
  /** The in-app notification centre — what the AppHeader bell opens (Phase 13). */
  Notifications: undefined;
  /**
   * Figma 58 · Support: the help hub. Opened by the Support tab, every Help
   * chip and every "Get Help" button. Its FAQ / Help Center rows go to
   * `HelpCenter`; chat and report-an-issue carry `bookingId` on, so help asked
   * from a trip is about that trip.
   */
  Support: { bookingId?: string } | undefined;
  HelpCenter: undefined;
  /** W15: the message form files a ticket; a booking id attaches the trip (§6.6). */
  ContactUs: { bookingId?: string } | undefined;
  /** Figma 60 · Support Chat. `bookingId` pins the topic strip to a trip. */
  SupportChat: { bookingId?: string } | undefined;
  /** Figma 61 · Report an Issue. `bookingId` preselects the trip; otherwise the newest booking. */
  ReportIssue: { bookingId?: string } | undefined;
  /** Figma 62 · Share Feedback: rating, topic and text, filed as a support ticket. */
  ShareFeedback: undefined;
  /** W15: the requester's own ticket list and one ticket's thread. */
  MyTickets: undefined;
  TicketThread: { ticketId: string };
  /** W20 §7.3: long-distance trips the engine will not price. */
  MyQuotes: undefined;
  Settings: undefined;
  EmergencyContacts: undefined;
  AddEmergencyContact: undefined;
  Legal: undefined;
};
