import React from 'react';
import { Modal, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Button, Skeleton, Text } from '@towing/ui';
import { formatPaise } from '@/utils/format';
import { useCancellationQuote } from '../api/tracking.queries';

/**
 * §9.1.7's "cancel button (policy-aware, shows fee before confirming)".
 *
 * WHAT WAS THERE BEFORE: `RequestDetailsCard`'s "Cancel Request" called
 * `onCancel`, which the tracking screen wired to `navigation.popToTop()`. It
 * cancelled nothing. The customer left the screen, the booking stayed live, and
 * a driver kept coming.
 *
 * THE FEE IS FETCHED WHEN THE SHEET OPENS, never with the screen. §3.5's tiers
 * are 0–2 minutes free, 2–10 partial, beyond that full — so a quote fetched on
 * mount and shown five minutes later would name the wrong tier at exactly the
 * moment the customer commits to it. `useCancellationQuote` is `enabled`-gated on
 * this sheet's visibility and `gcTime: 0` so it cannot be served from cache.
 *
 * IT SHOWS A FEE IT CANNOT YET COLLECT, deliberately. Phase 19 owns collection;
 * until then a chargeable cancellation is refused by the server. Quoting the
 * charge anyway is honest — the customer learns the policy before they act on it
 * — and hiding it would train them to expect free cancellation right up until
 * the release that starts billing.
 */

export function CancelTripSheet({
  bookingId,
  visible,
  onDismiss,
  onConfirm,
  isCancelling,
}: {
  bookingId: string;
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  isCancelling: boolean;
}) {
  const theme = useTheme();
  const { data: quote, isLoading } = useCancellationQuote(bookingId, visible);

  const free = quote?.tier === 'free';

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
            Cancel this trip?
          </Text>

          {isLoading || !quote ? (
            <Skeleton width="100%" height={52} radius={12} />
          ) : (
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 14, lineHeight: 20 }} color="secondary">
                {quote.reason}
              </Text>

              <Text weight="semibold" style={{ fontSize: 16, lineHeight: 22 }}>
                {free
                  ? 'No cancellation fee'
                  : `Cancellation fee ${formatPaise(quote.feePaise)}`}
              </Text>

              {/*
                The one thing a customer must not be surprised by later. Phase 19
                turns `chargeable` true and this line disappears on its own.
              */}
              {!free && !quote.chargeable ? (
                <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17 }}>
                  We cannot take this fee yet, so cancelling here is not possible.
                  Please call your driver if your plans have changed.
                </Text>
              ) : null}
            </View>
          )}

          <View style={{ gap: 10 }}>
            <Button
              variant="destructive"
              onPress={onConfirm}
              // Refused server-side anyway; disabling it here means the customer
              // gets an explanation instead of an error toast.
              disabled={isCancelling || isLoading || (!free && !quote?.chargeable)}
              accessibilityLabel="Confirm cancel trip"
              label={isCancelling ? 'Cancelling…' : 'Yes, cancel trip'}
              fullWidth
            />
            <Button
              variant="ghost"
              onPress={onDismiss}
              accessibilityLabel="Keep my trip"
              label="Keep my trip"
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
