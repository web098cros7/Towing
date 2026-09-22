import React from 'react';
import { Linking, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ErrorState } from '@towing/ui';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiMenuCard,
  MiMenuRow,
  MiInfoBanner,
  mitowLayout,
} from '@/design';
import { Toggle } from '@/components/Toggle';
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from '@/features/notifications/api/notifications.queries';
import {
  getPermission,
  pushAvailability,
  type PushPermission,
} from '@/features/notifications/push/pushClient';
import type { RootStackParamList } from '@/navigation/types';

/**
 * Figma 53 · Notification Settings (293:2716).
 *
 * ⚠ ONLY THE OPT-OUT-ABLE CATEGORIES GET A TOGGLE. §12.3 makes transactional
 * and safety notifications always-on, and the backend enforces that in the
 * fan-out worker regardless of what any client sends. Rendering them as
 * switches would be a lie the user could act on; they are rendered as
 * "Always on" rows instead, which is the honest version of the same list.
 */
export function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const [permission, setPermission] = React.useState<PushPermission | null>(null);

  const availability = pushAvailability();

  React.useEffect(() => {
    void getPermission().then(setPermission);
  }, []);

  const showPermissionBanner =
    availability.available && permission !== null && permission !== 'granted';

  return (
    <MiScreen edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: Math.max(insets.bottom, 34),
        }}
      >
        {/* 293:2716 · Nav bar */}
        <MiNavBar title="Notifications" trailing="none" onBack={() => navigation.goBack()} />

        {/*
          293:3047 · Permission banner.
          The device's own state comes first, because it overrides everything
          below it: a preference that is on while the OS permission is denied
          means nothing arrives, and a screen that did not say so would be
          actively misleading.
        */}
        {showPermissionBanner ? (
          <MiInfoBanner
            tone="brand"
            icon="bell-off"
            title="Notifications are off"
            subtitle={
              Platform.OS === 'ios'
                ? 'Turn them on in iOS Settings so you know when your driver arrives.'
                : 'Turn them on in Android Settings so you know when your driver arrives.'
            }
            showChevron
            height={85}
            onPress={() => void Linking.openSettings()}
          />
        ) : null}

        {/* 293:3056 · Offers */}
        <ScrollView scrollEnabled={false} contentContainerStyle={{ gap: mitowLayout.headingGap }}>
          <MiText variant="heading18">Offers</MiText>
          <MiMenuCard radius={16} paddingVertical={4}>
            <MiMenuRow
              icon={{ color: 'tag' }}
              title="Promotions & offers"
              subtitle="Deals and discounts"
              trailing={
                <Toggle
                  value={prefs.data?.promotions ?? false}
                  onValueChange={(value) => update.mutate({ promotions: value })}
                  disabled={prefs.isPending || prefs.isError}
                />
              }
            />
          </MiMenuCard>
          {prefs.isError ? (
            <ErrorState
              title="Could not load your preferences"
              onRetry={() => void prefs.refetch()}
            />
          ) : null}
        </ScrollView>

        {/* 293:3077 · Always on */}
        <ScrollView scrollEnabled={false} contentContainerStyle={{ gap: mitowLayout.headingGap }}>
          <MiText variant="heading18">Always on</MiText>
          <MiMenuCard radius={16} paddingVertical={4}>
            <MiMenuRow
              icon={{ color: 'tow-truck' }}
              title="Booking updates"
              subtitle="Confirmation, driver, arrival"
            />
            <MiMenuRow
              icon={{ color: 'receipt' }}
              title="Trip receipts"
              subtitle="Invoices and payment confirmations"
            />
            <MiMenuRow
              icon={{ color: 'verified' }}
              title="Safety alerts"
              subtitle="SOS and account security"
            />
          </MiMenuCard>
        </ScrollView>

        {/* 293:3147 · Footer note */}
        <MiText variant="bodyS14" color="secondary">
          Booking, safety and payment messages can't be switched off. They're how we tell you what's
          happening with a tow you've paid for.
        </MiText>
      </ScrollView>
    </MiScreen>
  );
}
