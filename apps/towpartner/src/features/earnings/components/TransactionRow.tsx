import React from 'react';
import { View } from 'react-native';
import { Text } from '@towing/ui';
import { Check, Gift, Landmark, Receipt, RotateCcw } from '@/icons';
import { IconChip } from '@/components/IconChip';
import { driverColors } from '@/theme/driverColors';
import { formatPaise, formatRelativeTime } from '@/utils/format';
import type { Transaction, TransactionKind } from '../types';
import { Pressable } from '@/motion';

/**
 * One row in the Earnings "Recent Transactions" list (no chevron — calmer).
 *
 * A `kind`-KEYED META MAP, not a boolean. This branched on
 * `isBonus = tx.kind === 'bonus'` while there were only two kinds; Phase 19's
 * wallet feed is the raw ledger, so it also carries payout debits, §3.5
 * compensation and §14.5 reversals — and a third case bolted onto a boolean is
 * how the fourth one ends up rendering as "bonus". Same `STATUS_META` idiom the
 * jobs feature already uses.
 */
const KIND_META: Record<
  TransactionKind,
  { icon: typeof Check; tone: 'green' | 'purple' | 'blue'; color: string }
> = {
  job: { icon: Check, tone: 'green', color: driverColors.online },
  bonus: { icon: Gift, tone: 'purple', color: driverColors.chip.purple.fg },
  payout: { icon: Landmark, tone: 'blue', color: driverColors.chip.blue.fg },
  adjustment: { icon: Receipt, tone: 'purple', color: driverColors.chip.purple.fg },
  refund: { icon: RotateCcw, tone: 'purple', color: driverColors.chip.purple.fg },
};

export function TransactionRow({ tx, onPress }: { tx: Transaction; onPress?: () => void }) {
  const meta = KIND_META[tx.kind];
  // SIGNED. `formatPaise` renders the minus itself — it did not before Phase
  // 19, and `-50000` came out as `₹-,500`.
  const amount = formatPaise(tx.amountPaise);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${tx.title}, ${amount}, ${tx.statusLabel}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}
    >
      <IconChip icon={meta.icon} tone={meta.tone} />

      <View style={{ flex: 1, gap: 3 }}>
        <Text weight="medium" numberOfLines={1} style={{ fontSize: 15, lineHeight: 18 }}>
          {tx.title}
        </Text>
        <Text color="secondary" numberOfLines={1} style={{ fontSize: 12, lineHeight: 15 }}>
          {/*
            Formatted HERE, from an ISO instant. The server used to send
            `'18 May, 10:30 AM'`, and a server that hands out a formatted date
            has already decided the locale and the timezone for every client —
            the correction Phase 15 made on the customer side.
          */}
          {formatRelativeTime(tx.settledAt)}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text weight="medium" tabular style={{ fontSize: 15, lineHeight: 18 }}>
          {amount}
        </Text>
        <Text style={{ fontSize: 12, lineHeight: 15, color: meta.color }}>{tx.statusLabel}</Text>
      </View>
    </Pressable>
  );
}
