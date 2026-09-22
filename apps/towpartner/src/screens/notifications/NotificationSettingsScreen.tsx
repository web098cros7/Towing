import React, { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, ErrorState, Screen, Skeleton, Text } from '@towing/ui';
import { BellOff, RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { Toggle } from '@/components/Toggle';
import { Pressable } from '@/motion';
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from '@/features/notifications/api/notifications.queries';
import {
  getPermission,
  pushAvailability,
  type PushPermission,
} from '@/features/notifications/push/pushClient';
import { driverColors } from '@/theme/driverColors';
import type { RootStackParamList } from '@/navigation/types';

const HAIRLINE = '#E5E7EB';
const INK_SOFT = '#4B5563';

/**
 * What the driver can turn off, and what they cannot.
 *
 * ⚠ ONLY THE OPT-OUT-ABLE CATEGORIES GET A TOGGLE. §12.3 makes job, money and
 * safety notifications always-on, and the fan-out worker enforces that whatever
 * a client sends. A switch for them would be a lie the driver could act on —
 * and a costly one here, because the thing being switched off would be the job
 * offers they earn from. They are listed as "Always on" rows instead, which is
 * the honest version of the same list.
 *
 * The device's own permission comes first when it is not granted: a preference
 * that is on while the OS is blocking delivery means nothing arrives, and a
 * driver who cannot see that would conclude MiTow had stopped sending work.
 */
export function NotificationSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const [permission, setPermission] = useState<PushPermission | null>(null);

  const availability = pushAvailability();

  useEffect(() => {
    void getPermission().then(setPermission);
  }, []);

  const blocked = availability.available && permission !== null && permission !== 'granted';
  const busy = prefs.isPending || prefs.isError || update.isPending;

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 28 }}>
      <DriverHeader
        leading="back"
        title="Notifications"
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, paddingTop: 3, gap: 12 }}>
        {blocked ? (
          <Pressable
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel="Notifications are off. Open settings."
            onPress={() => void Linking.openSettings()}
            style={() => ({ borderRadius: 20 })}
          >
            <Card
              padding={16}
              style={{ borderRadius: 20, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <BellOff size={18} color="#DC2626" />
                <Text weight="medium" style={{ fontSize: 15, lineHeight: 21 }}>
                  Notifications are off
                </Text>
              </View>
              <Text style={{ fontSize: 14, lineHeight: 20, color: INK_SOFT }}>
                {Platform.OS === 'ios'
                  ? 'Turn them on in iOS Settings, or you will not hear a job offer arrive.'
                  : 'Turn them on in Android Settings, or you will not hear a job offer arrive.'}
              </Text>
            </Card>
          </Pressable>
        ) : null}

        {prefs.isPending ? (
          <View style={{ gap: 12 }}>
            <Skeleton width="100%" height={140} radius={20} />
            <Skeleton width="100%" height={200} radius={20} />
          </View>
        ) : prefs.isError ? (
          <ErrorState
            title="Couldn't load your preferences"
            onRetry={() => void prefs.refetch()}
            icon={RefreshCw}
          />
        ) : (
          <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE }}>
            <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
              You can turn these off
            </Text>
            <ToggleRow
              title="Weekly summary"
              subtitle="What you earned last week"
              value={prefs.data?.weeklySummary ?? true}
              disabled={busy}
              onValueChange={(weeklySummary) => update.mutate({ weeklySummary })}
            />
            <ToggleRow
              title="Offers and promotions"
              subtitle="Incentives and bonuses from MiTow"
              value={prefs.data?.promotions ?? false}
              disabled={busy}
              onValueChange={(promotions) => update.mutate({ promotions })}
              last
            />
          </Card>
        )}

        <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE }}>
          <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
            Always on
          </Text>
          <AlwaysOnRow title="Job offers" subtitle="A new job you can accept" />
          <AlwaysOnRow title="Job updates" subtitle="Cancellations and reassignments" />
          <AlwaysOnRow title="Messages" subtitle="From the customer on a job" />
          <AlwaysOnRow title="Earnings and payouts" subtitle="Credits, payouts and failures" />
          <AlwaysOnRow title="Verification" subtitle="Your documents and account" />
          <AlwaysOnRow title="Safety" subtitle="SOS and account security" last />
        </Card>

        <Text style={{ fontSize: 13, lineHeight: 19, color: INK_SOFT, paddingHorizontal: 4 }}>
          Job, money and safety messages can't be switched off. They are how MiTow reaches you about
          work you are doing or money you are owed.
        </Text>
      </View>
    </Screen>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  disabled,
  onValueChange,
  last,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={rowStyle(last)}>
      <View style={{ flex: 1, gap: 2, paddingRight: 12 }}>
        <Text style={{ fontSize: 15, lineHeight: 21 }}>{title}</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>{subtitle}</Text>
      </View>
      <Toggle value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

function AlwaysOnRow({
  title,
  subtitle,
  last,
}: {
  title: string;
  subtitle: string;
  last?: boolean;
}) {
  return (
    <View style={rowStyle(last)}>
      <View style={{ flex: 1, gap: 2, paddingRight: 12 }}>
        <Text style={{ fontSize: 15, lineHeight: 21 }}>{title}</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>{subtitle}</Text>
      </View>
      <Text style={{ fontSize: 13, lineHeight: 18, color: driverColors.online }}>On</Text>
    </View>
  );
}

function rowStyle(last?: boolean) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: HAIRLINE,
  };
}
