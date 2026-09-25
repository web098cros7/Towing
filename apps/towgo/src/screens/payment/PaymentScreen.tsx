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
import { shortPlace } from '@/utils/address';
import { formatPaise } from '@/utils/format';
import { ApplyCouponSheet } from './coupon/ApplyCouponSheet';
import { PaymentFailedView } from './failed/PaymentFailedView';
import { PaymentReview } from './review/PaymentReview';
import { buildPaymentBill } from './review/paymentBill';
import { useFreshBooking } from './useFreshBooking';
import { showPaymentNotice } from './paymentNotice';
import { usePaymentSession, type PaymentFailure, type PaymentOutcome } from './usePaymentSession';

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
 * - Anything else stays where it is. A dismissed checkout shows nothing (the customer closed it).
 *   A payment that could not start, and a bank still confirming, have no Figma screen, so each
 *   shows a system alert (P19, `paymentNotice.ts`); the second offers "Check again".
 */
export function PaymentScreen() {
  const navigation = useNavigation<Nav>();
  const { bookingId } = useRoute<RouteProp<RootStackParamList, 'Payment'>>().params;

  // The booking gives the Service price (its total), the subtotal a coupon is checked against,
  // and 29's Reference ID. Read fresh on arrival, never from the persisted cache: until that
  // read lands, the price and the reference keep their bars and no coupon can be checked.
  const booking = useFreshBooking(bookingId);
  const { intent, paying, pay: payWith, recheck, changeCoupon } = usePaymentSession(bookingId);

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

  const openSupport = useCallback(
    () => navigation.navigate('Support', { bookingId }),
    [navigation, bookingId],
  );

  // --- Paying ------------------------------------------------------------------------------

  /** Where a Pay, a Try Again or an alert's Check again leads. */
  const handleOutcome = useCallback(
    (outcome: PaymentOutcome) => {
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
      } else if (outcome.kind === 'cash') {
        // 31b · Pay Cash to Driver: the driver confirms the cash, and 31b polls for that.
        navigation.navigate('PayCash', { bookingId, amountPaise: outcome.amountPaise });
      } else if (outcome.notice) {
        // P19: Figma has no screen for these, so a system alert over 27 (or 29).
        showPaymentNotice(outcome.notice, () => void recheck().then(handleOutcome));
      }
      // A plain 'stay' (a dismissed checkout): 27, or 29, stays as it is.
    },
    [bookingId, navigation, recheck],
  );

  /** 27's Pay and 29's Try Again: the same call, with 27's method. */
  const pay = useCallback(async () => {
    handleOutcome(await payWith(method));
  }, [handleOutcome, method, payWith]);

  /** A tap selects a row. */
  const selectMethod = useCallback(
    (kind: PaymentMethodKind) => {
      if (paying) return;
      setMethod(kind);
    },
    [paying],
  );

  // --- 28 ----------------------------------------------------------------------------------

  /** View Details / Hide Details: 27 ↔ 28 · Details Open. Free while a Pay is in flight; nothing is charged by it. */
  const toggleDetails = useCallback(() => setDetailsOpen((open) => !open), []);

  /** Apply Coupon `253:1153`: 28 · Apply Coupon. */
  const applyCoupon = useCallback(() => {
    if (!paying) setCouponOpen(true);
  }, [paying]);

  /**
   * Apply and Remove re-create the intent under a new key, so Total and Pay follow the coupon.
   * The session refuses while a Pay is in flight; the coupon then stays as it was.
   */
  const onCouponApplied = useCallback(
    async (applied: CouponValidationDto) => {
      if (await changeCoupon(applied.code)) setCoupon(applied);
    },
    [changeCoupon],
  );
  const onCouponRemoved = useCallback(async () => {
    if (await changeCoupon(null)) setCoupon(null);
  }, [changeCoupon]);

  // --- Render ------------------------------------------------------------------------------

  const amount = intent ? formatPaise(intent.amountPaise) : null;
  const totalPaise = booking?.breakdown.totalPaise ?? null;
  const title = serviceTitle(booking?.serviceSlug);
  const bill = buildPaymentBill(booking, coupon, {
    couponInBooking: !env.useMocks,
    walletAppliedPaise: intent?.walletAppliedPaise ?? 0,
  });
  // The sheet's subtotal is the PRE-coupon subtotal. In live mode the server folds the coupon
  // into the booking's discount, so add it back when a coupon is applied.
  const subtotalPaise =
    !env.useMocks && coupon && totalPaise !== null
      ? totalPaise + (booking?.breakdown.discountPaise ?? 0)
      : totalPaise;

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
        serviceSubtitle={routeLine(booking)}
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
        subtotalPaise={subtotalPaise}
        applied={coupon}
        onApplied={onCouponApplied}
        onRemoved={onCouponRemoved}
      />
    </>
  );
}

/** The trip as "Motijheel → Brahmapura" (27's service description); null while it loads. */
function routeLine(
  booking: { originLabel: string | null; destinationLabel: string | null } | undefined,
): string | null {
  if (!booking) return null;
  const from = shortPlace(booking.originLabel);
  const to = shortPlace(booking.destinationLabel);
  if (from && to) return `${from} → ${to}`;
  return from ?? to ?? '';
}
