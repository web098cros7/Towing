import { z } from 'zod';

/**
 * §9.4.11's banners — the carousel content an operator schedules (W16).
 *
 * PUBLIC SHAPE, NOT ADMIN SHAPE. The carousel needs an image URL, a title and
 * a CTA; it does not need `imageKey`, `isActive`, the window, or who created
 * it. The keys stay in the console (they are storage internals, and the URL is
 * minted at read time from them), which is also why this file is not under
 * `admin/`: `GET /v1/banners` is the one promotions read that has no console
 * consumer at all.
 */

export const BANNER_AUDIENCES = ['customer', 'driver'] as const;
export const bannerAudienceSchema = z.enum(BANNER_AUDIENCES);
export type BannerAudience = z.infer<typeof bannerAudienceSchema>;

export const publicBannerSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  /** Presigned at read time; the storage key itself never leaves the console. */
  imageUrl: z.string(),
  ctaLink: z.string().nullable(),
  ctaLabel: z.string().nullable(),
  audience: bannerAudienceSchema,
});
export type PublicBanner = z.infer<typeof publicBannerSchema>;

export const publicBannersQuerySchema = z.object({
  /** Defaults to the customer carousel — the app that has one today. */
  audience: bannerAudienceSchema.default('customer'),
});
export type PublicBannersQuery = z.infer<typeof publicBannersQuerySchema>;

export const publicBannersResponseSchema = z.object({
  items: z.array(publicBannerSchema),
});
export type PublicBannersResponse = z.infer<typeof publicBannersResponseSchema>;
