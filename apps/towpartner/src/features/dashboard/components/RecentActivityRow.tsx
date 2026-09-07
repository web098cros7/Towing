import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Text } from '@towing/ui';
import { ArrowRight } from '@/icons';
import { IconChip } from '@/components/IconChip';
import { driverColors } from '@/theme/driverColors';
import { formatPaise } from '@/utils/format';
import { JOB_STATUS_META } from '@/features/jobs/statusMeta';
import type { RecentJob } from '../types';
import { Pressable } from '@/motion';

/**
 * One row in the Home "Recent Activity" list. No trailing chevron — the whole
 * row is tappable and the extra glyph only crowded the fare column.
 */
export function RecentActivityRow({ item, onPress }: { item: RecentJob; onPress?: () => void }) {
  const theme = useTheme();
  // Reads the shared status map rather than a completed/else ternary — with the
  // full ten-status vocabulary, "not completed" is not the same as "cancelled".
  const meta = JOB_STATUS_META[item.status];
  const statusColor = driverColors.chip[meta.tone].fg;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.vehicleName}, ${meta.label}, ${formatPaise(item.farePaise)}`}
      style={() => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
      })}
    >
      <IconChip icon={meta.icon} tone={meta.tone} size={44} iconSize={18} />

      <View style={{ flex: 1 }}>
        <Text weight="medium" numberOfLines={1} style={{ fontSize: 16, lineHeight: 24 }}>
          {item.vehicleName}
        </Text>
        <Text color="secondary" numberOfLines={1} style={{ fontSize: 13, lineHeight: 19 }}>
          {item.pickup}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
          <ArrowRight size={11} color={theme.colors.textSecondary} strokeWidth={2.4} />
          <Text color="secondary" numberOfLines={1} style={{ fontSize: 13, lineHeight: 19, flex: 1 }}>
            {item.drop}
          </Text>
        </View>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text weight="medium" tabular style={{ fontSize: 15, lineHeight: 22 }}>
          {formatPaise(item.farePaise)}
        </Text>
        <Text style={{ fontSize: 12, lineHeight: 17, color: statusColor }}>{meta.label}</Text>
      </View>
    </Pressable>
  );
}
