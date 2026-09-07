import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card, EmptyState, ErrorState, Screen, Skeleton, Text } from '@towing/ui';
import { RefreshCw, TrendingUp } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { useWeeklyEarnings } from '@/features/earnings/api/earnings.queries';
import { formatPaise } from '@/utils/format';
import type { EarningsWeek } from '@/features/earnings/types';

/**
 * §12.2's weekly summary, on screen — the "View Report ›" the Earnings tab has
 * offered since Phase 12 with nothing behind it.
 *
 * The same rows the §12.2 push digest is built from, so a driver who taps the
 * notification and a driver who opens this screen see the same numbers. A
 * digest whose figures cannot be checked in the app is a figure nobody trusts.
 */
export function WeeklyEarningsScreen() {
  const navigation = useNavigation();
  const { data, isPending, isError, refetch } = useWeeklyEarnings();

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 32 }}>
      <DriverHeader
        leading="back"
        title="Weekly report"
        titleSize={22}
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, gap: 14 }}>
        {isError ? (
          <ErrorState
            title="Couldn't load your weekly report"
            onRetry={() => refetch()}
            icon={RefreshCw}
          />
        ) : isPending ? (
          <>
            <Skeleton width="100%" height={112} radius={16} />
            <Skeleton width="100%" height={112} radius={16} />
          </>
        ) : data && data.length > 0 ? (
          data.map((week) => <WeekCard key={week.weekStart} week={week} />)
        ) : (
          <EmptyState
            icon={TrendingUp}
            title="No weeks to report yet"
            body="Once you complete and get paid for trips, your weekly totals appear here."
          />
        )}
      </View>
    </Screen>
  );
}

function WeekCard({ week }: { week: EarningsWeek }) {
  return (
    <Card padding={16} bordered>
      <Text weight="medium" style={{ fontSize: 15, lineHeight: 20 }}>
        Week of {weekLabel(week.weekStart)}
      </Text>

      <Text weight="bold" tabular style={{ fontSize: 28, lineHeight: 34, marginTop: 6 }}>
        {formatPaise(week.netPaise)}
      </Text>

      <Text color="secondary" style={{ fontSize: 13, lineHeight: 19, marginTop: 4 }}>
        {week.jobs} {week.jobs === 1 ? 'trip' : 'trips'} · {formatPaise(week.grossPaise)} fare
        {' − '}
        {formatPaise(week.commissionPaise)} commission
      </Text>
    </Card>
  );
}

/** "11 May 2026" from an ISO date, formatted here rather than by the server. */
function weekLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
