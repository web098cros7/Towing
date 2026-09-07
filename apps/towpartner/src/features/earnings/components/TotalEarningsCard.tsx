import React from 'react';
import { Image, View } from 'react-native';
import { Text } from '@towing/ui';
import { TrendingUp, TrendingDown } from '@/icons';
import { HeroCard } from '@/components/HeroCard';
import { driverColors } from '@/theme/driverColors';
import { formatPaise, formatSignedPercent } from '@/utils/format';
import type { EarningsSummary } from '../types';

const wallet = require('@/assets/illustrations/wallet.png');

/**
 * Earnings hero: big total + week-over-week delta + wallet illustration.
 * Two-column flow layout so the copy and image can never collide.
 */
export function TotalEarningsCard({ summary }: { summary: EarningsSummary }) {
  const positive = summary.deltaPercent >= 0;
  const deltaColor = positive ? driverColors.online : '#DC2626';
  const DeltaIcon = positive ? TrendingUp : TrendingDown;

  return (
    <HeroCard style={{ padding: 20, borderRadius: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, lineHeight: 18, color: '#4B5563' }}>Total Earnings</Text>
          <Text
            weight="bold"
            tabular
            numberOfLines={1}
            style={{ fontSize: 44, lineHeight: 53, letterSpacing: -1, marginTop: 2 }}
          >
            {formatPaise(summary.totalPaise)}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 6,
              rowGap: 2,
              marginTop: 6,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <DeltaIcon size={11} color={deltaColor} strokeWidth={2.4} />
              <Text weight="medium" style={{ fontSize: 14, lineHeight: 17, color: deltaColor }}>
                {formatSignedPercent(summary.deltaPercent)}
              </Text>
            </View>
            <Text color="secondary" style={{ fontSize: 14, lineHeight: 17, flexShrink: 1 }}>
              {positive ? 'more than last week' : 'less than last week'}
            </Text>
          </View>
        </View>

        <Image
          source={wallet}
          resizeMode="contain"
          style={{ width: 88, aspectRatio: 240 / 245 }}
        />
      </View>
    </HeroCard>
  );
}
