import type { PaymentCaptureRequest, PaymentIntentDto } from '@towing/api-contracts';

/**
 * §9.1.9's Razorpay Standard Checkout, behind one function.
 *
 * ⚠ THE FOURTH NATIVE REBUILD POINT. The plan's OTA ladder had exactly three —
 * Phases 12 (MMKV, location, pickers), 13 (notifications) and 16 (maps) — and
 * Phase 18 went out of its way to add none, using RN core `Share` rather than
 * `expo-sharing`. `react-native-razorpay` is a genuine native module, so
 * `runtimeVersion` moves to `'4'` and every previously-shipped binary becomes
 * OTA-incompatible. NONE HAS EVER BEEN BUILT, so the practical cost today is
 * zero — but the claim "three rebuild points" is no longer true and Phase 21's
 * ladder has a fourth rung.
 *
 * ⚠ THE IMPORT IS LAZY, and that is not a micro-optimisation. It follows
 * `pushClient.ts`'s precedent: a static import of a native module evaluates at
 * bundle load, so an OTA update landing on a binary that predates the module
 * would crash the app at startup rather than at the payment screen. Required
 * here, the failure is a clear error on one screen — and, just as usefully, the
 * whole app still runs in Expo Go, where the module does not exist at all.
 *
 * ⚠ NO BUILD-TIME KEY. `intent.publicKey` comes from the server per request, so
 * rotating the merchant key needs no store release — the argument
 * `PUBLIC_TRACK_BASE_URL` makes, and it matters more here because a mobile
 * binary can take a week to replace.
 */

/** Thrown when the customer closes the sheet. Not a failure. */
export class CheckoutDismissedError extends Error {
  readonly code = 'checkout_dismissed';

  constructor() {
    super('Payment cancelled');
    this.name = 'CheckoutDismissedError';
  }
}

interface RazorpayResult {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export async function openCheckout(intent: PaymentIntentDto): Promise<PaymentCaptureRequest> {
  /**
   * THE DEV GATEWAY HAS NO SHEET TO OPEN.
   *
   * `autoSettles` is the server saying "there is no vendor here" — which is the
   * case for every local run, every mock-mode run and the entire test suite,
   * because no Razorpay merchant account exists (SETUP-CHECKLIST item 12). The
   * app skips the native module entirely and hands back a result the dev
   * adapter will accept, so the whole chain — pay → settle → invoice → rate —
   * is walkable in Expo Go on a laptop.
   */
  if (intent.autoSettles) {
    // The SIGNATURE COMES FROM THE SERVER. The dev adapter verifies a real HMAC
    // keyed on `PAYMENT_WEBHOOK_SECRET`, and the app neither knows that secret
    // nor should be able to — so the server, which does, computes it and sends
    // it alongside the order. (`node:crypto` does not exist in React Native
    // either, which is the second reason this cannot be done here.)
    if (!intent.devCheckout) {
      throw new Error('The development gateway did not return a checkout result');
    }

    return {
      orderRef: intent.orderRef,
      gatewayRef: intent.devCheckout.gatewayRef,
      signature: intent.devCheckout.signature,
    };
  }

  // Only reached with a real merchant account, on a real build.
  const RazorpayCheckout = await loadCheckout();

  try {
    const result = (await RazorpayCheckout.open({
      key: intent.publicKey,
      order_id: intent.orderRef,
      amount: intent.amountPaise,
      currency: intent.currency,
      name: 'MiTow',
      description: 'Roadside assistance and towing',
      // No `prefill.card` and no saved-instrument handling of our own: §9.1.9's
      // acceptance criterion is "no raw card data stored", and the surest way
      // to satisfy it is for card data never to touch this app at all.
      theme: { color: '#F5A212' },
    })) as RazorpayResult;

    return {
      orderRef: result.razorpay_order_id,
      gatewayRef: result.razorpay_payment_id,
      signature: result.razorpay_signature,
    };
  } catch (error) {
    // Razorpay rejects with `{ code, description }` on dismissal as well as on
    // failure, and treating the two the same would tell a customer who simply
    // changed their mind that their payment failed.
    const code = (error as { code?: number })?.code;
    if (code === 0 || code === 2) throw new CheckoutDismissedError();
    throw new Error(
      (error as { description?: string })?.description ?? 'The payment could not be completed',
    );
  }
}

/**
 * Loaded at call time, never at module scope. See the header.
 *
 * A missing module means a JS bundle running on a binary that predates it —
 * which is a real possibility given the OTA ladder — and the error says so
 * rather than surfacing as an undefined-is-not-a-function crash.
 */
async function loadCheckout(): Promise<{ open(options: unknown): Promise<unknown> }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native-razorpay') as {
      default: { open(options: unknown): Promise<unknown> };
    };
    return module.default;
  } catch {
    throw new Error(
      'Payments need a newer version of the app. Please update from the store and try again.',
    );
  }
}
