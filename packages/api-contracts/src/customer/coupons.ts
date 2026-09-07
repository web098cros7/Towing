import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';

/**
 * §9.4.11's coupon validation — `POST /v1/coupons/validate`.
 *
 * ADVISORY, NOT AUTHORITATIVE. This tells the app what a code is worth so it
 * can render the discount before the customer commits; the confirm transaction
 * re-validates from scratch and takes its own number. A fare lock based on a
 * figure the client carried is not a lock.
 */

export const COUPON_KINDS = ['percent', 'flat'] as const;
export const couponKindSchema = z.enum(COUPON_KINDS);
export type CouponKind = z.infer<typeof couponKindSchema>;

export const couponValidateRequestSchema = z.object({
  code: z.string().trim().min(3).max(32),
  /** The pre-discount fare the app is showing. */
  subtotalPaise: unsignedPaiseSchema.min(1),
});
export type CouponValidateRequest = z.infer<typeof couponValidateRequestSchema>;

/**
 * Why a code did not apply.
 *
 * `invalid` covers BOTH "no such code" and "this code is switched off", and
 * merging them is deliberate: a coupon endpoint is a code-guessing surface, and
 * distinguishing the two would confirm which strings exist. Everything else
 * here describes a state the customer can act on — the reason a specific,
 * genuinely-theirs code is not working right now.
 */
export const COUPON_REJECTIONS = [
  'invalid',
  'expired',
  'not_started',
  'below_min_order',
  'usage_limit_reached',
  'already_used',
] as const;
export const couponRejectionSchema = z.enum(COUPON_REJECTIONS);
export type CouponRejection = z.infer<typeof couponRejectionSchema>;

export const couponValidationSchema = z.object({
  valid: z.boolean(),
  /** Echoed in the casing the coupon was created with, not as typed. */
  code: z.string().nullable(),
  kind: couponKindSchema.nullable(),
  /** What it takes off this subtotal, after `max_discount` and clamping. */
  discountPaise: unsignedPaiseSchema,
  reason: couponRejectionSchema.nullable(),
});
export type CouponValidationDto = z.infer<typeof couponValidationSchema>;
