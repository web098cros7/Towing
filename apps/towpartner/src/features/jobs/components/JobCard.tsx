import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Card, Text, Skeleton, type IconComponent } from '@towing/ui';
import { MapPin, CreditCard, Route, Calendar, Truck } from '@/icons';
import { IconChip } from '@/components/IconChip';
import { driverColors } from '@/theme/driverColors';
import { formatPaise } from '@/utils/format';
import { JOB_STATUS_META } from '../statusMeta';
import type { Job, JobPayment } from '../types';

/** A Record, not a ternary — a new payment method becomes a compile error, not a silent "Online". */
const PAYMENT_LABEL: Record<JobPayment, string> = { online: 'Online' };

function MetaItem({
  icon: Icon,
  label,
  shrink = 1,
}: {
  icon: IconComponent;
  label: string;
  shrink?: number;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: shrink }}>
      <Icon size={14} color={theme.colors.textTertiary} strokeWidth={2} />
      <Text color="secondary" numberOfLines={1} style={{ fontSize: 14, lineHeight: 20 }}>
        {label}
      </Text>
    </View>
  );
}

/** A job history card on the Jobs screen (status chip · route · fare · meta). */
export function JobCard({ job, onPress }: { job: Job; onPress?: () => void }) {
  const theme = useTheme();
  // The leading chip alone carries the status — no extra status pill, so the
  // card stays calm.
  const chip = JOB_STATUS_META[job.status];

  return (
    <Card radius="card" padding={16} onPress={onPress} style={{ gap: 13 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <IconChip icon={chip.icon} tone={chip.tone} size={44} iconSize={18} />

        <View style={{ flex: 1, gap: 4 }}>
          <Text weight="semibold" numberOfLines={1} style={{ fontSize: 18, lineHeight: 25 }}>
            {job.vehicleName}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: driverColors.onlineDot }}
            />
            <Text color="secondary" numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, flex: 1 }}>
              {job.pickup}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MapPin size={14} color={theme.colors.error} strokeWidth={2.4} />
            <Text color="secondary" numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, flex: 1 }}>
              {job.drop}
            </Text>
          </View>
        </View>

        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text weight="semibold" tabular style={{ fontSize: 18, lineHeight: 25 }}>
            {formatPaise(job.farePaise)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text color="secondary" style={{ fontSize: 15, lineHeight: 22 }}>
              {PAYMENT_LABEL[job.payment]}
            </Text>
            <CreditCard size={15} color={theme.colors.textTertiary} strokeWidth={2} />
          </View>
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: theme.colors.border }} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <MetaItem icon={Truck} label={job.towTypeLabel} />
        <MetaItem icon={Route} label={`${job.distanceKm} km`} />
        <MetaItem icon={Calendar} label={job.dateTimeLabel} shrink={0} />
      </View>
    </Card>
  );
}

export function JobCardSkeleton() {
  const theme = useTheme();
  return (
    <Card radius="card" padding={16} style={{ gap: 13 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Skeleton width={44} height={44} radius={22} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="55%" height={16} />
          <Skeleton width="70%" height={12} />
          <Skeleton width="60%" height={12} />
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <Skeleton width={50} height={16} />
          <Skeleton width={44} height={12} />
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: theme.colors.border }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Skeleton width="26%" height={12} />
        <Skeleton width="22%" height={12} />
        <Skeleton width="34%" height={12} />
      </View>
    </Card>
  );
}
