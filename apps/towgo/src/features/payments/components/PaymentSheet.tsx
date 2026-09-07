import React, { useCallback, useEffect, useState } from 'react';
import { Modal, TextInput, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Button, Skeleton, Text } from '@towing/ui';
import type { CouponValidationDto, PaymentIntentDto } from '@towing/api-contracts';
import { CircleCheck, TriangleAlert } from '@/icons';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { track } from '@/lib/analytics/analytics';
import { formatPaise } from '@/utils/format';
import { openCheckout } from '../razorpay';
import {
  useCapturePayment,
  useCreatePaymentIntent,
  useValidateCoupon,
} from '../api/payments.queries';

type Phase = 'review' | 'capturing' | 'success' | 'failed';

/**
 * §9.1.9's payment sheet.
 *
 * FOUR STATES, and §9.1.9 names all four: "capturing (spinner) · success
 * (animated check + invoice) · failed (retry / change method) · partial wallet
 * + gateway". The failure state is the one that matters most and is the easiest
 * to skip — §19.2 says a booking legitimately stays `COMPLETED (unpaid)` when
 * the gateway is down, so this must be able to say so without implying the trip
 * was lost.
 *
 * ⚠ ONE IDEMPOTENCY KEY PER SHEET SESSION, held in state. `apiFetch`'s
 * `idempotent: true` mints one per CALL — so a customer who taps Pay, times
 * out, and taps again would send two keys and could be charged twice. Minted on
 * open, reused for the intent and every capture retry, and a NEW opening is a
 * new intent and gets a new key.
 *
 * A RAW `<Modal>`, not `@/motion`'s `BottomSheet`, which is non-modal by design
 * (no backdrop, no portal, always visible). A payment is exactly the moment the
 * rest of the screen should not be interactive. Same idiom as `CancelTripSheet`.
 */
export function PaymentSheet({
  bookingId,
  visible,
  onDismiss,
  onPaid,
}: {
  bookingId: string;
  visible: boolean;
  onDismiss: () => void;
  onPaid: () => void;
}) {
  const theme = useTheme();
  const [phase, setPhase] = useState<Phase>('review');
  const [failure, setFailure] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [intent, setIntent] = useState<PaymentIntentDto | null>(null);

  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState<CouponValidationDto | null>(null);

  const createIntent = useCreatePaymentIntent();
  const capture = useCapturePayment();
  const validateCoupon = useValidateCoupon();

  useEffect(() => {
    if (!visible) return;

    // One key per opening — see the header.
    setIdempotencyKey(newIdempotencyKey());
    setPhase('review');
    setFailure(null);
    setCoupon(null);
    setCouponCode('');

    // §22.1: the server cannot see this. It knows it created an intent; it
    // cannot know whether a sheet actually appeared, and the gap between this
    // and the server's `payment_success` is the checkout abandonment rate.
    track('payment_sheet_opened');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    createIntent.mutate(
      { bookingId, purpose: 'booking', idempotencyKey },
      { onSuccess: setIntent, onError: () => setFailure('We could not start the payment.') },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, idempotencyKey]);

  const dismiss = useCallback(
    (reason: 'cancelled' | 'error') => {
      track('payment_sheet_dismissed', { reason });
      onDismiss();
    },
    [onDismiss],
  );

  const pay = useCallback(async () => {
    if (!intent) return;

    setPhase('capturing');
    setFailure(null);

    try {
      // `autoSettles` is the dev gateway saying there is no sheet to open. The
      // app then goes straight to capture, which is what makes the whole chain
      // walkable in Expo Go with no native module and no Razorpay account.
      const result = await openCheckout(intent);

      const settled = await capture.mutateAsync({
        bookingId,
        body: result,
        idempotencyKey,
      });

      if (settled.status === 'captured') {
        setPhase('success');
        return;
      }

      // §19.2: the booking is still `completed`, not lost.
      setPhase('failed');
      setFailure(settled.failureReason ?? 'Your bank did not confirm this payment.');
    } catch (error) {
      if ((error as { code?: string }).code === 'checkout_dismissed') {
        // The customer closed the sheet. Not a failure, and must not be
        // reported as one.
        setPhase('review');
        return;
      }

      setPhase('failed');
      setFailure(error instanceof Error ? error.message : 'Something went wrong.');
    }
  }, [bookingId, capture, idempotencyKey, intent]);

  const applyCoupon = useCallback(() => {
    if (!intent || couponCode.trim().length < 3) return;
    validateCoupon.mutate(
      { code: couponCode.trim(), subtotalPaise: intent.amountPaise },
      { onSuccess: setCoupon },
    );
  }, [couponCode, intent, validateCoupon]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => dismiss('cancelled')}
    >
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
          {phase === 'success' ? (
            <SuccessBody amountPaise={intent?.amountPaise ?? 0} onDone={onPaid} />
          ) : (
            <>
              <Text weight="semibold" style={{ fontSize: 18, lineHeight: 24 }}>
                Pay for your trip
              </Text>

              {!intent ? (
                <Skeleton width="100%" height={140} radius={12} />
              ) : (
                <Breakdown intent={intent} coupon={coupon} />
              )}

              {/* §9.1.9's "apply coupon". */}
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  value={couponCode}
                  onChangeText={setCouponCode}
                  autoCapitalize="characters"
                  placeholder="Coupon code"
                  placeholderTextColor={theme.colors.textTertiary}
                  accessibilityLabel="Coupon code"
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    color: theme.colors.textPrimary,
                  }}
                />
                <Button
                  variant="secondary"
                  size="md"
                  label={validateCoupon.isPending ? '…' : 'Apply'}
                  onPress={applyCoupon}
                  disabled={validateCoupon.isPending || couponCode.trim().length < 3}
                  accessibilityLabel="Apply coupon"
                />
              </View>

              {coupon && !coupon.valid ? (
                <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17 }}>
                  {couponMessage(coupon)}
                </Text>
              ) : null}

              {phase === 'failed' && failure ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <TriangleAlert size={16} color="#DC2626" />
                  <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: '#DC2626' }}>
                    {failure}
                    {'\n'}
                    {/*
                      §19.2's honest state, in words. The trip is not lost and
                      the customer is not being asked to book again.
                    */}
                    Your trip is safe — you can try again or use another method.
                  </Text>
                </View>
              ) : null}

              <View style={{ gap: 10 }}>
                <Button
                  label={
                    phase === 'capturing'
                      ? 'Confirming…'
                      : intent
                        ? `Pay ${formatPaise(payable(intent, coupon))}`
                        : 'Pay'
                  }
                  onPress={pay}
                  disabled={!intent || phase === 'capturing'}
                  accessibilityLabel="Pay for your trip"
                  fullWidth
                />
                <Button
                  variant="ghost"
                  label="Not now"
                  onPress={() => dismiss('cancelled')}
                  disabled={phase === 'capturing'}
                  accessibilityLabel="Close payment"
                  fullWidth
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SuccessBody({ amountPaise, onDone }: { amountPaise: number; onDone: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <CircleCheck size={48} color="#16A34A" />
      <Text weight="semibold" style={{ fontSize: 18, lineHeight: 24 }}>
        Paid {formatPaise(amountPaise)}
      </Text>
      <Text color="secondary" style={{ fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
        Your invoice is on its way by email, and you can download it from this trip any time.
      </Text>
      <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
        <Button label="Done" onPress={onDone} accessibilityLabel="Payment done" fullWidth />
      </View>
    </View>
  );
}

/** The locked fare, line by line. Zero lines are omitted rather than shown as ₹0. */
function Breakdown({
  intent,
  coupon,
}: {
  intent: PaymentIntentDto;
  coupon: CouponValidationDto | null;
}) {
  const b = intent.breakdown;
  const discountPaise = coupon?.valid ? coupon.discountPaise : b.discountPaise;

  const lines: Array<[string, number]> = [
    ['Base fare', b.basePaise],
    ['Night charge', b.nightPaise],
    ['Highway pickup', b.highwayPaise],
    ['Accident recovery', b.accidentPaise],
    ['Waiting', b.waitingPaise],
    ['Surge', b.surgePaise],
  ];

  return (
    <View style={{ gap: 6 }}>
      {lines
        .filter(([, amount]) => amount !== 0)
        .map(([label, amount]) => (
          <Row key={label} label={label} value={formatPaise(amount)} />
        ))}

      {discountPaise > 0 ? (
        <Row label="Discount" value={`- ${formatPaise(discountPaise)}`} />
      ) : null}

      {/* Only when there IS tax — at the launch rate of zero this is a receipt. */}
      {b.taxPaise > 0 ? <Row label="GST" value={formatPaise(b.taxPaise)} /> : null}

      <Row label="Total" value={formatPaise(payable(intent, coupon))} strong />
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text
        color={strong ? undefined : 'secondary'}
        weight={strong ? 'semibold' : undefined}
        style={{ fontSize: 14, lineHeight: 20 }}
      >
        {label}
      </Text>
      <Text weight={strong ? 'semibold' : undefined} tabular style={{ fontSize: 14, lineHeight: 20 }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * What the customer pays.
 *
 * A PREVIEW, NOT AN AUTHORITY. A coupon applied here is re-validated by the
 * server at confirm and the server's number wins — this only stops the button
 * showing a total the customer has just changed.
 */
function payable(intent: PaymentIntentDto, coupon: CouponValidationDto | null): number {
  if (!coupon?.valid) return intent.amountPaise;
  return Math.max(0, intent.amountPaise - coupon.discountPaise);
}

function couponMessage(coupon: CouponValidationDto): string {
  switch (coupon.reason) {
    case 'expired':
      return 'That coupon has expired.';
    case 'not_started':
      return 'That coupon is not active yet.';
    case 'below_min_order':
      return 'This trip is below that coupon’s minimum.';
    case 'usage_limit_reached':
      return 'That coupon has been fully used.';
    case 'already_used':
      return 'You have already used that coupon.';
    default:
      return 'That code is not valid.';
  }
}
