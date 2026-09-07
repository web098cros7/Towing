import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Screen, Skeleton, ErrorState, OfflineBanner } from '@towing/ui';
import { Wallet, FileText, IndianRupee, Gift, CalendarDays, RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { SectionHeading } from '@/components/SectionHeading';
import { StatRowCard } from '@/components/StatRowCard';
import { DividedCard } from '@/components/DividedCard';
import { FilterTabs, type FilterTabOption } from '@/components/FilterTabs';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTabBarSpace } from '@/navigation/DriverTabBar';
import { useEarnings } from '@/features/earnings/api/earnings.queries';
import { TotalEarningsCard } from '@/features/earnings/components/TotalEarningsCard';
import { EarningsTrendChart } from '@/features/earnings/components/EarningsTrendChart';
import { TransactionRow } from '@/features/earnings/components/TransactionRow';
import type { EarningsPeriod } from '@/features/earnings/types';
import { formatPaise, pad2 } from '@/utils/format';
import type { RootStackParamList } from '@/navigation/types';

const PERIODS: FilterTabOption<EarningsPeriod>[] = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'custom', label: 'Custom', icon: CalendarDays },
];

export function EarningsScreen() {
  const online = useOnlineStatus();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [period, setPeriod] = useState<EarningsPeriod>('week');
  const tabBarSpace = useTabBarSpace();
  const { data, isPending, isError, refetch } = useEarnings(period);

  return (
    <Screen
      scroll
      edges={['top']}
      banner={<OfflineBanner visible={!online} />}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
    >
      <DriverHeader title="Earnings" bellBadge onBell={() => navigation.navigate('Notifications')} />

      <View style={{ paddingHorizontal: 20, gap: 20 }}>
        {isError ? (
          <ErrorState title="Couldn't load your earnings" onRetry={() => refetch()} icon={RefreshCw} />
        ) : (
          <>
            {isPending || !data ? (
              <Skeleton width="100%" height={151} radius={16} />
            ) : (
              <TotalEarningsCard summary={data.summary} />
            )}

            {/*
              §9.2.4's payout entry point. The Earnings tab has shown a balance
              since Phase 12 with no way to withdraw it — which is the half of
              "earnings" a driver actually cares about.
            */}
            {data ? (
              <Button
                variant="secondary"
                label={`Withdraw ${formatPaise(data.wallet.availablePaise)}`}
                leftIcon={Wallet}
                onPress={() => navigation.navigate('Payouts')}
                accessibilityLabel="Payouts"
                fullWidth
              />
            ) : null}

            <FilterTabs options={PERIODS} value={period} onChange={setPeriod} labelSize={12} />

            {/* Earnings Summary */}
            <View style={{ gap: 12 }}>
              <SectionHeading title="Earnings Summary" />
              {isPending || !data ? (
                <Skeleton width="100%" height={126} radius={16} />
              ) : (
                <StatRowCard
                  chipSize={44}
                  valueSize={16}
                  items={[
                    {
                      icon: Wallet,
                      tone: 'gold',
                      value: formatPaise(data.summary.totalPaise),
                      label: 'Total Earnings',
                      tabular: true,
                    },
                    {
                      icon: FileText,
                      tone: 'green',
                      value: pad2(data.summary.jobsCompleted),
                      label: 'Jobs Completed',
                      tabular: true,
                    },
                    {
                      icon: IndianRupee,
                      tone: 'blue',
                      value: formatPaise(data.summary.avgPerJobPaise),
                      label: 'Avg. Per Job',
                      tabular: true,
                    },
                    {
                      icon: Gift,
                      tone: 'purple',
                      value: formatPaise(data.summary.bonusPaise),
                      label: 'Bonus',
                      tabular: true,
                    },
                  ]}
                />
              )}
            </View>

            {/* Earnings Trend */}
            <View style={{ gap: 12 }}>
              <SectionHeading
                title="Earnings Trend"
                actionLabel="View Report ›"
                onAction={() => navigation.navigate('WeeklyEarnings')}
              />
              {isPending || !data ? (
                <Skeleton width="100%" height={235} radius={16} />
              ) : (
                <EarningsTrendChart points={data.trend} />
              )}
            </View>

            {/* Recent Transactions */}
            <View style={{ gap: 12 }}>
              <SectionHeading
                title="Recent Transactions"
                actionLabel="View All"
                onAction={() => navigation.navigate('EarningsTrips')}
              />
              {isPending || !data ? (
                <Skeleton width="100%" height={240} radius={16} />
              ) : (
                <DividedCard>
                  {data.transactions.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} />
                  ))}
                </DividedCard>
              )}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}
