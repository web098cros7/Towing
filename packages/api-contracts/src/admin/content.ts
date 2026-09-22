import { z } from 'zod';
import { contentPageKindSchema } from '../common/content';

/**
 * W15's content editor — `/v1/admin/content` (`content.edit`, §9.4.12).
 *
 * The admin list is the same page shape as the public read plus the lifecycle
 * fields (`isPublished`, author), because the console's job is exactly the
 * difference between the two: seeing what is NOT live yet.
 */

export const adminContentPageSchema = z.object({
  slug: z.string(),
  kind: contentPageKindSchema,
  title: z.string(),
  bodyMd: z.string(),
  locale: z.string(),
  isPublished: z.boolean(),
  sortOrder: z.number().int(),
  updatedBy: z.uuid().nullable(),
  updatedByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminContentPage = z.infer<typeof adminContentPageSchema>;

export const adminContentPagesQuerySchema = z.object({
  kind: contentPageKindSchema.optional(),
});
export type AdminContentPagesQuery = z.infer<typeof adminContentPagesQuerySchema>;

export const adminContentPagesResponseSchema = z.object({
  items: z.array(adminContentPageSchema),
});
export type AdminContentPagesResponse = z.infer<typeof adminContentPagesResponseSchema>;

/** `PUT /v1/admin/content/:slug` — an upsert, because creating and editing one page is one action. */
export const adminContentUpsertBodySchema = z.object({
  kind: contentPageKindSchema,
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().trim().min(1).max(20_000),
  locale: z.string().trim().min(2).max(10).optional(),
  isPublished: z.boolean(),
  sortOrder: z.number().int().min(-1000).max(1000),
});
export type AdminContentUpsertBody = z.infer<typeof adminContentUpsertBodySchema>;
