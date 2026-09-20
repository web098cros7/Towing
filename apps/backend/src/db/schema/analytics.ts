import { bigint, date, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bookings } from './bookings';
import { serviceZones } from './service-zones';

/**
 * W17's rollups + §22.1's event tracker (migration 0032).
 *
 * Every write is an ABSOLUTE day recompute (`analytics-rollup.ts` deletes and
 * re-inserts the whole day in one transaction), because at-least-once job
 * delivery makes increments unsafe — the same reasoning the earnings
 * projector documents at length.
 *
 * Money is `bigint` paise (roomy; read back with `Number(...)` — the loader
 * casts to `::float8` and the values are far below 2^53). Rates are basis
 * points. `on_time_bps` stays NULL until a promised-ETA column exists.
 */

export const analyticsDaily = pgTable('analytics_daily', {
  day: date('day').primaryKey(),
  bookingsCreated: integer('bookings_created').notNull().default(0),
  bookingsMatched: integer('bookings_matched').notNull().default(0),
  bookingsCompleted: integer('bookings_completed').notNull().default(0),
  bookingsPaid: integer('bookings_paid').notNull().default(0),
  bookingsCancelled: integer('bookings_cancelled').notNull().default(0),
  noDriversFound: integer('no_drivers_found').notNull().default(0),
  gmvPaise: bigint('gmv_paise', { mode: 'number' }).notNull().default(0),
  commissionPaise: bigint('commission_paise', { mode: 'number' }).notNull().default(0),
  taxPaise: bigint('tax_paise', { mode: 'number' }).notNull().default(0),
  discountPaise: bigint('discount_paise', { mode: 'number' }).notNull().default(0),
  refundsPaise: bigint('refunds_paise', { mode: 'number' }).notNull().default(0),
  aovPaise: bigint('aov_paise', { mode: 'number' }).notNull().default(0),
  takeRateBps: integer('take_rate_bps').notNull().default(0),
  fillRateBps: integer('fill_rate_bps').notNull().default(0),
  ttmP50S: integer('ttm_p50_s'),
  ttmP90S: integer('ttm_p90_s'),
  /** Always NULL today — no promised-ETA column exists to measure against. */
  onTimeBps: integer('on_time_bps'),
  activeDrivers: integer('active_drivers').notNull().default(0),
  newCustomers: integer('new_customers').notNull().default(0),
  couponRedemptions: integer('coupon_redemptions').notNull().default(0),
  sosAlerts: integer('sos_alerts').notNull().default(0),
  sosAckP95S: integer('sos_ack_p95_s'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const analyticsZoneDaily = pgTable(
  'analytics_zone_daily',
  {
    day: date('day').notNull(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => serviceZones.id),
    bookingsCreated: integer('bookings_created').notNull().default(0),
    bookingsMatched: integer('bookings_matched').notNull().default(0),
    noDriversFound: integer('no_drivers_found').notNull().default(0),
    gmvPaise: bigint('gmv_paise', { mode: 'number' }).notNull().default(0),
    commissionPaise: bigint('commission_paise', { mode: 'number' }).notNull().default(0),
    ttmP50S: integer('ttm_p50_s'),
  },
  (t) => [primaryKey({ columns: [t.day, t.zoneId] })],
);

export const analyticsBandDaily = pgTable(
  'analytics_band_daily',
  {
    day: date('day').notNull(),
    /** `commission_band` enum: A/B/C. */
    band: text('band').notNull(),
    bookingsPaid: integer('bookings_paid').notNull().default(0),
    gmvPaise: bigint('gmv_paise', { mode: 'number' }).notNull().default(0),
    commissionPaise: bigint('commission_paise', { mode: 'number' }).notNull().default(0),
    driverPayoutPaise: bigint('driver_payout_paise', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.band] })],
);

export const analyticsDemandGrid = pgTable(
  'analytics_demand_grid',
  {
    day: date('day').notNull(),
    hour: smallint('hour').notNull(),
    cellLat: numeric('cell_lat', { precision: 6, scale: 2 }).notNull(),
    cellLng: numeric('cell_lng', { precision: 6, scale: 2 }).notNull(),
    bookings: integer('bookings').notNull().default(0),
    noDrivers: integer('no_drivers').notNull().default(0),
    avgWave: numeric('avg_wave', { precision: 4, scale: 1 }),
  },
  (t) => [primaryKey({ columns: [t.day, t.hour, t.cellLat, t.cellLng] })],
);

/**
 * §22.1's server-emitted facts (19vi). `props` carries ids and enums only —
 * no PII by rule; see the migration's header.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    props: jsonb('props').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_analytics_events_name_time').on(t.name, t.occurredAt),
    index('idx_analytics_events_booking').on(t.bookingId),
  ],
);
