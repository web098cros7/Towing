import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  Skeleton,
  StatusBadge,
  Text,
} from '@towing/ui';
import { Landmark, RefreshCw, Wallet } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { DividedCard } from '@/components/DividedCard';
import { SectionHeading } from '@/components/SectionHeading';
import {
  useEarnings,
  usePayoutAccount,
  usePayouts,
} from '@/features/earnings/api/earnings.queries';
import { RequestPayoutSheet } from '@/features/earnings/components/RequestPayoutSheet';
import { formatPaise, formatRelativeTime } from '@/utils/format';
import type { Payout } from '@/features/earnings/types';
import type { RootStackParamList } from '@/navigation/types';

/**
 * §9.2.4's "payout request (to bank via Route), payout history & status".
 *
 * THE APPROVAL STATE IS RENDERED, not just the vendor status, and that is the
 * difference between a working screen and a support ticket. §14.4's threshold
 * means a large payout sits at `requested` with no provider reference for as
 * long as Finance takes — a driver looking at "Requested" with no explanation
 * concludes the app is broken.
 */
export function PayoutsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: earnings } = useEarnings('month');
  const { data: account } = usePayoutAccount();
  const { data: payouts, isPending, isError, refetch } = usePayouts();

  const wallet = earnings?.wallet;
  const linked = account?.status === 'active';

  const canRequest = useMemo(
    () => Boolean(linked && wallet && wallet.availablePaise >= wallet.minPayoutPaise),
    [linked, wallet],
  );

  const openSheet = useCallback(() => setSheetOpen(true), []);

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 32 }}>
      <DriverHeader
        leading="back"
        title="Payouts"
        titleSize={22}
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, gap: 20 }}>
        <Card padding={20} bordered>
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
            Available to withdraw
          </Text>
          <Text weight="bold" tabular style={{ fontSize: 34, lineHeight: 42, marginTop: 4 }}>
            {wallet ? formatPaise(wallet.availablePaise) : '—'}
          </Text>
          {wallet && wallet.balancePaise !== wallet.availablePaise ? (
            <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17, marginTop: 4 }}>
              {formatPaise(wallet.balancePaise - wallet.availablePaise)} is held in a payout that
              has not settled yet
            </Text>
          ) : null}

          <View style={{ marginTop: 16 }}>
            <Button
              label="Request payout"
              onPress={openSheet}
              disabled={!canRequest}
              accessibilityLabel="Request payout"
              fullWidth
            />
          </View>

          {/*
            The reason it is disabled, always. A greyed-out button with no
            explanation is the worst version of this screen.
          */}
          {!linked ? (
            <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17, marginTop: 10 }}>
              Add your bank account first so we know where to send the money.
            </Text>
          ) : wallet && wallet.availablePaise < wallet.minPayoutPaise ? (
            <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17, marginTop: 10 }}>
              The minimum payout is {formatPaise(wallet.minPayoutPaise)}.
            </Text>
          ) : null}
        </Card>

        {!linked ? (
          <Button
            variant="secondary"
            label="Add bank account"
            leftIcon={Landmark}
            onPress={() => navigation.navigate('BankDetails')}
            accessibilityLabel="Add bank account"
            fullWidth
          />
        ) : null}

        <View style={{ gap: 12 }}>
          <SectionHeading title="Payout history" />

          {isError ? (
            <ErrorState title="Couldn't load your payouts" onRetry={() => refetch()} icon={RefreshCw} />
          ) : isPending ? (
            <Skeleton width="100%" height={180} radius={16} />
          ) : payouts && payouts.length > 0 ? (
            <DividedCard>
              {payouts.map((payout) => (
                <PayoutRow key={payout.id} payout={payout} />
              ))}
            </DividedCard>
          ) : (
            <EmptyState
              icon={Wallet}
              title="No payouts yet"
              body="Money you withdraw will show up here."
            />
          )}
        </View>

        <RequestPayoutSheet
          visible={sheetOpen}
          onDismiss={() => setSheetOpen(false)}
          wallet={wallet ?? null}
        />
      </View>
    </Screen>
  );
}

/**
 * One payout, showing what is ACTUALLY happening to it.
 *
 * §5.5's vocabulary is `requested → processing → paid | failed`, and §14.4's
 * approval sits on a separate axis — so a row can be `requested` because it has
 * not been picked up yet, or `requested` because a human has to look at it
 * first. Those read very differently to the person waiting for the money.
 */
function PayoutRow({ payout }: { payout: Payout }) {
  const { label, tone, detail } = describe(payout);

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}
      accessibilityLabel={`${formatPaise(payout.amountPaise)}, ${label}`}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text weight="medium" tabular style={{ fontSize: 16, lineHeight: 20 }}>
          {formatPaise(payout.amountPaise)}
        </Text>
        <Text color="secondary" style={{ fontSize: 12, lineHeight: 17 }}>
          {formatRelativeTime(payout.requestedAt)}
          {detail ? ` · ${detail}` : ''}
        </Text>
      </View>

      <StatusBadge label={label} tone={tone} pill />
    </View>
  );
}

function describe(payout: Payout): {
  label: string;
  tone: 'success' | 'error' | 'warning' | 'info' | 'neutral';
  detail: string | null;
} {
  if (payout.approvalState === 'rejected') {
    return { label: 'Declined', tone: 'error', detail: payout.rejectionReason };
  }

  if (payout.approvalState === 'pending_approval') {
    // The whole reason `approvalState` crosses the wire.
    return { label: 'Awaiting approval', tone: 'warning', detail: 'Being reviewed by our team' };
  }

  switch (payout.status) {
    case 'paid':
      return { label: 'Paid', tone: 'success', detail: null };
    case 'failed':
      return { label: 'Failed', tone: 'error', detail: payout.failureReason };
    case 'processing':
      return { label: 'Processing', tone: 'info', detail: 'On its way to your bank' };
    default:
      return { label: 'Requested', tone: 'neutral', detail: null };
  }
}
