/**
 * The payment method the customer picks on 27 · Payment (the four Payment Method Rows `238:519`:
 * UPI, Credit / Debit Card, Wallet, Cash), carried to 29 · Payment Failed and 30 · Payment
 * Successful so all three show the same method.
 *
 * App-side only. The server takes no method (`paymentIntentRequestSchema` is `{ purpose }`); it
 * learns 'upi' | 'card' | 'wallet' from the gateway after capture, and 'cash' has no settlement
 * path yet (27 Data gap 1). Not the same union as `BookingPaymentMethod`
 * (features/bookings/types.ts), which has no 'cash'.
 */
export type PaymentMethodKind = 'upi' | 'card' | 'wallet' | 'cash';

/**
 * One row of 28 · Apply Coupon's "Available offers" (`299:4081`, `299:4088`, `299:4095`): the
 * code pill, the title and the validity line, all display text.
 *
 * APP-SIDE ONLY. The server has no offers list (only `POST /v1/coupons/validate`) and its
 * `coupons` table has no title or description column (27-28 Data gap 7), so only the mock source
 * returns rows: the three drawn offers with their drawn copy. Applying one still goes through the
 * real validation.
 */
export type CouponOffer = {
  /** The pill label, and the code sent to validation ("SAVE20"). */
  code: string;
  /** Body S 14, wraps ("20% off up to ₹300"). */
  title: string;
  /** Label 13, one line ("Valid till 31 Mar", "Every day"). */
  validity: string;
};
