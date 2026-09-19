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
import { BookingDetailsScreen } from '@/screens/bookings/BookingDetailsScreen';
import { PersonalInformationScreen } from '@/screens/account/PersonalInformationScreen';
import { MyVehiclesScreen } from '@/screens/account/MyVehiclesScreen';
import { AddVehicleScreen } from '@/screens/account/AddVehicleScreen';
import { SavedLocationsScreen } from '@/screens/account/SavedLocationsScreen';
import { AddSavedLocationScreen } from '@/screens/account/AddSavedLocationScreen';
import { PaymentMethodsScreen } from '@/screens/account/PaymentMethodsScreen';
import { WalletScreen } from '@/screens/account/WalletScreen';
import { NotificationsSettingsScreen } from '@/screens/account/NotificationsSettingsScreen';
import { NotificationsScreen } from '@/screens/notifications/NotificationsScreen';
import {
  PushPrimingSheet,
  shouldPrimePush,
} from '@/features/notifications/components/PushPrimingSheet';
import { useNotificationListeners } from '@/features/notifications/push/useNotificationListeners';
import { usePushRegistration } from '@/features/notifications/push/usePushRegistration';
import { SupportScreen } from '@/screens/support/SupportScreen';
import { HelpCenterScreen } from '@/screens/account/HelpCenterScreen';
import { ContactUsScreen } from '@/screens/account/ContactUsScreen';
import { SettingsScreen } from '@/screens/account/SettingsScreen';
import { EmergencyContactsScreen } from '@/screens/account/EmergencyContactsScreen';
import { AddEmergencyContactScreen } from '@/screens/account/AddEmergencyContactScreen';
import { LegalScreen } from '@/screens/account/LegalScreen';
import {
  ConsentCaptureOverlay,
  hasCapturedConsent,
} from '@/features/account/components/ConsentCaptureOverlay';
import { navLightTheme, navDarkTheme } from './navTheme';
import { track } from '@/lib/analytics/analytics';

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
  const hydrate = useAuthStore((s) => s.hydrate);
  const [consentCaptured, setConsentCaptured] = useState(hasCapturedConsent);
  const [pushPrimed, setPushPrimed] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>(undefined);
  const [primingDelayDone, setPrimingDelayDone] = useState(false);
  const syncRouteName = useCallback(() => {
    setRouteName(navigationRef.getCurrentRoute()?.name);
  }, []);

  // Both are no-ops until there is a session; both are safe to mount always.
  usePushRegistration();
  useNotificationListeners();

  useEffect(() => {
    hydrate();
    track('app_open');
  }, [hydrate]);

  // Figma 01 Splash has to be SEEN: hydration is a synchronous MMKV read, so
  // gated on `status` alone the drawn screen vanished within a frame. The hold
  // keeps it up for a minimum time (see useSplashHold for why 1 s).
  const splashHeld = useSplashHold(status === 'hydrating');

  // One-time DPDP consent for any customer past ProfileSetup. `isNew` flips
  // false locally when ProfileSetup saves, so a new customer sees it the same
  // launch. Never over the held Splash: a returning customer is already
  // 'authenticated' while it is still on screen.
  const showConsentCapture =
    !splashHeld && status === 'authenticated' && !isNew && !consentCaptured;

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

              <Stack.Screen name="PersonalInformation" component={PersonalInformationScreen} />
              <Stack.Screen name="MyVehicles" component={MyVehiclesScreen} />
              <Stack.Screen name="AddVehicle" component={AddVehicleScreen} />
              <Stack.Screen name="SavedLocations" component={SavedLocationsScreen} />
              <Stack.Screen name="AddSavedLocation" component={AddSavedLocationScreen} />
              <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
              <Stack.Screen name="Wallet" component={WalletScreen} />
              <Stack.Screen name="NotificationsSettings" component={NotificationsSettingsScreen} />
              <Stack.Screen name="Notifications" component={NotificationsScreen} />
              <Stack.Screen
                name="Support"
                component={SupportScreen}
                options={{ contentStyle: { backgroundColor: mitowColors.surfacePage } }}
              />
              <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
              <Stack.Screen name="ContactUs" component={ContactUsScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} />
              <Stack.Screen name="AddEmergencyContact" component={AddEmergencyContactScreen} />
              <Stack.Screen name="Legal" component={LegalScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>

      {showConsentCapture ? (
        <ConsentCaptureOverlay onDone={() => setConsentCaptured(true)} />
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
    </>
  );
}
