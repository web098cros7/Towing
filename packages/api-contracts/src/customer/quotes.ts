import { z } from 'zod';
import { geoPointSchema } from '../common/geo';
import { unsignedPaiseSchema } from '../common/money';
import { vehicleClassSchema } from '../fleet/trucks';
import { bookingDetailSchema } from './bookings';

/**
 * The customer's manual-quote lane (§7.3, W20).
 *
 * WHY THIS EXISTS: `POST /v1/pricing/estimate` refuses anything over 600 km
 * with `manual_quote_required` — the engine has no honest slab out there, and
 * a fabricated per-km rate for a 900 km recovery is how a marketplace loses
 * money on its best customers. That refusal used to be a dead end ("contact
 * support"). Here it becomes a REQUEST the customer can file from the app: the
 * app says "request a manual quote", this route carries it to the console, and
 * an operator prices it.
 *
 * A QUOTE IS NOT A BOOKING. The customer must ACCEPT (`/v1/quotes/:id/accept`)
 * before any trip exists, and only a `quoted` row that has not lapsed can be
 * accepted. The price is locked when the operator writes it — accepting later
 * re-derives nothing, because the amounts travel on the row.
 */

export const QUOTE_STATUSES = [
  'requested',
  'quoted',
  'accepted',
  'rejected',
  'expired',
] as const;
export const quoteStatusSchema = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

/**
 * `POST /v1/quotes` — the request itself.
 *
 * `drop` is REQUIRED here, unlike a booking: the whole reason this route exists
 * is a long haul, and a long haul has a destination. A roadside job never
 * reaches the manual lane.
 */
export const quoteRequestSchema = z.object({
  serviceSlug: z.string().min(1),
  vehicleClass: vehicleClassSchema.optional(),
  pickup: geoPointSchema,
  pickupAddress: z.string().min(1).max(300).optional(),
  drop: geoPointSchema,
  dropAddress: z.string().min(1).max(300).optional(),
  /** Whatever the customer wants the operator to know — size, access, timing. */
  notes: z.string().trim().max(500).optional(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteSchema = z.object({
  id: z.uuid(),
  status: quoteStatusSchema,
  serviceSlug: z.string(),
  vehicleClass: z.string(),
  pickup: geoPointSchema,
  pickupAddress: z.string().nullable(),
  drop: geoPointSchema.nullable(),
  dropAddress: z.string().nullable(),
  /** Billed km at request time (road factor applied). */
  distanceKm: z.number(),
  notes: z.string().nullable(),
  /** Null until an operator quotes. */
  totalPaise: unsignedPaiseSchema.nullable(),
  /** The operator's memo, flattened out of the stored breakdown. */
  quoteNote: z.string().nullable(),
  validUntil: z.iso.datetime().nullable(),
  quotedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** Set once the quote is accepted and became a booking. */
  bookingId: z.uuid().nullable(),
  requestedAt: z.iso.datetime(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const quotesResponseSchema = z.object({
  items: z.array(quoteSchema),
});
export type QuotesResponse = z.infer<typeof quotesResponseSchema>;

/**
 * `POST /v1/quotes/:id/accept` — the booking is created HERE, with the quoted
 * amounts locked onto it (§3.4's snapshot discipline), and the response is the
 * booking the customer already knows how to render.
 */
export const quoteAcceptResponseSchema = z.object({
  booking: bookingDetailSchema,
  quote: quoteSchema,
});
export type QuoteAcceptResponse = z.infer<typeof quoteAcceptResponseSchema>;
