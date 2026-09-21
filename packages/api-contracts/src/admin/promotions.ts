import { z } from 'zod';
import { bannerAudienceSchema } from '../common/banners';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { couponKindSchema, type CouponKind } from '../customer/coupons';

/**
 * W16 — §9.4.11's promotions surface (`/admin/promotions`, guide Part 4).
 *
 * THE COUPON TABLE IS OLDER THAN THIS SURFACE. Phase 19 shipped `coupons` +
 * `coupon_redemptions` and the customer validation route; what never existed
 * was a manager. Nothing about the money path changes here: the confirm
 * transaction still re-validates from scratch, and `used_count` is still
 * moved only by the conditional UPDATE in `coupons.service.ts`.
 *
 * `usedCount` IS READ-ONLY BY CONSTRUCTION. It appears in the response schema
 * and in NO write body — an editor that can set it is an editor that can
 * desynchronise the coupon ledger, which is what the `couponDrift` invariant
 * exists to catch. "Editing a coupon never changes used_count" is a property
 * of this shape, not a rule the service has to remember.
 *
 * MIXED UNITS ARE TWO FIELDS, NOT ONE. A coupon's stored `value` is
 * percentage points when `kind='percent'` and rupees when `kind='flat'` — the
 * string "20" means two very different discounts. The API keeps them apart
 * (`percentValue` / `flatValuePaise`, exactly one populated, matching `kind`)
 * so no screen can render ₹20 where 20% was meant. Money crosses as integer
 * paise like everywhere else; percentages cross as plain numbers, the same
 * way the pricing editor's `nightPct` does.
 */

const percentValueSchema = z.number().min(0).max(100).multipleOf(0.01);

export const adminCouponSchema = z.object({
  id: z.uuid(),
  /** Stored as created; uniqueness is case-insensitive (`upper(code)`). */
  code: z.string(),
  kind: couponKindSchema,
  /** Set iff `kind === 'percent'`. */
  percentValue: percentValueSchema.nullable(),
  /** Set iff `kind === 'flat'`. */
  flatValuePaise: unsignedPaiseSchema.nullable(),
  /** Caps a percent coupon. Null = uncapped. */
  maxDiscountPaise: unsignedPaiseSchema.nullable(),
  minOrderPaise: unsignedPaiseSchema,
  /** Null = unlimited. Enforced by a conditional UPDATE, not a read-check. */
  maxUses: z.number().int().min(1).nullable(),
  maxUsesPerUser: z.number().int().min(1),
  /** Read-only. Never accepted in a write body. */
  usedCount: z.number().int().min(0),
  startsAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminCoupon = z.infer<typeof adminCouponSchema>;

export const adminCouponsQuerySchema = pageQuerySchema.extend({
  /** Case-insensitive substring match on the code. */
  code: z.string().trim().max(32).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});
export type AdminCouponsQuery = z.infer<typeof adminCouponsQuerySchema>;

export const adminCouponsResponseSchema = pageEnvelopeSchema(adminCouponSchema);
export type AdminCouponsResponse = z.infer<typeof adminCouponsResponseSchema>;

/**
 * The value rule both write bodies share: at most one of the two value
 * fields, and when `kind` is present it must match which one it is. Whether
 * the field is REQUIRED is the difference between create (it is) and update
 * (it is not — omitting it keeps the stored value).
 */
function addValueIssues(
  body: { kind?: CouponKind; percentValue?: number; flatValuePaise?: number },
  ctx: z.RefinementCtx,
  required: boolean,
): void {
  if (body.percentValue !== undefined && body.flatValuePaise !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['flatValuePaise'],
      message: 'Set exactly one of percentValue / flatValuePaise',
    });
    return;
  }
  if (body.kind === 'percent' && body.flatValuePaise !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['flatValuePaise'],
      message: 'A percent coupon takes percentValue',
    });
    return;
  }
  if (body.kind === 'flat' && body.percentValue !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['percentValue'],
      message: 'A flat coupon takes flatValuePaise',
    });
    return;
  }
  if (!required || body.kind === undefined) return;
  if (body.kind === 'percent' && body.percentValue === undefined) {
    ctx.addIssue({ code: 'custom', path: ['percentValue'], message: 'percentValue is required' });
  }
  if (body.kind === 'flat' && body.flatValuePaise === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['flatValuePaise'],
      message: 'flatValuePaise is required',
    });
  }
}

function addWindowIssue(
  body: { startsAt?: string | null; endsAt?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (body.startsAt && body.endsAt && new Date(body.startsAt) >= new Date(body.endsAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'The window must end after it starts',
    });
  }
}

export const adminCouponCreateSchema = z
  .object({
    code: z.string().trim().min(3).max(32),
    kind: couponKindSchema,
    percentValue: percentValueSchema.optional(),
    flatValuePaise: unsignedPaiseSchema.optional(),
    maxDiscountPaise: unsignedPaiseSchema.nullable().optional(),
    minOrderPaise: unsignedPaiseSchema.optional(),
    maxUses: z.number().int().min(1).nullable().optional(),
    maxUsesPerUser: z.number().int().min(1).max(100).optional(),
    startsAt: z.iso.datetime().nullable().optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .superRefine((body, ctx) => {
    addValueIssues(body, ctx, true);
    addWindowIssue(body, ctx);
  });
export type AdminCouponCreate = z.infer<typeof adminCouponCreateSchema>;

/**
 * `PUT /v1/admin/coupons/:id` is an upsert-free PATCH: every field optional,
 * supplied fields only, and `used_count` (and the id, and the created stamp)
 * are not fields at all. No `.partial()` — Phase 13's bug where `.partial()`
 * preserved field defaults has a whole comment in `admin/pricing.ts`; a body
 * here cannot carry a value nobody typed because nothing has a default.
 */
export const adminCouponUpdateSchema = z
  .object({
    code: z.string().trim().min(3).max(32).optional(),
    kind: couponKindSchema.optional(),
    percentValue: percentValueSchema.optional(),
    flatValuePaise: unsignedPaiseSchema.optional(),
    maxDiscountPaise: unsignedPaiseSchema.nullable().optional(),
    minOrderPaise: unsignedPaiseSchema.optional(),
    maxUses: z.number().int().min(1).nullable().optional(),
    maxUsesPerUser: z.number().int().min(1).max(100).optional(),
    startsAt: z.iso.datetime().nullable().optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .superRefine((body, ctx) => {
    addValueIssues(body, ctx, false);
    addWindowIssue(body, ctx);
  });
export type AdminCouponUpdate = z.infer<typeof adminCouponUpdateSchema>;

/** One live redemption row; a released (free-cancel) use is deleted, not flagged. */
export const adminCouponRedemptionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userName: z.string().nullable(),
  bookingId: z.uuid(),
  /** `codeOf(bookingId)` — the short code the console displays everywhere. */
  bookingCode: z.string(),
  discountPaise: unsignedPaiseSchema,
  createdAt: z.iso.datetime(),
});
export type AdminCouponRedemption = z.infer<typeof adminCouponRedemptionSchema>;

export const adminCouponRedemptionsResponseSchema = pageEnvelopeSchema(adminCouponRedemptionSchema);
export type AdminCouponRedemptionsResponse = z.infer<typeof adminCouponRedemptionsResponseSchema>;

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

export const adminBannerSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  imageKey: z.string(),
  /** Presigned at read time for the console's thumbnail. */
  imageUrl: z.string().nullable(),
  ctaLink: z.string().nullable(),
  ctaLabel: z.string().nullable(),
  audience: bannerAudienceSchema,
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminBanner = z.infer<typeof adminBannerSchema>;

export const adminBannersResponseSchema = z.object({ items: z.array(adminBannerSchema) });
export type AdminBannersResponse = z.infer<typeof adminBannersResponseSchema>;

const bannerFields = {
  title: z.string().trim().min(1).max(120),
  imageKey: z.string().trim().min(1).max(300),
  ctaLink: z.string().trim().max(500).nullable().optional(),
  ctaLabel: z.string().trim().max(40).nullable().optional(),
  audience: bannerAudienceSchema,
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
  reason: z.string().trim().max(200).optional(),
};

export const adminBannerCreateSchema = z
  .object(bannerFields)
  .superRefine((body, ctx) => addWindowIssue(body, ctx));
export type AdminBannerCreate = z.infer<typeof adminBannerCreateSchema>;

export const adminBannerUpdateSchema = z
  .object({
    title: bannerFields.title.optional(),
    imageKey: bannerFields.imageKey.optional(),
    ctaLink: bannerFields.ctaLink,
    ctaLabel: bannerFields.ctaLabel,
    audience: bannerFields.audience.optional(),
    startsAt: bannerFields.startsAt,
    endsAt: bannerFields.endsAt,
    isActive: bannerFields.isActive,
    sortOrder: bannerFields.sortOrder,
    reason: bannerFields.reason,
  })
  .superRefine((body, ctx) => addWindowIssue(body, ctx));
export type AdminBannerUpdate = z.infer<typeof adminBannerUpdateSchema>;

/**
 * The image upload is presign-then-put like every other upload in the console
 * (driver documents, RC photos, dispute evidence). The extension is decided
 * SERVER-SIDE from the declared content type — the client picks `image/png`,
 * not a filename, so nothing has to be sanitised out of a free-form string.
 */
export const BANNER_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const bannerImageContentTypeSchema = z.enum(BANNER_IMAGE_CONTENT_TYPES);
export type BannerImageContentType = z.infer<typeof bannerImageContentTypeSchema>;

export const adminBannerPresignSchema = z.object({
  contentType: bannerImageContentTypeSchema,
});
export type AdminBannerPresign = z.infer<typeof adminBannerPresignSchema>;

export const adminBannerPresignResponseSchema = z.object({
  uploadUrl: z.string(),
  key: z.string(),
  expiresAt: z.iso.datetime(),
});
export type AdminBannerPresignResponse = z.infer<typeof adminBannerPresignResponseSchema>;
