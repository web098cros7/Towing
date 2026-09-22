import { z } from 'zod';
import { unsignedPaiseSchema } from '../common/money';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import { quoteSchema, quoteStatusSchema } from '../customer/quotes';

/**
 * W20 — the manual-quote queue (§7.3), `/admin/quotes`.
 *
 * THE OPERATOR NAMES ONE NUMBER. `totalPaise` is the whole price — the console
 * shows the billed distance and lets the operator type the figure they would
 * defend on the phone, plus a memo the customer sees. A field-per-charge form
 * would invite an operator to build a fare the pricing engine would never have
 * produced, and nothing downstream could tell the difference.
 *
 * The commission split is NOT in the request: it is read from the rate card at
 * quote time, exactly as the automatic path locks it, so a manual price cannot
 * quietly pay the driver a different share.
 */

export const adminQuotesQuerySchema = pageQuerySchema.extend({
  status: quoteStatusSchema.optional(),
});
export type AdminQuotesQuery = z.infer<typeof adminQuotesQuerySchema>;

export const adminQuoteSchema = quoteSchema.extend({
  /** Customers' name or masked mobile — the same shape the privacy queue uses. */
  userLabel: z.string().nullable(),
  quotedBy: z.uuid().nullable(),
  /** Why a rejection happened — internal, never shown to the customer. */
  rejectionReason: z.string().nullable(),
});
export type AdminQuote = z.infer<typeof adminQuoteSchema>;

export const adminQuotesResponseSchema = pageEnvelopeSchema(adminQuoteSchema);
export type AdminQuotesResponse = z.infer<typeof adminQuotesResponseSchema>;

export const adminQuoteDecisionSchema = z.object({
  /** The price the customer will see and accept. At least ₹1 — a free tow is a refund, not a quote. */
  totalPaise: unsignedPaiseSchema.min(100),
  /** Shown to the customer with the offer. */
  note: z.string().trim().max(500).optional(),
  /** How long the offer stands. Bounded at a week; 48 h is the default. */
  validHours: z.number().int().min(1).max(168).optional(),
});
export type AdminQuoteDecision = z.infer<typeof adminQuoteDecisionSchema>;

export const adminQuoteRejectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type AdminQuoteReject = z.infer<typeof adminQuoteRejectSchema>;
