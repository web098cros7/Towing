import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns';
import { bookings } from './bookings';
import { drivers } from './drivers';
import { users } from './users';

/**
 * §9.1.10 / §9.2.5's two-way rating — and the LAST unwritten input to the §6.2
 * dispatch scorer.
 *
 * `drivers.rating` has been read by `candidate-selection.service.ts` since
 * Phase 17 and weighted at 15 % of the score, while nothing ever wrote it: the
 * scorer ran on whatever the seed happened to set. Phase 18 gave
 * `completion_rate` and `total_trips` their first writers; this table is the
 * fourth and last, which is what finally makes the score a measurement rather
 * than a fixture.
 *
 * `driver_id` AND `user_id` ARE DENORMALISED FROM THE BOOKING DELIBERATELY.
 * Phase 20 ships admin reassignment (`POST /admin/bookings/:id/reassign`); a
 * rollup that re-joined `bookings` to find the driver would silently move a
 * historical rating to whoever holds the booking today. The rating is about
 * the person who did the job, so it stores the person who did the job.
 *
 * §17's shape (`booking_id, driver_id, rating, review`) is preserved intact —
 * `direction` and `user_id` are the two columns that make it two-way.
 */
export const ratings = pgTable(
  'ratings',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `customer_to_driver` or `driver_to_customer`; see `RATING_DIRECTIONS`. */
    direction: text('direction').notNull(),
    /** 1–5, integer. A CHECK pins the range. */
    rating: integer('rating').notNull(),
    review: text('review'),
    ...timestamps,
  },
  (t) => [
    /**
     * The two-way shape AND the idempotency backstop in one index: one rating
     * per booking per direction. A double-tapped star is an UPSERT, never a
     * second row — which is exactly why the rate endpoints take no
     * `Idempotency-Key` header. A unique index is a stronger mechanism than a
     * replayed cached response, the same argument `JobExecutionController`
     * makes for `arrived` and `complete`.
     */
    uniqueIndex('uq_ratings_booking_direction').on(t.bookingId, t.direction),
    /**
     * Backs the `drivers.rating` rollup, which averages the customer's half
     * only. Partial, because the driver's half of the table is never averaged
     * into anything — there is no `users.rating` column, on purpose: nothing
     * scores customers, and a field with no reader is worse than no field.
     */
    index('idx_ratings_driver').on(t.driverId, t.createdAt),
  ],
);

/**
 * The TypeScript half of `ck_ratings_direction`. `migration-0016.spec.ts`
 * parses the migration and asserts this list against the SQL IN-list, the
 * house convention for a CHECK that duplicates a union
 * (`dispatch-invariants.spec.ts` does the same against 0014).
 */
export const RATING_DIRECTIONS = ['customer_to_driver', 'driver_to_customer'] as const;
export type RatingDirection = (typeof RATING_DIRECTIONS)[number];
