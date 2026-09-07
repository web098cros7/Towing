import React, { useCallback, useMemo } from 'react';
import { Alert, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { useTheme } from '@towing/theme';
import { Screen, Text, OfflineBanner, Skeleton, ErrorState } from '@towing/ui';
import {
  CarFront,
  MapPin,
  CreditCard,
  Settings,
  CircleHelp,
  Headphones,
  LogOut,
  User,
  Bell,
  RefreshCw,
  LifeBuoy,
} from '@/icons';
import { AppHeader } from '@/components/AppHeader';
import { useCollapsingHeader } from '@/motion';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTabBarSpace } from '@/navigation/TabBar';
import { useBookings } from '@/features/bookings/api/bookings.queries';
import { useProfile } from '@/features/account/api/profile.queries';
import { useVehicles } from '@/features/account/api/vehicles.queries';
import { useAddresses } from '@/features/account/api/addresses.queries';
import { useUnreadCount } from '@/features/notifications/api/notifications.queries';
import { ProfileHeroCard } from '@/features/account/components/ProfileHeroCard';
import {
  QuickTile,
  StatusCard,
  MenuGroup,
  MenuRow,
} from '@/features/account/components/AccountCards';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useLogout } from '@/features/auth/api/auth.queries';
import type { RootStackParamList } from '@/navigation/types';

/** Shipped version, read from app.config.ts rather than retyped. */
const APP_VERSION = Constants.expoConfig?.version ?? '';

export function ProfileScreen() {
  const theme = useTheme();
  const tabBarSpace = useTabBarSpace();
  const { scrollY, screenProps } = useCollapsingHeader();
  const online = useOnlineStatus();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { data: profile, isPending: profilePending, isError: profileError, refetch: refetchProfile } = useProfile();
  const { data: vehicles } = useVehicles();
  const { data: addresses } = useAddresses();
  const unread = useUnreadCount();
  const { items: bookings } = useBookings();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const logout = useLogout();

  const trips = bookings.length;
  const vehicleCount = vehicles?.length ?? 0;
  const addressCount = addresses?.length ?? 0;

  /**
   * Six real signals, so the number moves when the user actually does something.
   * Nothing here is invented — each maps to a screen they can go and complete.
   */
  const completion = useMemo(() => {
    const checks = [
      !!profile?.name?.trim(),
      !!profile?.mobile?.trim(),
      !!profile?.email?.trim(),
      vehicleCount > 0,
      addressCount > 0,
      // ⚠ THE SIXTH CHECK WAS `paymentMethodsMock.length > 0` — a hardcoded
      // fixture that was ALWAYS non-empty, so this term contributed a constant
      // 1/6 to every customer's completion percentage regardless of anything
      // they had done. Phase 19 removed the mock (Razorpay's sheet owns saved
      // instruments — §9.1.9's "no raw card data stored"), so the term goes
      // with it rather than being replaced by another always-true one.
    ];
    const done = checks.filter(Boolean).length;
    return Math.round((done / checks.length) * 100);
  }, [profile, vehicleCount, addressCount]);

  const openProfile = useCallback(
    () => navigation.navigate('PersonalInformation'),
    [navigation],
  );
  const openBookings = useCallback(
    () => navigation.navigate('Tabs', { screen: 'Bookings' }),
    [navigation],
  );
  const openVehicles = useCallback(() => navigation.navigate('MyVehicles'), [navigation]);
  const openLocations = useCallback(() => navigation.navigate('SavedLocations'), [navigation]);
  const openPayments = useCallback(() => navigation.navigate('PaymentMethods'), [navigation]);
  const openNotifications = useCallback(
    () => navigation.navigate('NotificationsSettings'),
    [navigation],
  );
  const openSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const openEmergencyContacts = useCallback(
    () => navigation.navigate('EmergencyContacts'),
    [navigation],
  );
  const openHelp = useCallback(() => navigation.navigate('HelpCenter'), [navigation]);
  const openContact = useCallback(() => navigation.navigate('ContactUs'), [navigation]);

  const confirmLogout = useCallback(() => {
    Alert.alert(
      'Log out?',
      'You will need to sign in again to book a tow.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => logout.mutate(refreshToken ?? ''),
        },
      ],
      { cancelable: true },
    );
  }, [logout, refreshToken]);

  return (
    <Screen
      scroll
      edges={['top']}
      banner={<OfflineBanner visible={!online} />}
      header={<AppHeader scrollY={scrollY} title="Profile" showMenu={false} showBell={false} />}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
      {...screenProps}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: theme.spacing.sm, gap: theme.spacing.md }}>
        {profileError ? (
          <ErrorState
            title="Couldn't load your profile"
            onRetry={() => refetchProfile()}
            icon={RefreshCw}
          />
        ) : profilePending || !profile ? (
          <>
            <Skeleton width="100%" height={140} radius={theme.radii.sheet} />
            <Skeleton width="100%" height={72} radius={theme.radii.card} />
          </>
        ) : (
          <>
            <ProfileHeroCard
              name={profile.name ?? ''}
              email={profile.email ?? ''}
              trips={trips}
              vehicles={vehicleCount}
              places={addressCount}
              onEditProfile={openProfile}
              onViewBookings={openBookings}
            />

            <StatusCard
              icon={User}
              label="Your profile"
              badge={completion === 100 ? 'Complete' : `${completion}% completed`}
              tone={completion === 100 ? 'success' : 'warning'}
              onPress={openProfile}
            />
          </>
        )}

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <QuickTile icon={CarFront} label="My Vehicles" onPress={openVehicles} />
          <QuickTile icon={CreditCard} label="Payments" onPress={openPayments} />
        </View>

        <StatusCard
          icon={Bell}
          label="Notifications"
          badge={(unread.data?.unread ?? 0) > 0 ? `${unread.data?.unread} new` : 'Up to date'}
          onPress={openNotifications}
        />

        <MenuGroup title="Account">
          <MenuRow icon={MapPin} label="Saved Locations" onPress={openLocations} />
          <MenuRow icon={LifeBuoy} label="Emergency Contacts" onPress={openEmergencyContacts} />
          <MenuRow icon={Settings} label="Settings" onPress={openSettings} />
        </MenuGroup>

        <MenuGroup title="Support">
          <MenuRow icon={CircleHelp} label="Help Center" onPress={openHelp} />
          <MenuRow icon={Headphones} label="Contact Us" onPress={openContact} />
        </MenuGroup>

        {/* Untitled: a lone destructive action needs no heading. */}
        <MenuGroup>
          <MenuRow icon={LogOut} label="Log Out" danger onPress={confirmLogout} />
        </MenuGroup>

        {APP_VERSION ? (
          <Text
            variant="caption"
            color="tertiary"
            align="center"
            style={{ paddingTop: theme.spacing.xs }}
          >
            Version {APP_VERSION}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
