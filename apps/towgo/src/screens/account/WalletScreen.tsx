import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '@towing/theme';
import { EmptyState, ErrorState, Skeleton, Text } from '@towing/ui';
import { Wallet } from '@/icons';
import { SubScreen } from '@/components/SubScreen';
import { SettingsList } from '@/components/SettingsList';
import { useWallet, useWalletTransactions } from '@/features/payments/api/payments.queries';
import { formatPaise, formatRelativeTime } from '@/utils/format';
import type { WalletTransactionDto } from '@towing/api-contracts';

/**
 * §9.1.9's "in-app wallet balance".
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
  const navigation = useNavigation();
  const theme = useTheme();

  const wallet = useWallet();
  const transactions = useWalletTransactions();

  return (
    <SubScreen title="Wallet" onBack={() => navigation.goBack()}>
      <View style={{ gap: 24 }}>
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
            Balance
          </Text>
          {wallet.isPending ? (
            <Skeleton width={160} height={44} radius={10} />
          ) : (
            <Text weight="bold" tabular style={{ fontSize: 40, lineHeight: 48, marginTop: 4 }}>
              {formatPaise(wallet.data?.balancePaise ?? 0)}
            </Text>
          )}
          <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17, marginTop: 6 }}>
            Applied automatically to your next trip
          </Text>
        </View>

        {transactions.isError ? (
          <ErrorState title="Couldn't load your wallet" onRetry={() => transactions.refetch()} />
        ) : transactions.isPending ? (
          <Skeleton width="100%" height={180} radius={16} />
        ) : transactions.data && transactions.data.length > 0 ? (
          <SettingsList>
            {transactions.data.map((entry) => (
              <TransactionRow key={entry.id} entry={entry} />
            ))}
          </SettingsList>
        ) : (
          <EmptyState
            icon={Wallet}
            title="Nothing here yet"
            body="Refunds and credits will appear in this list."
          />
        )}
      </View>
    </SubScreen>
  );
}

function TransactionRow({ entry }: { entry: WalletTransactionDto }) {
  const theme = useTheme();
  const credit = entry.amountPaise > 0;

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}
      accessibilityLabel={`${entry.reason ?? entry.type}, ${formatPaise(entry.amountPaise)}`}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, lineHeight: 20 }} numberOfLines={1}>
          {/* The ledger's own reason, which §14.3 requires to carry the band. */}
          {entry.reason ?? entry.type}
        </Text>
        <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17 }}>
          {formatRelativeTime(entry.createdAt)}
        </Text>
      </View>

      <Text
        weight="medium"
        tabular
        style={{
          fontSize: 15,
          lineHeight: 20,
          color: credit ? theme.colors.success : theme.colors.textPrimary,
        }}
      >
        {/* SIGNED. `formatPaise` renders the minus — it did not before Phase 19. */}
        {credit ? `+${formatPaise(entry.amountPaise)}` : formatPaise(entry.amountPaise)}
      </Text>
    </View>
  );
}
