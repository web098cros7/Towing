import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  ErrorCodes,
  type PaymentCaptureRequest,
  type PaymentIntentDto,
} from '@towing/api-contracts';
import { bookingsKeys } from '@/features/bookings/api/bookings.keys';
import { bookingsDataSource } from '@/features/bookings/api/bookingsDataSource';
import {
  useApplyPaymentCoupon,
  useCapturePayment,
  useChooseCash,
  useCreatePaymentIntent,
  useRemovePaymentCoupon,
  useWalletPay,
} from '@/features/payments/api/payments.queries';
import {
  CheckoutDismissedError,
  CheckoutFailedError,
  openCheckout,
} from '@/features/payments/razorpay';
import type { PaymentMethodKind } from '@/features/payments/types';
import { ApiClientError } from '@/lib/api/errors';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { env } from '@/lib/env';

/** What 29 · Payment Failed shows for a declined attempt. */
export type PaymentFailure = {
  /** 27's selection for the attempt that failed (29's "Payment method"). */
  method: PaymentMethodKind;
  /** What the attempt tried to charge (29's "Amount"). */
  amountPaise: number;
  /** The gateway's words (29's "Reason"); null when it gave none (29 D4: no invented fallback). */
  reason: string | null;
};

/** How a Pay (27) or Try Again (29) ended, for the screen to act on. */
export type PaymentOutcome =
  /**
   * Captured: 30 · Payment Successful. `transactionId` is the gateway payment id (`pay_…`);
   * `amountPaise` is what was charged (the capture's amount, else the captured intent's).
   */
  | {
      kind: 'paid';
      method: PaymentMethodKind;
      transactionId: string | null;
      paidAt: string;
      amountPaise: number;
    }
  /** A definite decline: 29 · Payment Failed. */
  | { kind: 'failed'; failure: PaymentFailure }
  /**
   * Cash chosen: 31b · Pay Cash to Driver. The booking is NOT paid yet — the driver confirms
   * the cash in the driver app, and 31b polls until it turns `paid`. `amountPaise` is what the
   * customer hands over (the booking's total).
   */
  | { kind: 'cash'; amountPaise: number }
  /**
   * Stay where you are (29 spec D3: 29 is for definite declines only). `notice` says whether
   * the customer needs telling, which Figma has no screen for, so 27 shows a system alert (P19):
   * - absent: the customer closed the checkout themselves, or a Pay was already in flight;
   * - `not_started`: the payment never started, so nothing was charged;
   * - `confirming`: the bank has not answered yet, and money may already have left. `recheck`
   *   asks again.
   */
  | { kind: 'stay'; notice?: 'not_started' | 'confirming' };

/** One intent request: its idempotency key and the coupon it was created with. */
type Attempt = { key: string; couponCode: string | null };

/**
 * The money side of 27 · Payment and 29 · Payment Failed, which are one route (29 spec D1 = A),
 * so exactly one component owns the key, the intent and the checkout call.
 *
 * ⚠ ONE IDEMPOTENCY KEY PER PAYMENT SESSION (§9.1.9, `PaymentSheet`'s rule). Minted when the
 * screen mounts, reused for the intent and for EVERY capture, 29's Try Again included: an error
 * response releases the key server-side, so a retry re-executes; a success replays the same
 * order. The one exception is a coupon: applying or removing one on 28 re-creates the intent
 * under a NEW key, so Total, "Pay ₹…" and the charge always name the same amount and no key ever
 * names two amounts. Leaving the screen ends the session; a fresh opening mints a fresh key.
 *
 * What counts as a decline (29 spec D3, definite failures only, because 29's body says "Your
 * bank declined this payment. No money was taken from your account."):
 * - the capture answers `status: 'failed'` (only the mock does today);
 * - Razorpay's sheet rejects with anything but a dismissal (`CheckoutFailedError`);
 * - the capture throws 422 `payment_not_captured` with `gatewayStatus: 'failed'`.
 *
 * Everything else stays on 27: a dismissal (silently); a checkout that could not start (no dev
 * result, the native module missing, no intent) as `not_started`; a capture that is still
 * confirming (422 with `pending` / `authorized`) or failed in transit as `confirming`. For those
 * last two the booking is read again first, and a booking that turned `paid` goes to 30 anyway.
 */
export function usePaymentSession(bookingId: string) {
  const queryClient = useQueryClient();
  // `mutateAsync` is the observer's bound method, stable across renders.
  const { mutateAsync: createIntent } = useCreatePaymentIntent();
  const { mutateAsync: capture } = useCapturePayment();
  const { mutateAsync: applyCoupon } = useApplyPaymentCoupon();
  const { mutateAsync: removeCoupon } = useRemovePaymentCoupon();
  const { mutateAsync: chooseCash } = useChooseCash();
  const { mutateAsync: payWithWallet } = useWalletPay();

  const [attempt, setAttempt] = useState<Attempt>(() => ({
    key: newIdempotencyKey(),
    couponCode: null,
  }));
  /** The attempt the latest request belongs to; an older answer is dropped. */
  const current = useRef(attempt);
  const [intent, setIntent] = useState<PaymentIntentDto | null>(null);
  const [intentFailed, setIntentFailed] = useState(false);
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);

  const requestIntent = useCallback(
    async (target: Attempt) => {
      setIntentFailed(false);
      try {
        const dto = await createIntent({
          bookingId,
          purpose: 'booking',
          idempotencyKey: target.key,
          couponCode: target.couponCode,
        });
        if (current.current !== target) return;
        setIntent(dto);
        setIntentFailed(false);
      } catch {
        if (current.current === target) setIntentFailed(true);
      }
    },
    [bookingId, createIntent],
  );

  useEffect(() => {
    current.current = attempt;
    setIntent(null);
    void requestIntent(attempt);
  }, [attempt, requestIntent]);

  /**
   * 28's Apply / Remove: a new intent under a new key (see the header). Refused while a Pay is
   * in flight, since that checkout is already charging the current intent: it returns false and
   * changes nothing, and the caller must not show the coupon as applied or removed.
   *
   * In LIVE mode the coupon is applied (or removed) on the server FIRST: the server folds it
   * into the booking's fare and closes any open intent, so the new intent charges the new total.
   * A failed call returns false and changes nothing. In mock mode the coupon rides on the intent
   * itself (`createIntent` honours `couponCode`), so nothing is called here.
   */
  const changeCoupon = useCallback(
    async (couponCode: string | null): Promise<boolean> => {
      if (payingRef.current) return false;
      if (!env.useMocks) {
        try {
          if (couponCode) await applyCoupon({ bookingId, code: couponCode });
          else await removeCoupon({ bookingId });
        } catch {
          return false;
        }
      }
      setAttempt({ key: newIdempotencyKey(), couponCode });
      return true;
    },
    [applyCoupon, bookingId, removeCoupon],
  );

  /** The last unclear capture, for `recheck`. Cleared once it resolves either way. */
  const unclear = useRef<{
    method: PaymentMethodKind;
    transactionId: string | null;
    amountPaise: number;
  } | null>(null);

  /** Read the booking again after an unclear capture: it may have been paid after all. */
  const settleFromBooking = useCallback(
    async (
      method: PaymentMethodKind,
      transactionId: string | null,
      amountPaise: number,
    ): Promise<PaymentOutcome> => {
      try {
        const booking = await queryClient.fetchQuery({
          queryKey: bookingsKeys.detail(bookingId),
          queryFn: () => bookingsDataSource.getBooking(bookingId),
          staleTime: 0,
        });
        if (booking?.status === 'paid') {
          unclear.current = null;
          return paidOutcome(method, transactionId, amountPaise);
        }
      } catch {
        // Could not read it either; still unclear.
      }
      unclear.current = { method, transactionId, amountPaise };
      return { kind: 'stay', notice: 'confirming' };
    },
    [bookingId, queryClient],
  );

  /**
   * The alert's "Check again" after a `confirming` outcome: reads the booking once more. The
   * webhook settles a late capture server-side, so this turns `paid` without a second charge.
   */
  const recheck = useCallback(async (): Promise<PaymentOutcome> => {
    const last = unclear.current;
    if (!last) return { kind: 'stay' };
    return settleFromBooking(last.method, last.transactionId, last.amountPaise);
  }, [settleFromBooking]);

  /**
   * 27's Pay and 29's Try Again. Three paths:
   * - Cash: `chooseCash`, then poll the booking until the DRIVER confirms it (`paid`).
   * - Wallet-only intent: `payWithWallet`; on error re-request a fresh intent (the server may
   *   have closed it) and stay.
   * - Otherwise: the gateway checkout on the session's intent, then the capture under the
   *   session's key. With no intent yet it only asks for one again (after a failed request),
   *   and reports `stay`: the amount has to be on screen before anything is charged.
   */
  const pay = useCallback(
    async (method: PaymentMethodKind): Promise<PaymentOutcome> => {
      if (payingRef.current) return { kind: 'stay' };

      // Cash: no gateway, no intent. The booking becomes `paid` when the DRIVER confirms, so
      // the screen (31b) polls for that; this call only records the choice.
      if (method === 'cash') {
        payingRef.current = true;
        setPaying(true);
        let outcome: PaymentOutcome = { kind: 'stay' };
        try {
          const cash = await chooseCash({ bookingId });
          outcome = { kind: 'cash', amountPaise: cash.amountPaise };
          return outcome;
        } catch {
          Alert.alert('Could not choose cash', 'Please try again.');
          return outcome;
        } finally {
          payingRef.current = false;
          setPaying(false);
        }
      }

      if (!intent) {
        // Still being created: Pay waits for the amount. Failed: ask again, and say so.
        if (!intentFailed) return { kind: 'stay' };
        void requestIntent(current.current);
        return { kind: 'stay', notice: 'not_started' };
      }
      const key = current.current.key;

      payingRef.current = true;
      setPaying(true);
      let outcome: PaymentOutcome = { kind: 'stay' };
      try {
        // Wallet-only: the wallet covers the whole bill, so no gateway sheet opens.
        if (intent.walletOnly) {
          try {
            const result = await payWithWallet({ bookingId });
            if (result.status === 'captured') {
              outcome = paidOutcome('wallet', null, intent.walletAppliedPaise);
            }
          } catch {
            // The server may have closed the intent; ask for a fresh one and stay. A wallet
            // debit is one database write, so a failure here took nothing.
            void requestIntent(current.current);
            outcome = { kind: 'stay', notice: 'not_started' };
          }
          return outcome;
        }

        let checkout: PaymentCaptureRequest;
        try {
          // `autoSettles` (dev gateway, test mode) skips the native sheet entirely.
          checkout = await openCheckout(intent);
        } catch (error) {
          if (error instanceof CheckoutDismissedError) return outcome;
          if (error instanceof CheckoutFailedError) {
            outcome = failedOutcome(method, intent.amountPaise, error.reason);
          }
          // Anything else: the payment never started, so nothing was charged (P19).
          else outcome = { kind: 'stay', notice: 'not_started' };
          return outcome;
        }

        const transactionId = checkout.gatewayRef || null;
        try {
          const result = await capture({ bookingId, body: checkout, idempotencyKey: key });
          if (result.status === 'captured') {
            outcome = paidOutcome(method, transactionId, result.amountPaise);
          } else if (result.status === 'failed') {
            outcome = failedOutcome(method, result.amountPaise, result.failureReason);
          } else {
            outcome = await settleFromBooking(method, transactionId, intent.amountPaise);
          }
        } catch (error) {
          outcome = isDefinitiveDecline(error)
            ? failedOutcome(method, intent.amountPaise, null)
            : await settleFromBooking(method, transactionId, intent.amountPaise);
        }
        return outcome;
      } finally {
        // A captured payment leaves the screen: keep Pay's spinner up until 30 replaces it.
        if (outcome.kind !== 'paid') {
          payingRef.current = false;
          setPaying(false);
        }
      }
    },
    [
      bookingId,
      capture,
      chooseCash,
      intent,
      intentFailed,
      payWithWallet,
      requestIntent,
      settleFromBooking,
    ],
  );

  return {
    /** The live intent for the current key; null while it is being created or after a failure. */
    intent,
    /** True while a Pay / Try Again is between the tap and its outcome. */
    paying,
    pay,
    /** After a `confirming` outcome: has the bank answered yet? */
    recheck,
    changeCoupon,
  };
}

function paidOutcome(
  method: PaymentMethodKind,
  transactionId: string | null,
  amountPaise: number,
): PaymentOutcome {
  // The booking now carries `paidAt`, but 30 reads it from the route: the device clock at the
  // instant of hand-off stands in, so the success screen shows the moment the customer saw it.
  return { kind: 'paid', method, transactionId, paidAt: new Date().toISOString(), amountPaise };
}


function failedOutcome(
  method: PaymentMethodKind,
  amountPaise: number,
  reason: string | null,
): PaymentOutcome {
  return { kind: 'failed', failure: { method, amountPaise, reason: reason?.trim() || null } };
}

/**
 * The live server never answers `status: 'failed'`: it throws 422 `payment_not_captured` for
 * any status that is not captured (`payments.service.ts`). Only `gatewayStatus: 'failed'` is a
 * decline; `pending` / `authorized` mean the bank may still be holding the money.
 */
function isDefinitiveDecline(error: unknown): boolean {
  if (!(error instanceof ApiClientError) || error.code !== ErrorCodes.PAYMENT_NOT_CAPTURED) {
    return false;
  }
  const details = error.details as { gatewayStatus?: unknown } | null | undefined;
  return details?.gatewayStatus === 'failed';
}
