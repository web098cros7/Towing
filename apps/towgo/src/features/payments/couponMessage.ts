import type { CouponValidationDto } from '@towing/api-contracts';

/**
 * Why a code was refused, in the app's existing words (moved verbatim from `PaymentSheet`, which
 * keeps its own copy until it is deleted). 28 · Apply Coupon draws no error copy at all (27-28
 * Data gap 9): these lines are shown in the Text Field's Error helper until the owner supplies
 * the wording. "coupon’s" uses U+2019, as before.
 */
export function couponMessage(coupon: CouponValidationDto): string {
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
