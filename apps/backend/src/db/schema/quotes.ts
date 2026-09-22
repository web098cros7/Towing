import {
  bigint,
  doublePrecision,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin';
import { bookings } from './bookings';
import { primaryId, timestamps } from './columns';
import { users } from './users';

/**
 * §7.3's manual-quote lane (W20). The estimate path refuses >600 km jobs with
 * `manual_quote_required`; this table is where that refusal turns into a
 * request, an operator's price, and — if accepted in time — a booking.
 *
 * CHECK-constrained in migration 0034, which also pins
 * "a quoted row carries its amounts".
 */
export const QUOTE_STATUSES = ['requested', 'quoted', 'accepted', 'rejected', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** What the operator priced, kept verbatim so the booking can copy it. */
export interface QuoteBreakdown {
  /** Free-text memo from the operator — shown to the customer with the offer. */
  note?: string;
  /** `'manual'` marks the origin for anything reading the JSON later. */
  source: 'manual';
}

export const quotes = pgTable(
  'quotes',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** A `QuoteStatus` — CHECK-constrained in migration 0034. */
    status: text('status').notNull().default('requested'),

    serviceSlug: text('service_slug').notNull(),
    vehicleClass: text('vehicle_class').notNull(),

    pickupLat: doublePrecision('pickup_lat').notNull(),
    pickupLng: doublePrecision('pickup_lng').notNull(),
    pickupAddress: text('pickup_address'),
    dropLat: doublePrecision('drop_lat'),
    dropLng: doublePrecision('drop_lng'),
    dropAddress: text('drop_address'),

    /** Billed km at request time (road factor applied), so the operator sees the same number the fare would use. */
    distanceKm: numeric('distance_km', { precision: 8, scale: 2 }).notNull(),
    notes: text('notes'),

    // ── PAISE, unlike the domain tables' NUMERIC rupees: see the migration's note. ──
    totalPaise: bigint('total_paise', { mode: 'number' }),
    /** `QuoteBreakdown` — the operator's own memo, not a fare breakdown. */
    breakdown: jsonb('breakdown').$type<QuoteBreakdown>(),
    /**
     * The commission locked WHEN THE OPERATOR QUOTED, not when the customer
     * accepts. A rate-card edit between the two must not change a price the
     * customer already saw — §3.4's rule, applied to the manual lane.
     */
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }),
    commissionPaise: bigint('commission_paise', { mode: 'number' }),
    driverPayoutPaise: bigint('driver_payout_paise', { mode: 'number' }),

    quotedBy: uuid('quoted_by').references(() => adminUsers.id),
    quotedAt: timestamp('quoted_at', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    /** Required when an operator rejects — the customer sees no quote, so this is the record of why. */
    rejectionReason: text('rejection_reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),

    /** The trip the accepted quote became. One way — a quote is not re-usable. */
    bookingId: uuid('booking_id').references(() => bookings.id),

    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('idx_quotes_user').on(t.userId, t.requestedAt.desc()),
    index('idx_quotes_status').on(t.status, t.requestedAt),
  ],
);
