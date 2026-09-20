import { z } from 'zod';

/**
 * W15's FAQ and legal content — the PUBLIC half (`GET /v1/content/:kind`).
 *
 * The customer app currently ships six hardcoded FAQs and two dead legal links
 * (ToBeDoneEhsan D-v); this is what replaces both. `bodyMd` is authored as
 * markdown but rendered as whitespace-preserved text by every consumer today —
 * no renderer ships on either side, and the column name is the authoring
 * contract, not a rendering claim.
 */

export const CONTENT_PAGE_KINDS = ['faq', 'legal'] as const;
export const contentPageKindSchema = z.enum(CONTENT_PAGE_KINDS);
export type ContentPageKind = z.infer<typeof contentPageKindSchema>;

export const contentPageSchema = z.object({
  slug: z.string(),
  kind: contentPageKindSchema,
  title: z.string(),
  bodyMd: z.string(),
  locale: z.string(),
  sortOrder: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type ContentPage = z.infer<typeof contentPageSchema>;

export const contentPagesResponseSchema = z.object({
  items: z.array(contentPageSchema),
});
export type ContentPagesResponse = z.infer<typeof contentPagesResponseSchema>;

/** Slugs are the URL's last segment: lowercase, hyphenated, boring on purpose. */
export const contentSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words joined by hyphens');
