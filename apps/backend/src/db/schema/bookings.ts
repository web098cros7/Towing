import {
  boolean,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { money, primaryId, timestamps } from './columns';
import { coupons } from './promotions';
import {
  actorRoleEnum,
  bookingStatusEnum,
  commissionBandEnum,
  paymentMethodEnum,
  serviceTypeEnum,
  vehicleClassEnum,
} from './enums';
import { drivers } from './drivers';
import { fleets } from './fleets';
import { fleetTrucks } from './trucks';
import { serviceZones } from './service-zones';
import { users } from './users';

/**
 * Bookings (§17 BOOKINGS, state machine §5.1).
 *
 * The fare breakdown, `commission_band` and `commission_pct` are locked at
 * confirm time in the same transaction as assignment (§3.4) — later admin edits
 * to commission config must never retro-change a booking's economics.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    driverId: uuid('driver_id').references(() => drivers.id),
    fleetId: uuid('fleet_id').references(() => fleets.id),
    zoneId: uuid('zone_id').references(() => serviceZones.id),

    serviceType: serviceTypeEnum('service_type').notNull(),
    vehicleClass: vehicleClassEnum('vehicle_class').notNull(),

    pickupLat: doublePrecision('pickup_lat').notNull(),
    pickupLng: doublePrecision('pickup_lng').notNull(),
    pickupAddress: text('pickup_address'),
    dropLat: doublePrecision('drop_lat'),
    dropLng: doublePrecision('drop_lng'),
    dropAddress: text('drop_address'),
    distanceKm: numeric('distance_km', { precision: 8, scale: 2 }),

    status: bookingStatusEnum('status').notNull().default('searching'),

    baseFare: money('base_fare').notNull().default('0'),
    distanceCharge: money('distance_charge').notNull().default('0'),
    nightCharge: money('night_charge').notNull().default('0'),
    highwayCharge: money('highway_charge').notNull().default('0'),
    accidentCharge: money('accident_charge').notNull().default('0'),
    waitingCharge: money('waiting_charge').notNull().default('0'),
    surgeAmount: money('surge_amount').notNull().default('0'),
    discount: money('discount').notNull().default('0'),
    total: money('total').notNull().default('0'),

    commissionBand: commissionBandEnum('commission_band'),
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }),
    commissionAmount: money('commission_amount').notNull().default('0'),
    driverPayout: money('driver_payout').notNull().default('0'),

    /**
     * §14 GST, SNAPSHOTTED AT CONFIRM like `commission_pct` and
     * `waiting_per_minute`, and DEFAULTING TO ZERO.
     *
     * The spec collects `gstin` and never uses it — no tax line in §7's fare
     * formula, none on commission, no TDS/TCS on payouts. Phase 19 made the
     * schema ready rather than invent a tax model (which needs an accountant)
     * or defer it (which would mean migrating live money rows later). Nothing
     * computes differently until an admin sets `charge_config.tax_pct`.
     *
     * THE ARITHMETIC THE WHOLE PHASE HANGS ON:
     *   taxable    = the pre-tax fare (what `total` was before this column)
     *   tax_amount = round(taxable × tax_pct / 100)
     *   total      = taxable + tax_amount
     *   commission = commissionPaise(TAXABLE, band)  — never on `total`
     *   ⇒ commission_amount + driver_payout + tax_amount ≡ total
     * `ck_bookings_payout_within_total` and `bookingDrift` both enforce that
     * identity; crediting a driver a share of the government's money is the
     * single most likely arithmetic mistake here and both will catch it.
     *
     * The snapshot is load-bearing: `complete` re-derives the fare from the
     * waiting charge, and re-reading a live rate mid-trip is exactly the
     * re-pricing §3.4 forbids.
     */
    taxPct: numeric('tax_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),

    /**
     * §9.4.11's coupon, consumed in the SAME transaction that locks the fare.
     * The code is denormalised beside the id so an invoice rendered a year
     * later still shows what the customer typed, even if the coupon is edited.
     * The discount itself lives in `discount` — which has existed, always zero,
     * since 0001.
     */
    couponId: uuid('coupon_id').references(() => coupons.id),
    couponCode: text('coupon_code'),

    /**
     * §5.1's booking OTP, SHA-256 hashed — never the code itself.
     *
     * This column was `booking_otp text` holding the PLAINTEXT code until
     * migration 0012 (only the seed had ever written it). Phase 13 refused to
     * route OTPs through the notification spine precisely because that would
     * "reverse the hash-at-rest posture `login_challenges.code_hash` has"; a
     * plaintext booking OTP sitting on the row for the life of the trip did
     * exactly that, and this is the same digest those login codes use.
     */
    bookingOtpHash: text('booking_otp_hash'),
    otpVerified: boolean('otp_verified').notNull().default(false),
    /**
     * End of the current 30-minute window (§9.1.7). Retrieval past it mints a
     * fresh code and restarts the clock — a tow can easily outlast one window,
     * and a dead code at the handover is worse than a rotated one.
     */
    otpExpiresAt: timestamp('otp_expires_at', { withTimezone: true }),
    /** §9.2.3 "wrong OTP (retry, capped)". Had nowhere to live before 0012. */
    otpAttempts: integer('otp_attempts').notNull().default(0),

    /**
     * §11.7's share-trip link. 128 bits of `randomBytes`, base64url, scoped to
     * this booking, guarded by `uq_bookings_share_token` (a PARTIAL unique index
     * — migration 0012 — so the overwhelming majority of rows, which never share,
     * cost nothing and do not collide on NULL).
     *
     * Present since migration 0001 with zero readers and zero writers until
     * Phase 18. `share_expires_at` stays NULL for a live trip and is set to
     * `completed_at + 30 min` by the finalizer; revoking simply nulls the token,
     * which frees the index slot and makes the link a 404 rather than a
     * tombstone.
     */
    shareToken: text('share_token'),
    shareExpiresAt: timestamp('share_expires_at', { withTimezone: true }),

    /**
     * §5.2's lifecycle instants, written by `JobExecutionService` in the same
     * UPDATE as the status transition (Phase 18, migration 0015).
     *
     * DENORMALISED FROM `booking_status_history` ON PURPOSE, which is otherwise
     * against the grain of this schema. Two readers force it: TowPartner's
     * waiting ticker recomputes `now - arrivedAt` four times a second and needs
     * the instant on the job payload rather than behind a history scan, and the
     * fare finalizer bills `startedAt - arrivedAt` — a fare derived from an
     * append-only log would change if anyone ever wrote a corrective row.
     * History remains authoritative for what happened and who did it.
     */
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /**
     * §7.4's waiting rules, snapshotted at confirm — the §3.4 lock extended to
     * the one charge that cannot be computed at confirm time.
     *
     * Everything else in the breakdown is frozen on this row already. Waiting was
     * the exception, and reading `charge_config` live at completion meant an admin
     * raising the per-minute rate at 14:00 re-priced every trip still running from
     * 13:40. Nullable only because rows predating migration 0015 exist; the
     * backfill gave them the rates in force.
     */
    waitingFreeMinutes: integer('waiting_free_minutes'),
    waitingPerMinute: numeric('waiting_per_minute', { precision: 12, scale: 2 }),

    /**
     * §11.4/§11.5 — one Directions result per booking, requested at assignment
     * with the pickup as a waypoint so both legs arrive in a single billable call.
     *
     * On the row rather than in Redis because three surfaces read it — the
     * `/customer` socket, `GET /v1/bookings/:id/tracking` and the public share
     * page — and a non-durable polyline means the polling client and the socketed
     * client draw different routes for the same trip. `route_source` is carried
     * for the same reason `RouteDistance.source` is: a straight-line fallback is
     * labelled, never passed off as a routed answer.
     */
    routePolyline: text('route_polyline'),
    routeDropPolyline: text('route_drop_polyline'),
    routeSource: text('route_source'),
    etaSeconds: integer('eta_seconds'),
    etaUpdatedAt: timestamp('eta_updated_at', { withTimezone: true }),

    cancelledBy: actorRoleEnum('cancelled_by'),
    cancellationReason: text('cancellation_reason'),
    cancellationFee: money('cancellation_fee').notNull().default('0'),
    /**
     * §3.5's driver compensation on a chargeable cancellation — a share of the
     * fee, at `charge_config.cancel_driver_comp_pct`.
     *
     * Its ledger leg is an `adjustment`, NEVER an earning type. A `fare_credit`
     * on a cancelled booking would make the earnings projector count
     * `gross = total` — the full fare of a trip that never happened — while
     * tripping no invariant, because `ledgerDrift` filters `status = 'paid'`
     * and `projectionDrift` compares the projection against the same wrong
     * query. See `LedgerService` and `ledgerKeys.cancellationCompensation`.
     */
    driverCompensation: money('driver_compensation').notNull().default('0'),
    unableReason: text('unable_reason'),

    /** Set by the capture path, alongside the `completed → paid` transition. */
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /**
     * StoragePort key of the rendered §14.2 invoice. Its presence is what makes
     * `InvoiceService.ensure` idempotent — a second call re-serves the same
     * bytes rather than rendering a second, subtly different document.
     */
    invoiceKey: text('invoice_key'),
    invoiceGeneratedAt: timestamp('invoice_generated_at', { withTimezone: true }),

    /**
     * The truck the job was actually done with, snapshotted at assign (Phase 17
     * writes it). Without it, reassigning a driver's truck silently rewrites
     * historical job attribution and every fleet earnings report —
     * `dashboard.service.ts` still carries its "honest proxy until bookings
     * carry a truck_id" comment.
     */
    truckId: uuid('truck_id').references(() => fleetTrucks.id),

    /**
     * Durable §6.4 wave state. In-memory search progress does not survive a
     * Fargate task recycling mid-search, and a booking whose wave is unknown
     * cannot be resumed — it can only be restarted from radius one.
     *
     * WRITTEN BY PHASE 17, AND RESUMPTION IS THE WHOLE POINT. §6.5's re-dispatch
     * after a driver cancels "resumes at the wave where it previously matched"
     * rather than restarting at 2 km — a customer whose driver dropped out four
     * minutes in must not be sent to the back of the queue for it.
     *
     * `dispatch_deadline_at` is set once, on the first wave, and is the real
     * terminator of a search: 5 rungs × 3 offers × 20 s is 300 s against a
     * ~180 s deadline, so the clock runs out before the ladder does.
     */
    searchWave: integer('search_wave'),
    dispatchDeadlineAt: timestamp('dispatch_deadline_at', { withTimezone: true }),

    /**
     * §9.1.5's "schedule for later". A scheduled booking is still created
     * immediately and still enters `searching` — §5.1 has no scheduled state —
     * but its dispatch job is enqueued with a matching delay, so Phase 17
     * cannot offer tomorrow's tow today.
     */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),

    /**
     * §9.1.5's "booking for someone else": whoever the driver will actually
     * meet, when that is not the account holder. Null means the customer.
     */
    contactName: text('contact_name'),
    contactMobile: text('contact_mobile'),

    /** §9.1.5's note editor — free text the driver sees on the job card. */
    note: text('note'),

    // Deliberately not a Drizzle FK: payments.booking_id already points back
    // here, and declaring both directions creates an unresolvable insert order.
    paymentId: uuid('payment_id'),
    paymentMethod: paymentMethodEnum('payment_method'),
    ...timestamps,
  },
  (t) => [
    index('idx_bookings_status').on(t.status),
    index('idx_bookings_user').on(t.userId),
    index('idx_bookings_driver').on(t.driverId),
    index('idx_bookings_fleet').on(t.fleetId),
    // Backs the console's keyset-paginated jobs feed: WHERE fleet_id = $1
    // ORDER BY created_at DESC, id DESC. Must match the cursor's sort exactly.
    index('idx_bookings_fleet_feed').on(t.fleetId, t.createdAt.desc(), t.id.desc()),
    // The customer's own keyset feed (`GET /v1/bookings`). `idx_bookings_user`
    // is user_id ALONE, so without this twin of the fleet feed every page of a
    // customer's trip history sorts. Same DESC NULLS LAST shape, for the same
    // sortless-plan reason.
    index('idx_bookings_user_feed').on(t.userId, t.createdAt.desc(), t.id.desc()),
    // Backs Phase 18's rolling 30-day `drivers.completion_rate` recompute, which
    // runs on the hot path of finishing a job. `idx_bookings_driver` is
    // `driver_id` alone, so without this the recompute walks and sorts a
    // driver's whole history. Partial on `driver_id IS NOT NULL` in migration
    // 0015 — drizzle-kit does not emit the WHERE clause.
    index('idx_bookings_driver_outcome').on(t.driverId, t.updatedAt.desc()),
  ],
);

export const bookingStatusHistory = pgTable(
  'booking_status_history',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    status: bookingStatusEnum('status').notNull(),
    actor: actorRoleEnum('actor').notNull().default('system'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_booking_status_history_booking').on(t.bookingId, t.createdAt)],
);

/**
 * Persisted breadcrumb samples for trip replay (§11.2).
 *
 * Written for the first time by Phase 16's ~30s location flush, whose INSERT
 * finds the driver's active booking with its own SELECT rather than caching one
 * — see `DriverPresenceRepo.sampleBookingPath`. `idx_bookings_driver_active`
 * (migration 0013) is what keeps that join off the driver's whole trip history.
 *
 * SAMPLES, NOT A TRACE. At the on-job cadence of 3s a full trace would be
 * ~1,200 rows per driver-hour for a replay nobody watches at that resolution;
 * the flush coalesces to one row per driver per window.
 */
export const bookingLocationPath = pgTable(
  'booking_location_path',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_booking_location_path_booking').on(t.bookingId, t.recordedAt)],
);

/**
 * Per-wave offer log powering the admin dispatch inspector (§9.4.6).
 *
 * APPEND-ONLY AUDIT, NOT STATE. Phase 17's engine keeps its durable wave
 * position on `bookings.search_wave` / `dispatch_deadline_at` and its live locks
 * in Redis; this table records what happened. Reconstructing "where is the
 * search now" by querying these rows would be a second source of truth that
 * disagrees the first time a row is written outside a transaction.
 *
 * It has TWO readers, both added in Phase 17: the §6.5 exclusion set (who has
 * already been offered this booking, so a re-dispatch does not ask them again)
 * and the rolling 30-day `drivers.acceptance_rate` recompute — which is 15 % of
 * the §6.2 score, so a wrong row here changes a driver's income.
 *
 * `outcome` is constrained by `ck_dispatch_attempts_outcome` to the values named
 * below; `idx_dispatch_attempts_driver` (0014) backs the acceptance-rate window.
 * Neither is emitted by drizzle-kit. Migration 0015 widened the CHECK with
 * `unable` — 0014 chose a CHECK over an enum expressly so it could be one
 * reversible line. An `unable` row exists so §6.5's re-dispatch excludes the
 * driver who just failed to deliver; it does not touch the acceptance rate,
 * whose denominator is `accepted + rejected + expired`.
 */
export const dispatchAttempts = pgTable(
  'dispatch_attempts',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    wave: integer('wave').notNull(),
    radiusKm: numeric('radius_km', { precision: 6, scale: 2 }).notNull(),
    driverId: uuid('driver_id').references(() => drivers.id),
    outcome: text('outcome').notNull(), // offered|accepted|rejected|expired|revoked|unable
    offeredAt: timestamp('offered_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [index('idx_dispatch_attempts_booking').on(t.bookingId, t.wave)],
);
