import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';

/**
 * Figma 45 — Refer & Earn. The customer's own referral code, what it has
 * earned them, and the code they applied (if any).
 */
export const referralSummarySchema = z.object({
  /** The customer's own share code. */
  code: z.string(),
  /** Deep link a friend can open to install with the code pre-filled. */
  shareUrl: z.string(),
  /** Paise credited to the referrer per rewarded friend. */
  referrerRewardPaise: unsignedPaiseSchema,
  /** Paise credited to the referee when they apply a code, spendable on their first trip. */
  refereeRewardPaise: unsignedPaiseSchema,
  /** Friends who applied your code. */
  invitedCount: z.number().int().nonnegative(),
  /** Of those, how many finished a paid first trip. */
  rewardedCount: z.number().int().nonnegative(),
  /** What you were credited. */
  earnedPaise: unsignedPaiseSchema,
  /** The code THIS customer used, or null. */
  appliedCode: z.string().nullable(),
  /** True only for a customer with no code applied and no trips yet. */
  canApplyCode: z.boolean(),
});

export const referralApplySchema = z.object({
  code: z.string().trim().min(4).max(20),
});

export const referralApplyResponseSchema = z.object({
  status: z.literal('pending'),
  refereeRewardPaise: unsignedPaiseSchema,
});

export type ReferralSummary = z.infer<typeof referralSummarySchema>;
export type ReferralApply = z.infer<typeof referralApplySchema>;
export type ReferralApplyResponse = z.infer<typeof referralApplyResponseSchema>;
