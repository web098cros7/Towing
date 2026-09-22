import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Skeleton, ErrorState, OfflineBanner } from '@towing/ui';
import {
  ClipboardList,
  Star,
  Calendar,
  ShieldCheck,
  User,
  CarFront,
  FileText,
  Wallet,
  Headphones,
  Bell,
  LogOut,
  RefreshCw,
} from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { SectionHeading } from '@/components/SectionHeading';
import { StatRowCard } from '@/components/StatRowCard';
import { MenuCard } from '@/components/MenuCard';
import { MenuRow } from '@/components/MenuRow';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTabBarSpace } from '@/navigation/DriverTabBar';
import { useDriverProfile } from '@/features/profile/api/profile.queries';
import { ProfileHeaderCard } from '@/features/profile/components/ProfileHeaderCard';
import { useLogout } from '@/features/auth/api/auth.queries';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { RootStackParamList } from '@/navigation/types';

export function ProfileScreen() {
  const online = useOnlineStatus();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabBarSpace = useTabBarSpace();
  const { data, isPending, isError, refetch } = useDriverProfile();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const logout = useLogout();

  return (
    <Screen
      scroll
      edges={['top']}
      banner={<OfflineBanner visible={!online} />}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
    >
      <DriverHeader title="Profile" bellBadge onBell={() => navigation.navigate('Notifications')} />

      <View style={{ paddingHorizontal: 20, gap: 20 }}>
        {isError ? (
          <ErrorState title="Couldn't load your profile" onRetry={() => refetch()} icon={RefreshCw} />
        ) : isPending || !data ? (
          <>
            <Skeleton width="100%" height={200} radius={16} />
            <Skeleton width="100%" height={120} radius={16} />
          </>
        ) : (
          <>
            <ProfileHeaderCard
              profile={data}
              onPress={() => navigation.navigate('PersonalInformation')}
            />

            <StatRowCard
              chipSize={44}
              valueSize={17}
              // Figma 78:930 says 9 -- held at 10, the legibility floor.
              labelSize={10}
              items={[
                {
                  icon: ClipboardList,
                  tone: 'orange',
                  value: String(data.stats.jobsCompleted),
                  label: 'Jobs Completed',
                  tabular: true,
                },
                {
                  icon: Star,
                  tone: 'green',
                  value: data.stats.rating === null ? '—' : data.stats.rating.toFixed(1),
                  label: 'Rating',
                  tabular: true,
                },
                {
                  icon: Calendar,
                  tone: 'blue',
                  value: data.stats.experienceLabel,
                  label: 'Experience',
                },
                {
                  icon: ShieldCheck,
                  tone: 'purple',
                  value:
                    data.stats.completionPercent === null
                      ? '—'
                      : `${data.stats.completionPercent}%`,
                  label: 'Completion',
                  tabular: true,
                },
              ]}
            />
          </>
        )}

        {/* Account */}
        <View style={{ gap: 12 }}>
          <SectionHeading title="Account" size={18} />
          <MenuCard>
            <MenuRow
              icon={User}
              tone="orange"
              title="Personal Information"
              subtitle="Update your personal details"
              onPress={() => navigation.navigate('PersonalInformation')}
            />
            <MenuRow
              icon={CarFront}
              tone="green"
              title="Capabilities"
              subtitle="Vehicle class & long-distance jobs"
              onPress={() => navigation.navigate('Capabilities')}
            />
            <MenuRow
              icon={ShieldCheck}
              tone="blue"
              title="KYC Verification"
              subtitle="View your document & verification status"
              onPress={() => navigation.navigate('KycStatus')}
            />
            <MenuRow
              icon={Wallet}
              tone="purple"
              title="Bank Details"
              subtitle="Manage your bank account"
              onPress={() => navigation.navigate('BankDetails')}
            />
            <MenuRow
              icon={ShieldCheck}
              tone="orange"
              title="Insurance & papers"
              subtitle="Your truck's insurance, RC, PUC and permit"
              onPress={() => navigation.navigate('Insurance')}
            />
            <MenuRow
              icon={Bell}
              tone="indigo"
              title="Notifications"
              subtitle="Choose what MiTow can send you"
              onPress={() => navigation.navigate('NotificationSettings')}
            />
          </MenuCard>
        </View>

        {/* Support */}
        <View style={{ gap: 12 }}>
          <SectionHeading title="Support" size={18} />
          <MenuCard>
            <MenuRow
              icon={Headphones}
              tone="green"
              title="Help & Support"
              subtitle="Get help and contact support"
              onPress={() => navigation.navigate('HelpSupport')}
            />
            <MenuRow
              icon={FileText}
              tone="blue"
              title="Legal & Privacy"
              subtitle="Terms, privacy policy, export or delete your data"
              onPress={() => navigation.navigate('Legal')}
            />
            <MenuRow
              icon={LogOut}
              title="Logout"
              danger
              center
              trailing="none"
              onPress={() => logout.mutate(refreshToken ?? '')}
            />
          </MenuCard>
        </View>
      </View>
    </Screen>
  );
}
