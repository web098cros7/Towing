import { boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { money, primaryId, timestamps } from './columns';
import { users } from './users';
import { bookings } from './bookings';

/**
 * §9.4.11's coupons, and only the half a customer touches.
 *
 * WHAT PHASE 19 SHIPPED: the table, `POST /v1/coupons/validate`, and
 * application at confirm. Application was included rather than deferred
 * because the discount already flowed end to end —
 * `fareBreakdownSchema.discountPaise`, `computeFare`'s `discountPaise` clamp
 * and `bookings.discount` have all existed since Phase 14 — so shipping
 * validate-only would have left `discountPaise` permanently zero and the
 * endpoint decorative.
 *
 * WHAT IT DID NOT: §9.4.11's admin coupon MANAGER (CRUD, scheduling, usage
 * analytics) is Phase 20's Promotions line, alongside `banners`. Until then
 * rows arrive from the seed or by hand. Recorded here so the next phase does
 * not have to re-derive the boundary.
 *
 * COMMISSION IS COMPUTED ON THE POST-DISCOUNT AMOUNT, so a coupon costs the
 * platform and the driver proportionally. §3.3 is silent on this and the
 * pricing code already behaved this way before coupons existed; it is a
 * deliberate no-change, written down so nobody "fixes" it into a rule that
 * makes the driver eat the whole promotion.
 */
export const coupons = pgTable(
  'coupons',
  {
    id: primaryId(),
    /**
     * Stored as the admin typed it, matched case-insensitively — the unique
     * index is on `upper(code)`. Customers type `SAVE20`, `save20` and
     * `Save20`, and a code that works in one casing is a support ticket.
     */
    code: text('code').notNull(),
    /** `percent` or `flat`. A CHECK pins the pair; see `COUPON_KINDS`. */
    kind: text('kind').notNull(),
    /** Percentage points when `percent`, rupees when `flat`. */
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    /** Caps a percentage coupon. NULL means uncapped. */
    maxDiscount: money('max_discount'),
    minOrder: money('min_order').notNull().default('0'),
    /** NULL means unlimited. Enforced by a conditional UPDATE, not a SELECT. */
    maxUses: integer('max_uses'),
    maxUsesPerUser: integer('max_uses_per_user').notNull().default(1),
    /**
     * Denormalised counter over `coupon_redemptions`, incremented by the same
     * conditional UPDATE that enforces `max_uses`. `couponDrift` polices the
     * two against each other in the nightly reconcile, because a counter that
     * can drift silently is worse than no counter.
     */
    usedCount: integer('used_count').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('uq_coupons_code').on(sql`upper(${t.code})`)],
);

/**
 * One row per booking that used a coupon — the truth `coupons.used_count`
 * summarises, and the per-user cap's only evidence.
 *
 * Written inside the confirm transaction, so there is no window in which a
 * booking carries a discount whose redemption was never recorded, and none in
 * which a redemption survives a booking that rolled back.
 *
 * A FREE cancellation returns the use (the redemption row is deleted and the
 * counter decremented); a CHARGEABLE one does not. Burning a single-use code
 * on a ninety-second cancellation is user-hostile; keeping it burnt when a
 * driver actually turned up is not.
 */
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: primaryId(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    discountAmount: money('discount_amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_coupon_redemptions_booking').on(t.bookingId),
    index('idx_coupon_redemptions_user').on(t.couponId, t.userId),
  ],
);
