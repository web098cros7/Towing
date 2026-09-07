import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ErrorCodes,
  type RatingDirection,
  type RatingDto,
  type RatingStateDto,
  type RatingSubmit,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';

/**
 * §9.1.10 / §9.2.5's two-way rating — and the writer that finally makes §6.2's
 * dispatch score a measurement rather than a fixture.
 *
 * `drivers.rating` has been READ by `candidate-selection.service.ts` since
 * Phase 17 and weighted at 15 % of every dispatch decision, while nothing ever
 * wrote it: the scorer ran on whatever the seed happened to set. Phase 18 gave
 * `completion_rate` and `total_trips` their first writers; this is the fourth
 * and last of the four scorer inputs.
 */
@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Submit or amend a rating.
   *
   * NO `Idempotency-Key` ON THE ROUTE, deliberately.
   * `uq_ratings_booking_direction` makes a repeat an UPSERT rather than a
   * second row, which is a stronger mechanism than a replayed cached response
   * — the same argument `JobExecutionController` makes for `arrived` and
   * `complete`. It also means a customer can genuinely change their mind, which
   * an idempotency key would have turned into a silent no-op.
   */
  async submit(params: {
    bookingId: string;
    actorId: string;
    direction: RatingDirection;
    input: RatingSubmit;
  }): Promise<RatingDto> {
    const booking = await this.participantBooking(params.bookingId, params.actorId, params.direction);

    // Rating an unfinished trip. 409 rather than 404: the booking is theirs and
    // saying so is not a disclosure — the timing is the problem.
    if (booking.status !== 'completed' && booking.status !== 'paid') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.RATING_NOT_ALLOWED,
        'This trip can be rated once it is finished',
        { status: booking.status },
      );
    }

    const [row] = (await this.db.execute(sql`
      insert into ratings (booking_id, driver_id, user_id, direction, rating, review)
      values (${params.bookingId}::uuid, ${booking.driverId}::uuid, ${booking.userId}::uuid,
              ${params.direction}, ${params.input.rating}, ${params.input.review ?? null})
      on conflict (booking_id, direction) do update
        set rating = excluded.rating, review = excluded.review, updated_at = now()
      returning *
    `)) as unknown as Array<Record<string, unknown>>;

    // AFTER the row commits, never inside its transaction, and never allowed to
    // fail the request — the same discipline `DriverStatsService` uses.
    if (params.direction === 'customer_to_driver') {
      await this.recomputeDriverRating(booking.driverId);
    }

    return toDto(row!);
  }

  async state(
    bookingId: string,
    actorId: string,
    direction: RatingDirection,
  ): Promise<RatingStateDto> {
    const booking = await this.participantBooking(bookingId, actorId, direction);

    const [row] = (await this.db.execute(sql`
      select * from ratings where booking_id = ${bookingId}::uuid and direction = ${direction}
    `)) as unknown as Array<Record<string, unknown> | undefined>;

    return {
      mine: row ? toDto(row) : null,
      canRate: booking.status === 'completed' || booking.status === 'paid',
    };
  }

  /**
   * `drivers.rating`, recomputed from scratch.
   *
   * RECOMPUTED, NEVER INCREMENTED — the rule `DriverStatsService` writes down,
   * and it is what makes this self-healing: a retry, a crash between the insert
   * and this call, or a hand-corrected row all converge on the right number
   * without anybody reasoning about deltas.
   *
   * LIFETIME, NOT A ROLLING WINDOW, unlike `completion_rate`'s 30 days. §9.2.5
   * renders it as a career number and §6.2 treats it as reputation rather than
   * recent form; a driver's rating should not quietly reset because they took a
   * month off.
   *
   * NULL WHEN THERE IS NO SIGNAL, not 5.0. `candidate-selection.score()` maps
   * null to its NEUTRAL midpoint; a hard-coded 5.0 would rank every brand-new
   * driver above the people who earned theirs.
   */
  async recomputeDriverRating(driverId: string): Promise<void> {
    try {
      await this.db.execute(sql`
        update drivers
           set rating = (
                 select round(avg(rating)::numeric, 1)
                   from ratings
                  where driver_id = ${driverId}::uuid
                    and direction = 'customer_to_driver'
               ),
               updated_at = now()
         where id = ${driverId}::uuid
      `);
    } catch (error) {
      // Never throws. A rating that was recorded but whose rollup failed is a
      // stale score; a rating that 500s because the rollup failed is a lost
      // rating. The nightly reconcile is not needed here — the next rating for
      // this driver recomputes the whole average anyway.
      this.logger.warn(`rating rollup failed for driver ${driverId}: ${String(error)}`);
    }
  }

  /**
   * The booking, if the caller is the right participant.
   *
   * 404 RATHER THAN 403 for somebody else's booking: a 403 confirms the booking
   * exists, which is itself a disclosure to a stranger guessing ids.
   */
  private async participantBooking(
    bookingId: string,
    actorId: string,
    direction: RatingDirection,
  ): Promise<{ status: string; driverId: string; userId: string }> {
    const [row] = (await this.db.execute(sql`
      select status, driver_id, user_id from bookings where id = ${bookingId}::uuid
    `)) as unknown as Array<
      { status: string; driver_id: string | null; user_id: string } | undefined
    >;

    if (!row || !row.driver_id) throw ApiException.notFound('Booking not found');

    const expected = direction === 'customer_to_driver' ? row.user_id : row.driver_id;
    if (expected !== actorId) throw ApiException.notFound('Booking not found');

    return { status: row.status, driverId: row.driver_id, userId: row.user_id };
  }
}

function toDto(row: Record<string, unknown>): RatingDto {
  return {
    bookingId: row.booking_id as string,
    direction: row.direction as RatingDirection,
    rating: Number(row.rating),
    review: (row.review as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}
