import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CommonActions,
  useNavigation,
  usePreventRemove,
  useRoute,
  type NavigationAction,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CouponValidationDto } from '@towing/api-contracts';
import type { PaymentMethodKind } from '@/features/payments/types';
import { serviceTitle } from '@/features/services/data/serviceTitles';
import { track } from '@/lib/analytics/analytics';
import { env } from '@/lib/env';
import type { RootStackParamList } from '@/navigation/types';
import { formatPaise } from '@/utils/format';
import { ApplyCouponSheet } from './coupon/ApplyCouponSheet';
import { PaymentFailedView } from './failed/PaymentFailedView';
import { PaymentReview } from './review/PaymentReview';
import { buildPaymentBill } from './review/paymentBill';
import { useFreshBooking } from './useFreshBooking';
import { usePaymentSession, type PaymentFailure } from './usePaymentSession';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Removals that mean "back": the chevron's goBack, Android back and the iOS back swipe. */
const BACK_ACTIONS: ReadonlySet<string> = new Set(['GO_BACK', 'POP']);

/**
 * Figma 27 · Payment (`238:570`), root route `Payment { bookingId }`, with 28 · Payment · Details
 * Open (`490:17845`) as its expanded state, Apply Coupon (`299:3816`) as a sheet over it (opened
 * by the Apply Coupon row) and 29 · Payment Failed (`292:2522`) as its `failed` phase
 * (29 spec D1 = A). One route, so ONE payment session: the idempotency key, the intent, 27's
 * method and any coupon survive 27 → 29 → 27 → 29 (`usePaymentSession`).
 *
 * How it opens: Tracking replaces itself with it when the trip reaches `completed`, and 20's
 * Status card opens it for a completed (unpaid) booking. Back on 27 leaves (the booking stays
 * `completed`, unpaid; nothing is drawn for that).
 *
 * How it ends:
 * - Captured → 30, by a stack RESET to `[Tabs, PaymentSuccess]`, so nothing under 30 can pay
 *   again or show the finished trip.
 * - A definite decline → 29. Its Back chevron, Android back, the iOS back swipe and "Use Another
 *   Method" all return to 27's list in the same session; Try Again pays again with the same
 *   method on the same intent and key.
 * - Anything else (a dismissed checkout, a payment that could not start, a bank still
 *   confirming) stays where it is: nothing is drawn for those (DATA-GAPS-27-30).
 */
export function PaymentScreen() {
  const navigation = useNavigation<Nav>();
  const { bookingId } = useRoute<RouteProp<RootStackParamList, 'Payment'>>().params;

  // The booking gives the Service price (its total), the subtotal a coupon is checked against,
  // and 29's Reference ID. Read fresh on arrival, never from the persisted cache: until that
  // read lands, the price and the reference keep their bars and no coupon can be checked.
  const booking = useFreshBooking(bookingId);
  const { intent, paying, pay: payWith, changeCoupon } = usePaymentSession(bookingId);

  /** UPI is drawn selected; kept on the phone only (the server takes no method, Data gap 1). */
  const [method, setMethod] = useState<PaymentMethodKind>('upi');
  /** Set = 29 is showing. Cleared = back on 27's list. */
  const [failure, setFailure] = useState<PaymentFailure | null>(null);
  const [coupon, setCoupon] = useState<CouponValidationDto | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  /** 28 · Payment · Details Open: the Service summary shows the bill. Kept on the phone only. */
  const [detailsOpen, setDetailsOpen] = useState(false);

  // §22.1's funnel events, kept from the sheet this screen replaces: opened on arrival,
  // dismissed when the customer leaves without paying.
  const paidRef = useRef(false);
  useEffect(() => {
    track('payment_sheet_opened');
    return () => {
      if (!paidRef.current) track('payment_sheet_dismissed', { reason: 'cancelled' });
    };
  }, []);

  // --- Leaving -----------------------------------------------------------------------------

  /**
   * A removal to let through: 30's reset, or anything else that removes this route while it is
   * holding. Setting it lifts the hold for one render, then the effect dispatches it, which is
   * the Tracking screen's 23 ↔ 24 re-dispatch.
   */
  const [exit, setExit] = useState<NavigationAction | null>(null);
  useEffect(() => {
    if (exit) navigation.dispatch(exit);
  }, [exit, navigation]);

  /**
   * The route holds while 29 is up (back returns to 27's list) and while a payment is in flight
   * (back does nothing until it settles). The Payment route keeps the iOS back swipe on (the
   * default push), so with removal prevented native-stack cancels the swipe and dispatches a
   * POP, which lands here; it is switched off only while a payment is in flight.
   */
  const holding = (failure !== null || paying) && exit === null;
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !paying });
  }, [navigation, paying]);
  usePreventRemove(holding, ({ data }) => {
    if (!BACK_ACTIONS.has(data.action.type)) {
      setExit(data.action);
      return;
    }
    if (!paying) setFailure(null);
  });

  /** 27's Back: to whatever pushed it, or Home when nothing did. */
  const leave = useCallback(() => {
    if (paying) return;
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Tabs', { screen: 'Home' });
  }, [navigation, paying]);

  /** 29's Back chevron and "Use Another Method": 27's list, same session. */
  const backToMethods = useCallback(() => {
    if (!paying) setFailure(null);
  }, [paying]);

  const openSupport = useCallback(() => navigation.navigate('Support'), [navigation]);

  // --- Paying ------------------------------------------------------------------------------

  /** 27's Pay and 29's Try Again: the same call, with 27's method. */
  const pay = useCallback(async () => {
    const outcome = await payWith(method);
    if (outcome.kind === 'paid') {
      paidRef.current = true;
      const params: RootStackParamList['PaymentSuccess'] = {
        bookingId,
        payment: {
          method: outcome.method,
          transactionId: outcome.transactionId,
          paidAt: outcome.paidAt,
          amountPaise: outcome.amountPaise,
        },
      };
      // `navigation.reset`, routed through `exit` so 29's hold lets it through.
      setExit(
        CommonActions.reset({
          index: 1,
          routes: [{ name: 'Tabs' }, { name: 'PaymentSuccess', params }],
        }),
      );
    } else if (outcome.kind === 'failed') {
      setFailure(outcome.failure);
    }
    // 'stay': nothing drawn; 27 (or 29, after a dismissed Try Again) stays as it is.
  }, [bookingId, method, payWith]);

  /**
   * A tap selects a row. Cash can be picked in test mode only: with the live API there is no
   * cash settlement path (Data gap 1c), so the row does nothing there.
   */
  const selectMethod = useCallback(
    (kind: PaymentMethodKind) => {
      if (paying) return;
      if (kind === 'cash' && !env.useMocks) return;
      setMethod(kind);
    },
    [paying],
  );

  // --- 28 ----------------------------------------------------------------------------------

  /** View Details / Hide Details: 27 ↔ 28 · Details Open. Free while a Pay is in flight; nothing is charged by it. */
  const toggleDetails = useCallback(() => setDetailsOpen((open) => !open), []);

  /**
   * Apply Coupon `253:1153`: 28 · Apply Coupon, in test mode only. The live API applies a coupon
   * only when a trip is booked (27-28 Data gap 8), so the row does nothing there.
   */
  const applyCoupon = useCallback(() => {
    if (env.useMocks && !paying) setCouponOpen(true);
  }, [paying]);

  /**
   * Apply and Remove re-create the intent under a new key, so Total and Pay follow the coupon.
   * The session refuses while a Pay is in flight; the coupon then stays as it was.
   */
  const onCouponApplied = useCallback(
    (applied: CouponValidationDto) => {
      if (changeCoupon(applied.code)) setCoupon(applied);
    },
    [changeCoupon],
  );
  const onCouponRemoved = useCallback(() => {
    if (changeCoupon(null)) setCoupon(null);
  }, [changeCoupon]);

  // --- Render ------------------------------------------------------------------------------

  const amount = intent ? formatPaise(intent.amountPaise) : null;
  const totalPaise = booking?.breakdown.totalPaise ?? null;
  const title = serviceTitle(booking?.serviceSlug);
  const bill = buildPaymentBill(booking, coupon);

  if (failure) {
    return (
      <PaymentFailedView
        failure={failure}
        reference={booking?.reference ?? null}
        retrying={paying}
        onBack={backToMethods}
        onHelp={openSupport}
        onTryAgain={() => void pay()}
        onUseAnotherMethod={backToMethods}
      />
    );
  }

  return (
    <>
      <PaymentReview
        amount={amount}
        serviceTitle={title}
        servicePrice={totalPaise !== null ? formatPaise(totalPaise) : null}
        method={method}
        paying={paying}
        detailsOpen={detailsOpen}
        onToggleDetails={toggleDetails}
        bill={bill}
        billTotal={amount}
        onApplyCoupon={applyCoupon}
        onSelectMethod={selectMethod}
        onBack={leave}
        onPay={() => void pay()}
      />
      <ApplyCouponSheet
        visible={couponOpen}
        onClose={() => setCouponOpen(false)}
        subtotalPaise={totalPaise}
        applied={coupon}
        onApplied={onCouponApplied}
        onRemoved={onCouponRemoved}
      />
    </>
  );
}
