import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme, motion } from '@towing/theme';
import type { RootStackParamList } from './types';
import { navigationRef } from './navigationRef';
import { BottomTabs } from './BottomTabs';
import { useAuthStore } from '@/features/auth/store/authStore';
import { SplashScreen } from '@/screens/auth/SplashScreen';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { ProfileSetupScreen } from '@/screens/onboarding/ProfileSetupScreen';
import { BookLocationScreen } from '@/screens/booking/BookLocationScreen';
import { BookTowScreen } from '@/screens/booking/BookTowScreen';
import { MapPickerScreen } from '@/screens/booking/MapPickerScreen';
import { SearchingScreen } from '@/screens/booking/SearchingScreen';
import { TrackingScreen } from '@/screens/booking/TrackingScreen';
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

export function RootNavigator() {
  const theme = useTheme();
  const status = useAuthStore((s) => s.status);
  const isNew = useAuthStore((s) => s.identity?.isNew ?? false);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [consentCaptured, setConsentCaptured] = useState(hasCapturedConsent);
  const [pushPrimed, setPushPrimed] = useState(false);

  // Both are no-ops until there is a session; both are safe to mount always.
  usePushRegistration();
  useNotificationListeners();

  useEffect(() => {
    hydrate();
    track('app_open');
  }, [hydrate]);

  // A returning/onboarded customer sees the one-time consent capture before
  // anything else; a brand-new customer sees it next launch, after ProfileSetup.
  const showConsentCapture = status === 'authenticated' && !isNew && !consentCaptured;

  // Only once the legal gate is out of the way, and only where a token could
  // actually be minted — `shouldPrimePush()` is false in Expo Go and on a
  // simulator, so the ask is never spent somewhere it cannot be honoured.
  const showPushPriming =
    status === 'authenticated' && !showConsentCapture && !pushPrimed && shouldPrimePush();

  return (
    <>
      <NavigationContainer ref={navigationRef} theme={theme.isDark ? navDarkTheme : navLightTheme}>
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
          {status === 'hydrating' ? (
            <Stack.Screen name="Splash" component={SplashScreen} />
          ) : status === 'unauthenticated' ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : (
            <>
              {isNew ? <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} /> : null}
              <Stack.Screen name="Tabs" component={BottomTabs} />
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

              <Stack.Screen name="PersonalInformation" component={PersonalInformationScreen} />
              <Stack.Screen name="MyVehicles" component={MyVehiclesScreen} />
              <Stack.Screen name="AddVehicle" component={AddVehicleScreen} />
              <Stack.Screen name="SavedLocations" component={SavedLocationsScreen} />
              <Stack.Screen name="AddSavedLocation" component={AddSavedLocationScreen} />
              <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
              <Stack.Screen name="Wallet" component={WalletScreen} />
              <Stack.Screen name="NotificationsSettings" component={NotificationsSettingsScreen} />
              <Stack.Screen name="Notifications" component={NotificationsScreen} />
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
        Push priming, AFTER consent and only once (Phase 13).

        A sibling of the consent overlay rather than a step inside it, because
        the two are not the same kind of thing: consent is a legal gate that
        blocks the app, this is an ask that costs nothing to decline. Ordering
        matters though — stacking two full-screen asks on a first launch is how
        both get dismissed, so this waits until consent is behind the user.
      */}
      {showPushPriming ? <PushPrimingSheet onDone={() => setPushPrimed(true)} /> : null}
    </>
  );
}
