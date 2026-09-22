import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId } from './columns';
import { users } from './users';
import { bookings } from './bookings';

/**
 * One referral code per user, minted on first share. The code is stored as
 * typed and matched case-insensitively — the unique index is on `upper(code)`,
 * the same shape `coupons` uses.
 */
export const referralCodes = pgTable(
  'referral_codes',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_referral_codes_code').on(sql`upper(${t.code})`)],
);

/**
 * One row per referee, ever — the unique index on `referee_user_id` is the
 * rule, not a check. `pending` until the referee's first completed booking
 * rewards both sides; `rewarded` is terminal.
 */
export const referralRedemptions = pgTable(
  'referral_redemptions',
  {
    id: primaryId(),
    referrerUserId: uuid('referrer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refereeUserId: uuid('referee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    status: text('status').notNull().default('pending'),
    rewardedBookingId: uuid('rewarded_booking_id').references(() => bookings.id, {
      onDelete: 'set null',
    }),
    rewardedAt: timestamp('rewarded_at', { withTimezone: true }),
    /** The amounts actually credited, frozen at reward time (config can change later). */
    referrerRewardPaise: integer('referrer_reward_paise'),
    refereeRewardPaise: integer('referee_reward_paise'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_referral_redemptions_referee').on(t.refereeUserId),
    index('idx_referral_redemptions_referrer').on(t.referrerUserId, t.createdAt.desc()),
  ],
);
