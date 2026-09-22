import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Screen, Text, ErrorState, EmptyState, OfflineBanner } from '@towing/ui';
import { CalendarDays, ClipboardList, RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { FilterTabs, type FilterTabOption } from '@/components/FilterTabs';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTabBarSpace } from '@/navigation/DriverTabBar';
import { useJobs } from '@/features/jobs/api/jobs.queries';
import { JobCard, JobCardSkeleton } from '@/features/jobs/components/JobCard';
import type { JobFilter } from '@/features/jobs/types';
import type { RootStackParamList } from '@/navigation/types';

const FILTERS: FilterTabOption<JobFilter>[] = [
  { key: 'all', label: 'All' },
  { key: 'assigned', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const SUBTITLE: Record<JobFilter, string> = {
  all: 'Showing all your jobs',
  assigned: 'Showing jobs in progress',
  completed: 'Showing completed jobs',
  cancelled: 'Showing cancelled jobs',
};

export function JobsScreen() {
  const theme = useTheme();
  const online = useOnlineStatus();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [filter, setFilter] = useState<JobFilter>('all');
  const tabBarSpace = useTabBarSpace();
  const { data, isPending, isError, refetch } = useJobs(filter);

  return (
    <Screen
      scroll
      edges={['top']}
      banner={<OfflineBanner visible={!online} />}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
    >
      <DriverHeader title="Jobs" bellBadge onBell={() => navigation.navigate('Notifications')} />

      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <FilterTabs options={FILTERS} value={filter} onChange={setFilter} labelSize={14} />
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CalendarDays size={14} color={theme.colors.textTertiary} strokeWidth={2} />
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
            {SUBTITLE[filter]}
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, gap: 18 }}>
        {isPending ? (
          <>
            <JobCardSkeleton />
            <JobCardSkeleton />
            <JobCardSkeleton />
          </>
        ) : isError ? (
          <ErrorState title="Couldn't load your jobs" onRetry={() => refetch()} icon={RefreshCw} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No jobs found"
            body="Jobs you take will show up here."
          />
        ) : (
          data.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onPress={() => navigation.navigate('JobDetails', { jobId: job.id })}
            />
          ))
        )}
      </View>
    </Screen>
  );
}
