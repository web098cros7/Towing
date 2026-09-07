import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme, motion } from '@towing/theme';
import type { RootStackParamList } from './types';
import { BottomTabs } from './BottomTabs';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useKycStatus } from '@/features/kyc/api/kyc.queries';
import { NotificationsScreen } from '@/screens/notifications/NotificationsScreen';
import { useNotificationListeners } from '@/features/notifications/push/useNotificationListeners';
import { usePushRegistration } from '@/features/notifications/push/usePushRegistration';
import { SplashScreen } from '@/screens/auth/SplashScreen';
import { PhoneEntryScreen } from '@/screens/auth/PhoneEntryScreen';
import { OtpScreen } from '@/screens/auth/OtpScreen';
import { KycWizardScreen } from '@/screens/kyc/KycWizardScreen';
import { KycStatusScreen } from '@/screens/kyc/KycStatusScreen';
import { CapabilitiesScreen } from '@/screens/capabilities/CapabilitiesScreen';
import { LegalScreen } from '@/screens/account/LegalScreen';
import { PlaceholderScreen } from '@/screens/placeholder/PlaceholderScreen';
// §9.2.4 money (Phase 19). `BankDetails` was a `PlaceholderScreen` for seven
// phases because there was nowhere for the money to go.
import { BankDetailsScreen } from '@/screens/earnings/BankDetailsScreen';
import { EarningsTripsScreen } from '@/screens/earnings/EarningsTripsScreen';
import { PayoutsScreen } from '@/screens/earnings/PayoutsScreen';
import { WeeklyEarningsScreen } from '@/screens/earnings/WeeklyEarningsScreen';
import { OfferTakeoverScreen } from '@/screens/newjob/OfferTakeoverScreen';
import { AssignedJobScreen } from '@/screens/activejob/AssignedJobScreen';
import { useOfferTakeover } from '@/features/offers/hooks/useOfferTakeover';
import { navigationRef } from './navigationRef';
import {
  ConsentCaptureOverlay,
  hasCapturedConsent,
} from '@/features/account/components/ConsentCaptureOverlay';
import { navLightTheme, navDarkTheme } from './navTheme';
import { track } from '@/lib/analytics/analytics';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Module-scope wrappers so each placeholder route has a stable component identity.
const JobDetailsScreen = () => <PlaceholderScreen title="Job Details" />;
const PersonalInformationScreen = () => <PlaceholderScreen title="Personal Information" />;
const InsuranceScreen = () => <PlaceholderScreen title="Insurance" />;
const HelpSupportScreen = () => <PlaceholderScreen title="Help & Support" />;

export function RootNavigator() {
  const theme = useTheme();
  const status = useAuthStore((s) => s.status);
  const kycStatus = useAuthStore((s) => s.identity?.kycStatus);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [consentCaptured, setConsentCaptured] = useState(hasCapturedConsent);

  useEffect(() => {
    hydrate();
    track('app_open');
  }, [hydrate]);

  // Keeps `authStore.identity.kycStatus` (the gate's source of truth, read
  // synchronously below) fresh off the authoritative `/kyc/status` endpoint —
  // see `useKycStatus`'s own comment for why this lives there and not here.
  // `enabled` guards against firing before a session/token exists.
  useKycStatus({ enabled: status === 'authenticated' });

  // Both no-op until there is a session. Registration happens BEFORE approval
  // on purpose: the approval push has to arrive on a handset that registered
  // while the driver was still pending, which is the §9.4.3 chain's whole
  // premise.
  usePushRegistration();
  useNotificationListeners();

  const approved = kycStatus === 'approved';

  // §6.3's takeover, driven off the query cache rather than off any one
  // delivery — see the hook. Mounted here because an offer must interrupt
  // whatever tab the driver is on, and only this level sees all of them; gated
  // because this level is also mounted during sign-in and the KYC gate, where
  // the offer route would 401 or 403 on a loop.
  useOfferTakeover(status === 'authenticated' && approved);

  // Decided once per branch-change, not re-evaluated on every kycStatus
  // tick while the KYC screens are already mounted — see this file's own
  // history for why (KycWizardScreen navigates to KycStatus imperatively on
  // submit, KycStatusScreen navigates back to KycWizard imperatively too).
  const initialRouteName: keyof RootStackParamList =
    status === 'hydrating'
      ? 'Splash'
      : status === 'unauthenticated'
        ? 'PhoneEntry'
        : !approved
          ? kycStatus === 'incomplete'
            ? 'KycWizard'
            : 'KycStatus'
          : 'Tabs';

  // Deliberately not gated on the KYC branch: a driver stuck in the wizard is
  // already uploading identity documents, so consent has to come first there
  // too, not only once they reach Tabs.
  const showConsentCapture = status === 'authenticated' && !consentCaptured;

  return (
    <>
      <NavigationContainer ref={navigationRef} theme={theme.isDark ? navDarkTheme : navLightTheme}>
        <Stack.Navigator
          initialRouteName={initialRouteName}
          screenOptions={{
            headerShown: false,
            // The account sub-screens inherit this. They previously took the
            // native 'default', which on Android is a Material fade-through and
            // reads flat; ios_from_right parallaxes the outgoing screen under a
            // dimming overlay, so pushing into a detail feels hierarchical.
            animation: 'ios_from_right',
            // Paints the gap during an Android push, which otherwise flashes the
            // window background between screens.
            contentStyle: { backgroundColor: theme.colors.surface0 },
          }}
        >
          {status === 'hydrating' ? (
            <Stack.Screen name="Splash" component={SplashScreen} />
          ) : status === 'unauthenticated' ? (
            <>
              <Stack.Screen name="PhoneEntry" component={PhoneEntryScreen} />
              <Stack.Screen name="Otp" component={OtpScreen} />
            </>
          ) : !approved ? (
            <>
              <Stack.Screen name="KycWizard" component={KycWizardScreen} />
              <Stack.Screen name="KycStatus" component={KycStatusScreen} />
            </>
          ) : (
            <>
              <Stack.Screen name="Tabs" component={BottomTabs} />

              <Stack.Screen name="JobDetails" component={JobDetailsScreen} />

              {/*
                §6.3's offer takeover. `fullScreenModal` rather than a card so it
                covers the tab bar too — a driver must not be able to wander off
                to Earnings mid-countdown and lose the job by navigation.

                GESTURE OFF, deliberately, and it is the only screen in the app
                that turns it off. A swipe-back here would decline a job worth
                real money by accident; the two explicit buttons are the only
                ways out, and letting it expire is the third.
              */}
              <Stack.Screen
                name="OfferTakeover"
                component={OfferTakeoverScreen}
                options={{
                  presentation: 'fullScreenModal',
                  animation: 'slide_from_bottom',
                  animationDuration: motion.duration.fast,
                  gestureEnabled: false,
                }}
              />

              <Stack.Screen
                name="AssignedJob"
                component={AssignedJobScreen}
                // gestureDirection: 'vertical' also turns on fullScreenGestureEnabled
                // and animationMatchesGesture on iOS, so the swipe-down that dismisses
                // this mirrors the slide that opened it.
                options={{
                  animation: 'slide_from_bottom',
                  gestureDirection: 'vertical',
                  animationDuration: motion.duration.slow,
                }}
              />

              <Stack.Screen name="PersonalInformation" component={PersonalInformationScreen} />
              <Stack.Screen name="Capabilities" component={CapabilitiesScreen} />
              {/* Also reachable here (not just the gate above) so an approved
                  driver can revisit their documents/status from Profile. */}
              <Stack.Screen name="KycWizard" component={KycWizardScreen} />
              <Stack.Screen name="KycStatus" component={KycStatusScreen} />
              <Stack.Screen name="BankDetails" component={BankDetailsScreen} />
              <Stack.Screen name="Insurance" component={InsuranceScreen} />
              <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />
              <Stack.Screen name="Legal" component={LegalScreen} />
              <Stack.Screen name="Notifications" component={NotificationsScreen} />
              <Stack.Screen name="Payouts" component={PayoutsScreen} />
              <Stack.Screen name="WeeklyEarnings" component={WeeklyEarningsScreen} />
              <Stack.Screen name="EarningsTrips" component={EarningsTripsScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>

      {showConsentCapture ? (
        <ConsentCaptureOverlay onDone={() => setConsentCaptured(true)} />
      ) : null}
    </>
  );
}
