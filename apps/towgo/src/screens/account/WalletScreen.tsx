import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorState } from '@towing/ui';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiMenuCard,
  MiMenuRow,
  mitowColors,
  mitowLayout,
  mitowRadii,
} from '@/design';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';
import { useWallet, useWalletTransactions } from '@/features/payments/api/payments.queries';
import { formatPaise } from '@/utils/format';
import type { WalletTransactionDto } from '@towing/api-contracts';
import type { RootStackParamList } from '@/navigation/types';

/**
 * Figma 44 · Wallet (295:3093).
 *
 * READ-ONLY, and deliberately so. There is no top-up: adding money to a wallet
 * is a second payment flow with its own capture, its own idempotency and its
 * own refund story, and neither §9.1.9 nor the plan's B1 slice asks for one.
 * Rows arrive here as §14.5 refunds and adjustments — money the platform gave
 * back, not money the customer parked.
 *
 * ⚠ THE FIRST SCREEN IN THIS APP TO RENDER NEGATIVE MONEY. `paiseSchema` has
 * been signed since Phase 7 ("ledger amounts carry their sign") but nothing had
 * ever displayed one, which is how `formatPaise(-50000)` returning `"₹-,500"`
 * survived undetected until this phase.
 */
export function WalletScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const wallet = useWallet();
  const transactions = useWalletTransactions();

  const rows = transactions.data ?? [];
  const hasRows = rows.length > 0;

  return (
    <MiScreen edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: Math.max(insets.bottom, 34),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* 295:3093 — Nav bar */}
        <MiNavBar title="MiTow Wallet" trailing="none" onBack={() => navigation.goBack()} />

        {/* 295:3344 — Balance card */}
        <View style={styles.balanceCard}>
          <MiText variant="bodyM15" color="onDark">
            Available balance
          </MiText>
          {wallet.isPending ? (
            <SlotPlaceholder variant="amount44" width={109} />
          ) : wallet.isError ? (
            // Never a silent ₹0 when the balance could not be read.
            <MiText variant="amount44" color="onDark" accessibilityLabel="Balance unavailable">
              —
            </MiText>
          ) : (
            <MiText variant="amount44" color="onDark">
              {formatPaise(wallet.data?.balancePaise ?? 0)}
            </MiText>
          )}
          {/* 295:3347 — Auto-apply pill */}
          <View style={styles.autoApplyPill}>
            <MiText variant="label13">Applied automatically to your next trip</MiText>
          </View>
        </View>

        {/* 295:3349 — Transactions */}
        {(transactions.isError || wallet.isError) && !hasRows ? (
          <ErrorState
            title="Couldn't load your wallet"
            onRetry={() => {
              void wallet.refetch();
              void transactions.refetch();
            }}
          />
        ) : hasRows ? (
          <View style={{ gap: mitowLayout.headingGap }}>
            <MiText variant="heading18">Transactions</MiText>
            <MiMenuCard radius={16} paddingVertical={4}>
              {rows.map((entry) => (
                <TransactionRow key={entry.id} entry={entry} />
              ))}
            </MiMenuCard>
          </View>
        ) : transactions.isPending ? null : (
          // Empty state: a new customer has no credits yet.
          <MiText variant="bodyM15" color="secondary" align="center">
            No transactions yet
          </MiText>
        )}

        {/* 295:3407 — Footer note */}
        <MiText variant="bodyS14" color="secondary">
          Refunds and credits appear here and are applied automatically to your next trip.
        </MiText>
      </ScrollView>
    </MiScreen>
  );
}

function TransactionRow({ entry }: { entry: WalletTransactionDto }) {
  const credit = entry.amountPaise > 0;
  const isRefund = entry.type.toLowerCase().includes('refund');

  const icon =
    isRefund && credit
      ? ({ color: 'refund' } as const)
      : entry.amountPaise < 0
        ? ({ color: 'tow-truck' } as const)
        : ({ color: 'gift' } as const);

  const title = (() => {
    if (entry.type === 'adjustment' && credit) return 'Goodwill credit';
    if (isRefund && credit) return 'Refund · cancelled booking';
    if (entry.amountPaise < 0 && !isRefund) return 'Used on trip';
    return entry.reason ?? entry.type;
  })();

  const dateLabel = dayMonth(entry.createdAt);
  const subtitle =
    entry.reason && entry.reason !== title ? `${dateLabel} · ${entry.reason}` : dateLabel;

  const valueText = credit
    ? `+${formatPaise(entry.amountPaise)}`
    : `−${formatPaise(Math.abs(entry.amountPaise))}`;

  return (
    <MiMenuRow
      icon={icon}
      title={title}
      subtitle={subtitle}
      showChevron={false}
      accessibilityLabel={`${title}, ${subtitle}, ${valueText}`}
      trailing={
        <MiText variant="strong16" color={credit ? 'success' : 'primary'}>
          {valueText}
        </MiText>
      }
    />
  );
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "02 Mar" — zero-padded day + short month. */
function dayMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  return `${day} ${MONTHS_SHORT[d.getMonth()]}`;
}

const styles = StyleSheet.create({
  balanceCard: {
    backgroundColor: mitowColors.surfaceInverse,
    borderRadius: 20,
    padding: 20,
    gap: 6,
    alignItems: 'flex-start',
  },
  autoApplyPill: {
    backgroundColor: mitowColors.brandYellow,
    borderRadius: mitowRadii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
