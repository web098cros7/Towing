import React, { useCallback, useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme, motion } from '@towing/theme';
import type { RootStackParamList } from './types';
import { navigationRef } from './navigationRef';
import { BottomTabs } from './BottomTabs';
import { useAuthStore } from '@/features/auth/store/authStore';
import { SplashScreen } from '@/screens/auth/SplashScreen';
import { useSplashHold } from '@/screens/auth/splash/useSplashHold';
import { WelcomeScreen } from '@/screens/auth/WelcomeScreen';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { VerifyOtpScreen } from '@/screens/auth/VerifyOtpScreen';
import { ProfileSetupScreen } from '@/screens/onboarding/ProfileSetupScreen';
import { mitowColors } from '@/design';
import { RoadsideAssistanceScreen } from '@/screens/services/RoadsideAssistanceScreen';
import { BookLocationScreen } from '@/screens/booking/BookLocationScreen';
import { BookTowScreen } from '@/screens/booking/BookTowScreen';
import { MapPickerScreen } from '@/screens/booking/MapPickerScreen';
import { SearchingScreen } from '@/screens/booking/SearchingScreen';
import { TrackingScreen } from '@/screens/booking/TrackingScreen';
import { ChatWithDriverScreen } from '@/screens/booking/ChatWithDriverScreen';
import { PaymentScreen } from '@/screens/payment/PaymentScreen';
import { PaymentSuccessScreen } from '@/screens/payment/PaymentSuccessScreen';
import { PayCashScreen } from '@/screens/payment/PayCashScreen';
import { EmergencyScreen } from '@/screens/emergency/EmergencyScreen';
import { BookingDetailsScreen } from '@/screens/bookings/BookingDetailsScreen';
import { PersonalInformationScreen } from '@/screens/account/PersonalInformationScreen';
import { MyVehiclesScreen } from '@/screens/account/MyVehiclesScreen';
import { AddVehicleScreen } from '@/screens/account/AddVehicleScreen';
import { SavedLocationsScreen } from '@/screens/account/SavedLocationsScreen';
import { AddSavedLocationScreen } from '@/screens/account/AddSavedLocationScreen';
import { PaymentMethodsScreen } from '@/screens/account/PaymentMethodsScreen';
import { WalletScreen } from '@/screens/account/WalletScreen';
import { ReferEarnScreen } from '@/screens/account/ReferEarnScreen';
import { NotificationsSettingsScreen } from '@/screens/account/NotificationsSettingsScreen';
import { NotificationsScreen } from '@/screens/notifications/NotificationsScreen';
import {
  PushPrimingSheet,
  shouldPrimePush,
} from '@/features/notifications/components/PushPrimingSheet';
import { useNotificationListeners } from '@/features/notifications/push/useNotificationListeners';
import { usePushRegistration } from '@/features/notifications/push/usePushRegistration';
import { SupportScreen } from '@/screens/support/SupportScreen';
import { SupportChatScreen } from '@/screens/support/SupportChatScreen';
import { ReportIssueScreen } from '@/screens/support/ReportIssueScreen';
import { CallDriverSheetHost } from '@/features/calling/CallDriverSheet';
import { ShareFeedbackScreen } from '@/screens/support/ShareFeedbackScreen';
import { HelpCenterScreen } from '@/screens/account/HelpCenterScreen';
import { ContactUsScreen } from '@/screens/account/ContactUsScreen';
import { MyQuotesScreen } from '@/screens/account/MyQuotesScreen';
import { MyTicketsScreen } from '@/screens/account/MyTicketsScreen';
import { TicketThreadScreen } from '@/screens/account/TicketThreadScreen';
import { SettingsScreen } from '@/screens/account/SettingsScreen';
import { EmergencyContactsScreen } from '@/screens/account/EmergencyContactsScreen';
import { AddEmergencyContactScreen } from '@/screens/account/AddEmergencyContactScreen';
import { LegalScreen } from '@/screens/account/LegalScreen';
import {
  ConsentCaptureOverlay,
  hasCapturedConsent,
  markConsentCaptured,
} from '@/features/account/components/ConsentCaptureOverlay';
import { hasAgreedTo, useConsentStatus } from '@/features/account/api/privacy.queries';
import { POLICY_VERSION } from '@/lib/legal/policyVersion';
import { navLightTheme, navDarkTheme } from './navTheme';
import { track } from '@/lib/analytics/analytics';
import {
  useCaptureReferralLinks,
  useApplyPendingReferral,
} from '@/features/referrals/pendingReferral';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * How long Home is on screen before the priming sheet slides over it: long
 * enough for the consent Modal's fade-out to finish (presenting one RN Modal
 * while another dismisses is unreliable, notably on iOS) and for Home to paint,
 * so the sheet lands over Home as Figma 07 draws it.
 */
const PUSH_PRIMING_DELAY_MS = 400;

export function RootNavigator() {
  const theme = useTheme();
  const status = useAuthStore((s) => s.status);
  const isNew = useAuthStore((s) => s.identity?.isNew ?? false);
  const userId = useAuthStore((s) => s.identity?.id ?? null);
  const hydrate = useAuthStore((s) => s.hydrate);
  /** The account that agreed during this launch (the phone's flag may not have saved). */
  const [agreedNow, setAgreedNow] = useState<string | null>(null);
  const [pushPrimed, setPushPrimed] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>(undefined);
  const [primingDelayDone, setPrimingDelayDone] = useState(false);
  const syncRouteName = useCallback(() => {
    setRouteName(navigationRef.getCurrentRoute()?.name);
  }, []);

  // Both are no-ops until there is a session; both are safe to mount always.
  usePushRegistration();
  useNotificationListeners();

  // Referral deep links: capture any incoming invite URL, then apply the
  // stored code once the user is signed in and past profile setup.
  useCaptureReferralLinks();
  useApplyPendingReferral(status === 'authenticated' && !isNew);

  useEffect(() => {
    hydrate();
    track('app_open');
  }, [hydrate]);

  // Figma 01 Splash has to be SEEN: hydration is a synchronous MMKV read, so
  // gated on `status` alone the drawn screen vanished within a frame. The hold
  // keeps it up for a minimum time (see useSplashHold for why 1 s).
  const splashHeld = useSplashHold(status === 'hydrating');

  // One-time DPDP consent, once per ACCOUNT (Ehsan, 24 Sep 2026): this phone's
  // flag for this customer first, else the server's answer, so a customer who
  // agreed on another phone is not asked again and a second customer on this
  // phone is. The overlay shows only on a definite "not agreed": while the
  // server has not answered (or cannot be reached) nothing covers the app.
  const signedInPastSetup = status === 'authenticated' && !isNew;
  const agreedHere = userId !== null && (agreedNow === userId || hasCapturedConsent(userId));
  const { data: consentStatus } = useConsentStatus(userId, signedInPastSetup && !agreedHere);
  const agreedOnServer = consentStatus ? hasAgreedTo(consentStatus, POLICY_VERSION) : undefined;
  useEffect(() => {
    if (agreedOnServer && userId) markConsentCaptured(userId);
  }, [agreedOnServer, userId]);
  const consentCaptured = agreedHere || agreedOnServer === true;

  // `isNew` flips false locally when ProfileSetup saves, so a new customer sees
  // it the same launch. Never over the held Splash: a returning customer is
  // already 'authenticated' while it is still on screen.
  const showConsentCapture =
    !splashHeld && signedInPastSetup && !consentCaptured && agreedOnServer === false;

  // Figma 07: the push-priming sheet over HOME, once, the first time the
  // customer is actually on Home after consent. Never over ProfileSetup
  // (`isNew`), never before or on top of the consent overlay (`consentCaptured`
  // is false for as long as that overlay can show, so the two cannot stack),
  // never over a pushed screen. Shows in Expo Go too: `shouldPrimePush()` must
  // gate on whether the OS can be ASKED, not on whether a token can be minted.
  const primingDue =
    !splashHeld &&
    status === 'authenticated' &&
    !isNew &&
    consentCaptured &&
    !pushPrimed &&
    routeName === 'Home' &&
    shouldPrimePush();

  useEffect(() => {
    if (!primingDue) {
      setPrimingDelayDone(false);
      return;
    }
    const timer = setTimeout(() => setPrimingDelayDone(true), PUSH_PRIMING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [primingDue]);

  const showPushPriming = primingDue && primingDelayDone;

  return (
    <>
      <NavigationContainer
        ref={navigationRef}
        theme={theme.isDark ? navDarkTheme : navLightTheme}
        onReady={syncRouteName}
        onStateChange={syncRouteName}
      >
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            // The account sub-screens inherit this. They previously took the
            // native 'default', which on Android is a Material fade-through and
            // reads flat; ios_from_right parallaxes the outgoing screen under a
            // dimming overlay, so pushing into Account feels hierarchical.
            animation: 'ios_from_right',
            // Paints the gap during an Android push, which otherwise flashes the
            // window background between screens.
            contentStyle: { backgroundColor: theme.colors.surface0 },
          }}
        >
          {splashHeld ? (
            <Stack.Screen
              name="Splash"
              component={SplashScreen}
              // The redesigned screens are #FFFFFF / #F3F6F8, but the navigator's
              // default contentStyle is surface0 (#FAFAFA). Left alone, that paints
              // the gap during a push and flashes a mismatched off-white band at the
              // screen edges. Each of these sets its own true background instead.
              options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
            />
          ) : status === 'unauthenticated' ? (
            <>
              <Stack.Screen
                name="Welcome"
                component={WelcomeScreen}
                // Splash → Welcome is a stack REPLACEMENT, not a push: the whole
                // screen set swaps when `status` flips hydrating → unauthenticated,
                // which hard-cuts by default. A fade makes the handoff read as one
                // continuous launch rather than two screens colliding.
                options={{
                  animation: 'fade',
                  animationDuration: motion.duration.base,
                  contentStyle: { backgroundColor: mitowColors.surfacePage },
                }}
              />
              <Stack.Screen
                name="Login"
                component={LoginScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfaceCanvas } }}
              />
              <Stack.Screen
                name="VerifyOtp"
                component={VerifyOtpScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
              />
              {/*
                Welcome's "Contact Support" opens 58 Support before anyone has
                signed in, and 58's rows lead to Help Center and Contact Us — so
                all three are registered here too. None of them needs a session:
                58 and Help Center are static content, Contact Us is phone/email
                links. The names repeat in the signed-in branch below, which is
                fine because only one branch is ever mounted.
              */}
              <Stack.Screen
                name="Support"
                component={SupportScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
              />
              <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
              <Stack.Screen name="ContactUs" component={ContactUsScreen} />
            </>
          ) : (
            <>
              {isNew ? (
                <Stack.Screen
                  name="ProfileSetup"
                  component={ProfileSetupScreen}
                  // Same fade as Welcome: the first screen after the splash on
                  // the signed-in path gets the same continuous handoff.
                  options={{
                    animation: 'fade',
                    animationDuration: motion.duration.base,
                    contentStyle: { backgroundColor: mitowColors.surfacePage },
                  }}
                />
              ) : null}
              <Stack.Screen
                name="Tabs"
                component={BottomTabs}
                // A returning customer goes Splash → Home: fade like Splash →
                // Welcome rather than sliding Home in over a dimming splash.
                options={{ animation: 'fade', animationDuration: motion.duration.base }}
              />
              <Stack.Screen
                name="RoadsideAssistance"
                component={RoadsideAssistanceScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
              />
              <Stack.Screen
                name="BookLocation"
                component={BookLocationScreen}
                // gestureDirection: 'vertical' also turns on fullScreenGestureEnabled
                // and animationMatchesGesture on iOS, so the swipe-down that dismisses
                // this mirrors the slide that opened it.
                options={{
                  animation: 'slide_from_bottom',
                  gestureDirection: 'vertical',
                  animationDuration: motion.duration.slow,
                }}
              />
              <Stack.Screen name="BookTow" component={BookTowScreen} />
              <Stack.Screen
                name="MapPicker"
                component={MapPickerScreen}
                // Same slide-up + swipe-down pairing as `BookLocation`, which is
                // the screen it opens from: the picker reads as a step within
                // entering a location rather than a separate destination.
                options={{
                  animation: 'slide_from_bottom',
                  gestureDirection: 'vertical',
                  animationDuration: motion.duration.slow,
                }}
              />
              <Stack.Screen
                name="Searching"
                component={SearchingScreen}
                options={{
                  animation: 'fade',
                  gestureEnabled: false,
                  animationDuration: motion.duration.slow,
                }}
              />
              <Stack.Screen
                name="Tracking"
                component={TrackingScreen}
                options={{
                  animation: 'fade',
                  gestureEnabled: false,
                  animationDuration: motion.duration.slow,
                }}
              />
              <Stack.Screen name="BookingDetails" component={BookingDetailsScreen} />
              {/* Figma 22: the default push, no tab bar (a root route). */}
              <Stack.Screen
                name="ChatWithDriver"
                component={ChatWithDriverScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
              />
              {/* Figma 27 (28 is a sheet inside it, 29 a phase of it): the default push, no
                  tab bar. */}
              <Stack.Screen
                name="Payment"
                component={PaymentScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
              />
              {/*
                Figma 30: reached by a stack RESET from 27 / 29 once a payment is
                captured, never by a push. The fade matches Searching → Tracking's
                status hand-off. No back swipe: nothing under 30 may be returned to
                (27 would offer to pay again).
              */}
              <Stack.Screen
                name="PaymentSuccess"
                component={PaymentSuccessScreen}
                options={{
                  animation: 'fade',
                  gestureEnabled: false,
                  animationDuration: motion.duration.slow,
                  contentStyle: { backgroundColor: mitowColors.surfacePage },
                }}
              />
              {/*
                Figma 31b: pushed from 27 when the customer chooses Cash and taps Pay. Same
                options as 30 — the fade matches the status hand-off, and no back swipe keeps
                the customer from swiping away while the driver is confirming.
              */}
              <Stack.Screen
                name="PayCash"
                component={PayCashScreen}
                options={{
                  animation: 'fade',
                  gestureEnabled: false,
                  animationDuration: motion.duration.slow,
                  contentStyle: { backgroundColor: mitowColors.surfacePage },
                }}
              />
              {/*
                Figma 26: the default push, no tab bar; signed-in only (26 Data gap 7).
              */}
              <Stack.Screen
                name="Emergency"
                component={EmergencyScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
              />

              <Stack.Screen name="PersonalInformation" component={PersonalInformationScreen} />
              <Stack.Screen name="MyVehicles" component={MyVehiclesScreen} />
              <Stack.Screen name="AddVehicle" component={AddVehicleScreen} />
              <Stack.Screen name="SavedLocations" component={SavedLocationsScreen} />
              <Stack.Screen name="AddSavedLocation" component={AddSavedLocationScreen} />
              <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
              <Stack.Screen name="Wallet" component={WalletScreen} />
              <Stack.Screen name="ReferEarn" component={ReferEarnScreen} />
              <Stack.Screen name="NotificationsSettings" component={NotificationsSettingsScreen} />
              <Stack.Screen name="Notifications" component={NotificationsScreen} />
              <Stack.Screen
                name="Support"
                component={SupportScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
              />
              <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
              <Stack.Screen name="ContactUs" component={ContactUsScreen} />
              <Stack.Screen name="SupportChat" component={SupportChatScreen} />
              <Stack.Screen name="ReportIssue" component={ReportIssueScreen} />
              <Stack.Screen name="ShareFeedback" component={ShareFeedbackScreen} />
              <Stack.Screen name="MyTickets" component={MyTicketsScreen} />
              <Stack.Screen name="MyQuotes" component={MyQuotesScreen} />
              <Stack.Screen name="TicketThread" component={TicketThreadScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} />
              <Stack.Screen name="AddEmergencyContact" component={AddEmergencyContactScreen} />
              <Stack.Screen name="Legal" component={LegalScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>

      {showConsentCapture ? (
        <ConsentCaptureOverlay userId={userId!} onDone={() => setAgreedNow(userId)} />
      ) : null}

      {/*
        Push priming (Figma 07), once: waits for consent to be captured, for the
        current route to be the Home tab, and then PUSH_PRIMING_DELAY_MS so the
        consent Modal has fully closed. `primingDue` requires consentCaptured and
        the consent overlay requires !consentCaptured, so they never stack.
        PushPrimingSheet calls onDone on either answer (and Android back) after
        writing its primed key.
      */}
      {showPushPriming ? <PushPrimingSheet onDone={() => setPushPrimed(true)} /> : null}

      {/* The warning before dialling a driver's real number (callDriver). */}
      <CallDriverSheetHost />
    </>
  );
}
