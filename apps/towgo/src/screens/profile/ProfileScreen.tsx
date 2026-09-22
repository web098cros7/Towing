import React, { useCallback, useState } from 'react';
import { Image, View } from 'react-native';
import { ScrollView } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import {
  MiScreen,
  MiText,
  MiButton,
  MiColorIcon,
  MiLineIcon,
  MiMenuCard,
  MiMenuRow,
  MiInfoBanner,
  MiMapButton,
  mitowLayout,
  mitowColors,
  avatarDefaultIllustration,
} from '@/design';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';
import { useProfile } from '@/features/account/api/profile.queries';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useLogout } from '@/features/auth/api/auth.queries';
import { useTabBarSpace } from '@/navigation/TabBar';
import type { RootStackParamList } from '@/navigation/types';
import { LogOutSheet } from './LogOutSheet';

/**
 * Formats a mobile number for display.
 * '+91' followed by exactly 10 digits → '+91 98765 43210' (5 + 5 split).
 * Otherwise returns the number as stored.
 */
function formatMobile(m: string): string {
  const match = /^\+91(\d{10})$/.exec(m);
  if (match) {
    const digits = match[1];
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return m;
}

/**
 * Figma 38 · Profile (238:586)
 *
 * Profile TAB root. The tab bar is the navigator's own and is not drawn here.
 */
export function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarSpace = useTabBarSpace();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const Pressable = usePressablePrimitive();

  const { data: profile, isPending: profilePending } = useProfile();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const logout = useLogout();

  const [logoutOpen, setLogoutOpen] = useState(false);

  const confirmLogout = useCallback(() => setLogoutOpen(true), []);

  const openPersonalInformation = useCallback(
    () => navigation.navigate('PersonalInformation'),
    [navigation],
  );
  const openSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const openBookings = useCallback(
    () => navigation.navigate('Tabs', { screen: 'Bookings' }),
    [navigation],
  );
  const openSavedLocations = useCallback(() => navigation.navigate('SavedLocations'), [navigation]);
  const openPaymentMethods = useCallback(() => navigation.navigate('PaymentMethods'), [navigation]);
  const openNotifications = useCallback(() => navigation.navigate('Notifications'), [navigation]);
  const openSupport = useCallback(() => navigation.navigate('Support'), [navigation]);
  const openReferEarn = useCallback(() => navigation.navigate('ReferEarn'), [navigation]);

  const hasName = !!profile?.name?.trim();
  const hasEmail = !!profile?.email?.trim();

  return (
    <MiScreen edges={[]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: Math.max(mitowLayout.contentTop, insets.top),
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: tabBarSpace,
        }}
      >
        {/* Header 240:706 */}
        <View
          style={{
            flexDirection: 'row',
            height: 46,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <MiText variant="display27" accessibilityRole="header">
            Profile
          </MiText>
          {/* Settings 240:708 */}
          <MiMapButton
            colorIcon="settings"
            iconSize={24}
            size={46}
            accessibilityLabel="Settings"
            onPress={openSettings}
          />
        </View>

        {/* Account 240:714 */}
        <Pressable
          pressScale={theme.motion.pressScale.row}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel="Personal information"
          onPress={openPersonalInformation}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
          }}
        >
          {/* Avatar 84×84 */}
          <View style={{ width: 84, height: 84, position: 'relative' }}>
            {profile?.photoUrl ? (
              <Image
                source={{ uri: profile.photoUrl }}
                style={{ width: 84, height: 84, borderRadius: 42 }}
              />
            ) : (
              <SvgXml xml={avatarDefaultIllustration} width={84} height={84} />
            )}
            {/* Camera badge 240:718 */}
            <View
              style={{
                position: 'absolute',
                left: 60,
                top: 58,
                width: 26,
                height: 26,
                borderRadius: 13,
                borderWidth: 2,
                borderColor: mitowColors.surfacePage,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MiColorIcon name="camera" size={26} />
            </View>
          </View>

          {/* Details 240:720 */}
          <View style={{ flex: 1, gap: 2 }}>
            {profilePending || !profile ? (
              <>
                <SlotPlaceholder variant="title20" width={132} />
                <SlotPlaceholder variant="bodyM15" width={122} />
                <SlotPlaceholder variant="bodyM15" width={174} />
              </>
            ) : (
              (() => {
                const p = profile;
                return (
                  <>
                    {hasName ? (
                      <MiText variant="title20" numberOfLines={1}>
                        {p.name}
                      </MiText>
                    ) : (
                      <SlotPlaceholder variant="title20" width={132} />
                    )}
                    <MiText variant="bodyM15" color="secondary">
                      {formatMobile(p.mobile)}
                    </MiText>
                    {hasEmail ? (
                      <MiText variant="bodyM15" color="secondary" numberOfLines={1}>
                        {p.email}
                      </MiText>
                    ) : null}
                  </>
                );
              })()
            )}
          </View>

          <MiLineIcon name="chevron-right" size={24} />
        </Pressable>

        {/* MiTow Plus 240:726 */}
        <MiInfoBanner
          tone="brand"
          icon="plus-badge"
          title="MiTow Plus"
          subtitle="Get priority service, exclusive offers and more."
          showChevron
          height={84}
        />

        {/* Menu 240:736 */}
        <MiMenuCard radius={16} paddingVertical={4}>
          <MiMenuRow
            icon={{ color: 'calendar' }}
            title="My Bookings"
            subtitle="View past and upcoming bookings"
            showChevron
            onPress={openBookings}
          />
          <MiMenuRow
            icon={{ color: 'map' }}
            title="Saved Locations"
            subtitle="Home, Work and more"
            showChevron
            onPress={openSavedLocations}
          />
          <MiMenuRow
            icon={{ color: 'payment' }}
            title="Payment Methods"
            subtitle="Manage cards, UPI and wallets"
            showChevron
            onPress={openPaymentMethods}
          />
          <MiMenuRow
            icon={{ color: 'bell' }}
            title="Notifications"
            subtitle="Manage alerts and updates"
            showChevron
            onPress={openNotifications}
          />
          <MiMenuRow
            icon={{ color: 'help' }}
            title="Help & Support"
            subtitle="FAQs, chat with us"
            showChevron
            onPress={openSupport}
          />
          <MiMenuRow
            icon={{ color: 'refer' }}
            title="Refer & Earn"
            subtitle="Get ₹100 for every friend"
            showChevron
            onPress={openReferEarn}
          />
        </MiMenuCard>

        {/* Log Out 240:849 */}
        <MiButton
          tone="quiet"
          label="Log Out"
          onPress={confirmLogout}
          leadingSlot={<MiColorIcon name="log-out" size={22} />}
          loading={logout.isPending}
        />
      </ScrollView>

      <LogOutSheet
        visible={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        name={profile?.name ?? null}
        mobile={profile?.mobile ?? null}
        loggingOut={logout.isPending}
        onConfirm={() => logout.mutate(refreshToken ?? '')}
      />
    </MiScreen>
  );
}
