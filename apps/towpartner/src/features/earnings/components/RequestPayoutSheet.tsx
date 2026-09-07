import React, { useEffect, useMemo, useState } from 'react';
import { Modal, TextInput, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';
import { driverColors } from '@/theme/driverColors';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { formatPaise } from '@/utils/format';
import { useRequestPayout } from '../api/earnings.queries';
import type { EarningsWallet } from '../types';

/**
 * §14.4's payout request.
 *
 * ⚠ THE IDEMPOTENCY KEY IS MINTED ONCE PER OPENING, held in component state,
 * and passed explicitly. `apiFetch`'s `idempotent: true` mints a key per CALL,
 * so a driver who taps twice — or whose first attempt timed out and who taps
 * again — would send two different keys and get two payouts against one
 * intent. The web console's `RequestPayoutDialog` has used exactly this shape
 * since Track A Phase 7; this is the same discipline on mobile.
 *
 * A NEW OPENING IS A NEW INTENT and gets a new key, which is the correct
 * distinction: closing the sheet and reopening it means the driver has decided
 * again.
 */
export function RequestPayoutSheet({
  visible,
  onDismiss,
  wallet,
}: {
  visible: boolean;
  onDismiss: () => void;
  wallet: EarningsWallet | null;
}) {
  const theme = useTheme();
  const [amount, setAmount] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const requestPayout = useRequestPayout();

  useEffect(() => {
    if (!visible) return;
    // One key per opening — see the header.
    setIdempotencyKey(newIdempotencyKey());
    setAmount(wallet ? String(Math.floor(wallet.availablePaise / 100)) : '');
    requestPayout.reset();
    // `requestPayout` is stable enough; re-running on every render would reset
    // the key mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, wallet?.availablePaise]);

  const amountPaise = useMemo(() => {
    const rupees = Number(amount.replace(/[^0-9]/g, ''));
    return Number.isFinite(rupees) ? rupees * 100 : 0;
  }, [amount]);

  /**
   * Client-side pre-checks, and THE SERVER'S ANSWER IS ALWAYS THE AUTHORITY.
   * These exist so the driver gets an explanation before they tap rather than
   * an error toast after — `PayoutsService` runs the same three checks and
   * returns `payout_below_minimum` / `payout_above_maximum` /
   * `insufficient_balance` regardless.
   */
  const problem = useMemo(() => {
    if (!wallet) return null;
    if (amountPaise <= 0) return 'Enter an amount';
    if (amountPaise < wallet.minPayoutPaise) {
      return `The minimum payout is ${formatPaise(wallet.minPayoutPaise)}`;
    }
    if (amountPaise > wallet.maxPayoutPaise) {
      return `The maximum payout is ${formatPaise(wallet.maxPayoutPaise)}`;
    }
    if (amountPaise > wallet.availablePaise) {
      return `You have ${formatPaise(wallet.availablePaise)} available`;
    }
    return null;
  }, [amountPaise, wallet]);

  const submit = (): void => {
    if (problem) return;
    requestPayout.mutate(
      { amountPaise, idempotencyKey },
      { onSuccess: () => onDismiss() },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
        <View
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 24,
            paddingBottom: 36,
            gap: 16,
          }}
        >
          <Text weight="semibold" style={{ fontSize: 18, lineHeight: 24 }}>
            Request a payout
          </Text>

          <View style={{ gap: 6 }}>
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
              Amount in rupees
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              accessibilityLabel="Payout amount"
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 20,
                color: theme.colors.textPrimary,
              }}
            />
            {wallet ? (
              <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17 }}>
                {formatPaise(wallet.availablePaise)} available
              </Text>
            ) : null}
          </View>

          {problem ? (
            <Text style={{ fontSize: 13, lineHeight: 18, color: driverColors.chip.red.fg }}>
              {problem}
            </Text>
          ) : null}

          {requestPayout.isError ? (
            <Text style={{ fontSize: 13, lineHeight: 18, color: driverColors.chip.red.fg }}>
              {/*
                The server's own message, not a generic one — it distinguishes
                "a payout is already in progress" from "your balance is lower
                than the requested payout", and those need different actions.
              */}
              {(requestPayout.error as Error).message}
            </Text>
          ) : null}

          <View style={{ gap: 10 }}>
            <Button
              label={requestPayout.isPending ? 'Requesting…' : 'Request payout'}
              onPress={submit}
              disabled={Boolean(problem) || requestPayout.isPending}
              accessibilityLabel="Confirm payout request"
              fullWidth
            />
            <Button
              variant="ghost"
              label="Cancel"
              onPress={onDismiss}
              accessibilityLabel="Cancel payout request"
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
