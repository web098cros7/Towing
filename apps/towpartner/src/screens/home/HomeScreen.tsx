import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Screen, Text, Skeleton, ErrorState, OfflineBanner } from '@towing/ui';
import { ClipboardList, Wallet, Star, IndianRupee, CarFront, User, RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { SectionHeading } from '@/components/SectionHeading';
import { StatRowCard } from '@/components/StatRowCard';
import { QuickActionTile } from '@/components/QuickActionTile';
import { DividedCard } from '@/components/DividedCard';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTabBarSpace } from '@/navigation/DriverTabBar';
import { useDashboard } from '@/features/dashboard/api/dashboard.queries';
import { useDriverStatusStore } from '@/features/dashboard/store/driverStatusStore';
import { OnlineStatusCard } from '@/features/dashboard/components/OnlineStatusCard';
import { usePresence } from '@/features/presence/api/presence.queries';
import { LocationDisclosureSheet } from '@/features/presence/components/LocationDisclosureSheet';
import { useAuthStore } from '@/features/auth/store/authStore';
import { RecentActivityRow } from '@/features/dashboard/components/RecentActivityRow';
import { driverColors } from '@/theme/driverColors';
import { formatPaise, pad2 } from '@/utils/format';
import type { RootStackParamList } from '@/navigation/types';

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

const DARK_ICON = '#1F2937';
const INDIGO_ICON = '#312E81';

export function HomeScreen() {
  const theme = useTheme();
  const online = useOnlineStatus();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isOnline = useDriverStatusStore((s) => s.isOnline);
  const { goOnline, goOffline, busy, failure, zoneName, clearFailure } = usePresence();
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  // RootNavigator keeps this synced off the authoritative `/kyc/status` read
  // (`useKycStatus`'s own comment) — reading it here rather than re-deriving
  // is the whole point of that sync. `kycVerified` additionally requires that
  // read to have actually completed THIS session — `identity.kycStatus`
  // alone can be a stale 'approved' hydrated from a previous session whose
  // approval was since revoked, and the toggle must not go interactive off
  // an unconfirmed value even for the brief window before the fetch settles.
  const approved = useAuthStore((s) => s.identity?.kycStatus) === 'approved';
  const kycVerified = useAuthStore((s) => s.kycVerified);
  const tabBarSpace = useTabBarSpace();
  const { data, isPending, isError, refetch } = useDashboard();

  const goToTab = useCallback(
    (screen: 'Jobs' | 'Earnings' | 'Profile') => navigation.navigate('Tabs', { screen }),
    [navigation],
  );

  /**
   * The toggle no longer flips a local boolean — it calls the server.
   *
   * Going online shows the PROMINENT DISCLOSURE first (a Play policy
   * requirement: the in-app explanation must precede the OS prompt, and it is
   * shown every time until the driver accepts). Going offline needs no
   * disclosure and stops capture immediately.
   */
  const onToggle = useCallback(() => {
    clearFailure();
    if (isOnline) {
      void goOffline();
      return;
    }
    setDisclosureVisible(true);
  }, [isOnline, goOffline, clearFailure]);

  const onDisclosureAccept = useCallback(() => {
    setDisclosureVisible(false);
    // Only now is the OS prompt requested — `goOnline` asks for foreground then
    // background permission in that order.
    void goOnline();
  }, [goOnline]);

  const greeting = timeGreeting();
  const title = data ? `${greeting}, ${data.driverName}` : greeting;

  return (
    <Screen
      scroll
      edges={['top']}
      banner={<OfflineBanner visible={!online} />}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
    >
      <DriverHeader
        title={title}
        subtitle="Ready to help on the road"
        titleSize={22}
        bellBadge
        onBell={() => navigation.navigate('Notifications')}
      />

      <View style={{ paddingHorizontal: 20, gap: 20 }}>
        <OnlineStatusCard
          isOnline={isOnline}
          onToggle={onToggle}
          disabled={!approved || !kycVerified}
          busy={busy}
          zoneName={zoneName}
          failure={failure}
        />

        {isError ? (
          <ErrorState
            title="Couldn't load your dashboard"
            onRetry={() => refetch()}
            retryLabel="Retry"
            icon={RefreshCw}
          />
        ) : (
          <>
            {/* Today's Summary */}
            <View style={{ gap: 12 }}>
              <SectionHeading title="Today's Summary" />
              {isPending || !data ? (
                <Skeleton width="100%" height={150} radius={16} />
              ) : (
                <StatRowCard
                  items={[
                    {
                      icon: ClipboardList,
                      tone: 'orange',
                      value: pad2(data.summary.jobsCompleted),
                      label: 'Jobs Completed',
                      tabular: true,
                    },
                    {
                      icon: IndianRupee,
                      tone: 'green',
                      value: formatPaise(data.summary.earningsPaise),
                      label: 'Earnings',
                      tabular: true,
                    },
                    {
                      icon: Star,
                      tone: 'blue',
                      value: data.summary.rating.toFixed(1),
                      label: 'Rating',
                      tabular: true,
                    },
                  ]}
                />
              )}
            </View>

            {/* Quick Actions */}
            <View style={{ gap: 12 }}>
              <SectionHeading title="Quick Actions" />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <QuickActionTile
                  icon={ClipboardList}
                  label="My Jobs"
                  bg={driverColors.tile.cream}
                  iconColor={DARK_ICON}
                  onPress={() => goToTab('Jobs')}
                />
                <QuickActionTile
                  icon={Wallet}
                  label="Earnings"
                  bg={driverColors.tile.mint}
                  iconColor={DARK_ICON}
                  onPress={() => goToTab('Earnings')}
                />
                <QuickActionTile
                  icon={CarFront}
                  label="Vehicles"
                  bg={driverColors.tile.blue}
                  iconColor={INDIGO_ICON}
                  onPress={() => navigation.navigate('Capabilities')}
                />
                <QuickActionTile
                  icon={User}
                  label="Profile"
                  bg={driverColors.tile.purple}
                  iconColor={INDIGO_ICON}
                  onPress={() => goToTab('Profile')}
                />
              </View>
            </View>

            {/* Recent Activity */}
            <View style={{ gap: 12 }}>
              <SectionHeading title="Recent Activity" actionLabel="View All" onAction={() => goToTab('Jobs')} />
              {isPending || !data ? (
                <Skeleton width="100%" height={190} radius={16} />
              ) : (
                <DividedCard>
                  {data.recentActivity.map((item) => (
                    <RecentActivityRow
                      key={item.id}
                      item={item}
                      onPress={() => navigation.navigate('JobDetails', { jobId: item.id })}
                    />
                  ))}
                </DividedCard>
              )}
            </View>
          </>
        )}
      </View>

      {/*
        Play policy: the disclosure must appear BEFORE the OS prompt, and it is
        re-shown on every go-online attempt until the driver accepts it.
      */}
      <LocationDisclosureSheet
        visible={disclosureVisible}
        onAccept={onDisclosureAccept}
        onDismiss={() => setDisclosureVisible(false)}
      />
    </Screen>
  );
}
