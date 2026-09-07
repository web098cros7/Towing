import { z } from 'zod';

/**
 * §9.1.10 / §9.2.5's two-way rating — shared by both realms because both submit
 * one and the shape is identical either way.
 *
 * `direction` is NOT in the request body. It is derived from the route the
 * caller reached (`POST /v1/bookings/:id/rate` is the customer's,
 * `POST /v1/driver/jobs/:id/rate` is the driver's), because a client-supplied
 * direction would be a client asserting which side of the transaction it is on
 * — which the token already settles and the client should not get a vote in.
 */

export const RATING_DIRECTIONS = ['customer_to_driver', 'driver_to_customer'] as const;
export const ratingDirectionSchema = z.enum(RATING_DIRECTIONS);
export type RatingDirection = z.infer<typeof ratingDirectionSchema>;

export const ratingSubmitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  /**
   * Optional. §9.1.10 asks for "rate & review", and a rating with no words is
   * the overwhelmingly common case — requiring text would cost most of the
   * ratings, which is the input §6.2 actually needs.
   */
  review: z.string().trim().max(1000).optional(),
});
export type RatingSubmit = z.infer<typeof ratingSubmitSchema>;

export const ratingSchema = z.object({
  bookingId: z.uuid(),
  direction: ratingDirectionSchema,
  rating: z.number().int().min(1).max(5),
  review: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RatingDto = z.infer<typeof ratingSchema>;

/**
 * What a screen needs to decide whether to prompt: has this side rated yet, and
 * what did they say if so.
 *
 * Derived from `uq_ratings_booking_direction` rather than a `bookings.rated`
 * flag — a denormalised boolean would be a second source of truth for a fact
 * the unique index already owns, and one that can drift.
 */
export const ratingStateSchema = z.object({
  mine: ratingSchema.nullable(),
  canRate: z.boolean(),
});
export type RatingStateDto = z.infer<typeof ratingStateSchema>;
