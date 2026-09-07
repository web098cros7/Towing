--
-- ===========================================================================
-- Phase 19 — money: capture, ledger credit, earnings, payouts, ratings.
--
-- Until this migration a booking could reach `completed` and stop there
-- forever. `LEGAL_TRANSITIONS.completed` has listed `paid` since Phase 15, but
-- nothing in `src/` has ever performed that edge; `payments` has had exactly
-- one writer and it is the seed; `refunds` has had none at all. This is the
-- schema that lets money actually move.
--
-- Seven groups of change:
--
--   1. GST-ready tax, rate DEFAULTING TO ZERO. Every column here is
--      behaviour-neutral until an admin sets a rate — the whole point.
--   2. `charge_config` gains the §3.5 cancellation knobs and the payout
--      approval threshold, because it is already the singleton money-policy
--      row AND already has an admin surface under `@Roles('finance')`.
--   3. `bookings` gains coupon, invoice, paid-instant and driver-compensation
--      columns, and both money CHECKs are re-stated to include them.
--   4. `payments` and `refunds` get the columns a real capture and a real
--      reversal need — including the idempotency keys that were nullable
--      (`payments`) or absent (`refunds`).
--   5. Payout approval as a SEPARATE COLUMN, not a new `payout_status` value.
--   6. `ratings` — the last unwritten input to the §6.2 dispatch scorer.
--   7. `coupons` + `coupon_redemptions`.
--
-- Hand-written, like every migration from 0002 onward: drizzle-kit emits
-- neither partial indexes, nor CHECK constraints, nor DESC index ordering.
--
-- THE ACCEPTANCE TEST FOR THIS FILE is that the suite is byte-identical green
-- after it lands and before a single line of application code changes. Every
-- new column carries a NOT NULL DEFAULT chosen so that nothing computes
-- differently. If anything goes red here, the defaults are wrong.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · GST-ready tax
-- ---------------------------------------------------------------------------

-- THE SPEC COLLECTS `gstin` AND NEVER USES IT. There is no tax line in §7's
-- fare formula, no tax column, no GST on commission, no TDS/TCS on payouts —
-- and for an Indian marketplace the platform's commission is a service fee
-- that normally attracts it. Rather than invent a tax model (which needs an
-- accountant, not an engineer) or ship nothing (which makes this a migration
-- against live money rows later), the schema is made GST-ready and the RATE
-- DEFAULTS TO ZERO. Turning it on becomes a config change plus a number from
-- a tax professional.
--
-- `tax_pct` is SNAPSHOTTED ON THE BOOKING at confirm, exactly like
-- `commission_pct` and `waiting_per_minute`. §3.4 locks the fare; without the
-- snapshot, `complete`'s waiting re-derivation could not recompute the tax
-- without reading the live rate, which is precisely the mid-trip re-pricing
-- §3.4 forbids.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "tax_pct"    numeric(5,2)  NOT NULL DEFAULT 0.00;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(12,2) NOT NULL DEFAULT 0.00;
--> statement-breakpoint

-- 28 is the highest GST slab in India. A rate above it is a data-entry error,
-- not a policy.
ALTER TABLE "bookings"
  ADD CONSTRAINT "ck_bookings_tax_pct_range" CHECK ("tax_pct" >= 0 AND "tax_pct" <= 28);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · `charge_config` — the money-policy knobs
-- ---------------------------------------------------------------------------

-- WHY HERE AND NOT A NEW TABLE: `charge_config` is already the singleton
-- money-policy row, its own docstring already argues why typed columns beat a
-- key/value table ("every knob here has a different unit"), and — decisively —
-- `AdminConfigService.getPricing`/`updatePricing` already read and write this
-- exact row under `@Roles('super_admin','finance')` with change history. Every
-- knob below therefore gets an audited admin surface for free.

ALTER TABLE "charge_config" ADD COLUMN IF NOT EXISTS "tax_pct"   numeric(5,2) NOT NULL DEFAULT 0.00;
--> statement-breakpoint
ALTER TABLE "charge_config" ADD COLUMN IF NOT EXISTS "tax_label" text         NOT NULL DEFAULT 'GST';
--> statement-breakpoint

-- §3.5's cancellation ladder. These three have been TypeScript `export const`s
-- in `cancellation-policy.ts` since Phase 15, whose own comment says "admin-
-- configurable knobs for these are Phase 19's". This is that.
ALTER TABLE "charge_config" ADD COLUMN IF NOT EXISTS "cancel_free_minutes"    integer       NOT NULL DEFAULT 2;
--> statement-breakpoint
ALTER TABLE "charge_config" ADD COLUMN IF NOT EXISTS "cancel_partial_minutes" integer       NOT NULL DEFAULT 10;
--> statement-breakpoint
ALTER TABLE "charge_config" ADD COLUMN IF NOT EXISTS "cancel_partial_fee"     numeric(12,2) NOT NULL DEFAULT 150.00;
--> statement-breakpoint

-- 50, NOT ZERO — and the asymmetry with `tax_pct` above is deliberate.
--
-- `tax_pct` defaults to 0 because behaviour must be byte-identical to today.
-- There is no such "today" for driver compensation: every chargeable tier is
-- currently REFUSED outright by `bookings.service.ts` with 409
-- `cancellation_not_free`, so this phase is the first time the branch is
-- reachable at all. §3.5's table states the driver IS compensated when a
-- customer cancels on them, and shipping a 0 % default would quietly stiff the
-- driver on the very first real chargeable cancellation.
ALTER TABLE "charge_config" ADD COLUMN IF NOT EXISTS "cancel_driver_comp_pct" numeric(5,2)  NOT NULL DEFAULT 50.00;
--> statement-breakpoint

-- §14.4's "Admin Finance approves where required" never says WHICH payouts
-- require approval. This is the answer: below the threshold auto-approves,
-- above it queues. ₹1,000.00 at launch. Fleet payouts — which have bypassed
-- approval entirely since Phase 7 — join the same rule.
ALTER TABLE "charge_config" ADD COLUMN IF NOT EXISTS "payout_auto_approve_max" numeric(12,2) NOT NULL DEFAULT 100000.00;
--> statement-breakpoint

ALTER TABLE "charge_config"
  ADD CONSTRAINT "ck_charge_config_tax_pct" CHECK ("tax_pct" >= 0 AND "tax_pct" <= 28);
--> statement-breakpoint
ALTER TABLE "charge_config"
  ADD CONSTRAINT "ck_charge_config_cancel_windows"
  CHECK ("cancel_free_minutes" >= 0 AND "cancel_partial_minutes" >= "cancel_free_minutes");
--> statement-breakpoint
ALTER TABLE "charge_config"
  ADD CONSTRAINT "ck_charge_config_cancel_amounts"
  CHECK ("cancel_partial_fee" >= 0
     AND "cancel_driver_comp_pct" >= 0 AND "cancel_driver_comp_pct" <= 100);
--> statement-breakpoint
ALTER TABLE "charge_config"
  ADD CONSTRAINT "ck_charge_config_payout_threshold" CHECK ("payout_auto_approve_max" >= 0);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · `coupons` and `coupon_redemptions`
--
-- Created BEFORE the `bookings` alters below, because `bookings.coupon_id`
-- carries an FK to it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "coupons" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"              text NOT NULL,
  "kind"              text NOT NULL,
  "value"             numeric(12,2) NOT NULL,
  "max_discount"      numeric(12,2),
  "min_order"         numeric(12,2) NOT NULL DEFAULT 0,
  "max_uses"          integer,
  "max_uses_per_user" integer NOT NULL DEFAULT 1,
  "used_count"        integer NOT NULL DEFAULT 0,
  "starts_at"         timestamp with time zone,
  "expires_at"        timestamp with time zone,
  "is_active"         boolean NOT NULL DEFAULT true,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"        timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "coupons" ADD CONSTRAINT "ck_coupons_kind"  CHECK ("kind" IN ('percent', 'flat'));
--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "ck_coupons_value" CHECK ("value" > 0);
--> statement-breakpoint
ALTER TABLE "coupons"
  ADD CONSTRAINT "ck_coupons_percent_ceiling" CHECK ("kind" <> 'percent' OR "value" <= 100);
--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "ck_coupons_used_count" CHECK ("used_count" >= 0);
--> statement-breakpoint
ALTER TABLE "coupons"
  ADD CONSTRAINT "ck_coupons_window"
  CHECK ("starts_at" IS NULL OR "expires_at" IS NULL OR "expires_at" > "starts_at");
--> statement-breakpoint

-- CASE-INSENSITIVE. Customers type `SAVE20`, `save20` and `Save20`, and a
-- coupon that works in one casing and not another is a support ticket.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_coupons_code" ON "coupons" (upper("code"));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "coupon_id"       uuid NOT NULL REFERENCES "coupons"("id"),
  "user_id"         uuid NOT NULL REFERENCES "users"("id"),
  "booking_id"      uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "discount_amount" numeric(12,2) NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "ck_coupon_redemptions_amount" CHECK ("discount_amount" > 0);
--> statement-breakpoint

-- One redemption per booking. `coupons.used_count` is a denormalised counter
-- over this table and `couponDrift` polices the two against each other.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_coupon_redemptions_booking"
  ON "coupon_redemptions" ("booking_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coupon_redemptions_user"
  ON "coupon_redemptions" ("coupon_id", "user_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4 · `bookings` — coupon, invoice, paid instant, driver compensation
-- ---------------------------------------------------------------------------

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "coupon_id"   uuid REFERENCES "coupons"("id");
--> statement-breakpoint
-- The code is denormalised alongside the id so an invoice rendered a year
-- later still shows what the customer typed, even if the coupon row is edited.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "coupon_code" text;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "invoice_key" text;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "invoice_generated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "driver_compensation" numeric(12,2) NOT NULL DEFAULT 0.00;
--> statement-breakpoint

-- NO `rated` BOOLEAN. `uq_ratings_booking_direction` below already owns the
-- fact "has this booking been rated, and in which direction", and a
-- denormalised flag would be a second source of truth for it that can drift.
-- The read is on a detail screen, not a hot path — one LEFT JOIN LATERAL.

-- Both money CHECKs re-stated. `ck_bookings_non_negative` simply grows two
-- columns.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "ck_bookings_non_negative";
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "ck_bookings_non_negative"
  CHECK ("total" >= 0 AND "commission_amount" >= 0 AND "driver_payout" >= 0
     AND "discount" >= 0 AND "tax_amount" >= 0
     AND "cancellation_fee" >= 0 AND "driver_compensation" >= 0);
--> statement-breakpoint

-- GST-AWARE, AND THIS ONE IS NOT COSMETIC.
--
-- The old form `commission_amount + driver_payout <= total` stays TRUE once
-- tax exists — but it stops being TIGHT. With an 18 % rate the slack is
-- exactly the tax, so the constraint would no longer catch a settlement that
-- credited the driver a share of the government's money. That is the single
-- most likely arithmetic mistake in this phase (calling
-- `creditBookingSettlement` with `total` instead of the pre-tax taxable
-- amount), and this is the constraint that turns it into a loud failure on the
-- capture path rather than a quiet one in the nightly reconcile.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "ck_bookings_payout_within_total";
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "ck_bookings_payout_within_total"
  CHECK ("commission_amount" + "driver_payout" + "tax_amount" <= "total");
--> statement-breakpoint

-- The driver's own earnings feed keysets on (created_at DESC, id DESC), the
-- exact twin of `idx_bookings_fleet_feed` and added for the same reason.
-- `idx_bookings_driver` is `driver_id` alone and `idx_bookings_driver_outcome`
-- (Phase 18) sorts on `updated_at`, so neither serves this page.
--
-- DESC NULLS LAST on BOTH columns, matching the ORDER BY exactly — a bare DESC
-- makes Postgres re-sort every page. Fourth time this comment has been needed.
CREATE INDEX IF NOT EXISTS "idx_bookings_driver_feed"
  ON "bookings" ("driver_id", "created_at" DESC NULLS LAST, "id" DESC NULLS LAST)
  WHERE "driver_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5 · `payments` — widening, and a structural double-capture backstop
-- ---------------------------------------------------------------------------

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "captured_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "failure_reason" text;
--> statement-breakpoint
-- Which adapter created it — `dev` or `razorpay`. Same column, same purpose as
-- `payouts.provider`.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider" text;
--> statement-breakpoint
-- Razorpay's `order_…`. `gateway_ref` holds the `pay_…`; they are different
-- objects with different lifetimes and a webhook can arrive keyed on either.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "gateway_order_ref" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "purpose" text NOT NULL DEFAULT 'booking';
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(12,2) NOT NULL DEFAULT 0.00;
--> statement-breakpoint

ALTER TABLE "payments"
  ADD CONSTRAINT "ck_payments_purpose" CHECK ("purpose" IN ('booking', 'cancellation_fee'));
--> statement-breakpoint

-- §19.4's "one payment row per booking per key", made STRUCTURAL rather than
-- merely conventional.
--
-- The Redis idempotency interceptor is the fast path and `idempotency_key` is
-- the next line of defence, but both can be defeated: Redis down, the client
-- key lost, a webhook arriving before any intent row exists. This index is the
-- one that cannot be. Two captures for one booking cannot both land, whatever
-- happens above it.
--
-- Scoped to `purpose = 'booking'` so a §3.5 cancellation fee — a genuinely
-- separate collection against the same booking — can coexist with the fare.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_one_captured_per_booking"
  ON "payments" ("booking_id")
  WHERE "status" = 'captured' AND "purpose" = 'booking';
--> statement-breakpoint

-- The vendor's ids are globally unique and are what a webhook keys on.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_gateway_ref"
  ON "payments" ("gateway_ref") WHERE "gateway_ref" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_order_ref"
  ON "payments" ("gateway_order_ref") WHERE "gateway_order_ref" IS NOT NULL;
--> statement-breakpoint

-- The §19.3 sweep's driving index: oldest non-terminal payment first.
CREATE INDEX IF NOT EXISTS "idx_payments_sweep"
  ON "payments" ("updated_at") WHERE "status" IN ('pending', 'authorized');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6 · `refunds` — the idempotency key its own docstring asked for
-- ---------------------------------------------------------------------------

-- `db/schema/money.ts` says of this table: "adding a nullable column plus a
-- unique index now would mean inventing a key grammar for a writer that does
-- not exist, then altering it later. Whichever phase ships refunds adds it."
-- This is that phase, and the grammar is `rf:v1:<bookingId>:<reason>` — see
-- `db/ledger/idempotency-keys.ts`.
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "processed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "failure_reason" text;
--> statement-breakpoint
-- `system` (the cancellation path) or an admin id (a dispute reversal).
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "initiated_by" text NOT NULL DEFAULT 'system';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7 · Payout approval — a SEPARATE COLUMN, not a new `payout_status` value
-- ---------------------------------------------------------------------------

-- `payout_status` is the §5.5 VENDOR lifecycle (requested → processing →
-- paid|failed). Approval is an internal gate that decides whether the vendor
-- is ever called, so it does not belong on that axis. Three consequences make
-- the separate column not just cleaner but strictly better:
--
--   * `uq_payouts_one_open_per_owner` is partial on
--     `status IN ('requested','processing')`. A payout awaiting approval MUST
--     be covered by it, or an owner queues five while Finance sleeps. With a
--     separate column such a payout is still `status = 'requested'` and is
--     therefore ALREADY INSIDE the predicate — the index needs no change at
--     all. A new enum value would mean altering a partial unique index on
--     money for zero gain.
--   * `PayoutReconcileService` would otherwise start asking Razorpay about
--     payouts that have never been sent.
--   * `transitionToTerminal`'s guard, `staleNonTerminal`'s filter, the
--     contract's `payoutStatusSchema` and the console's status chips would all
--     have to learn a value with no vendor meaning.
--
-- The wallet is debited at REQUEST time regardless — that is what stops an
-- owner double-spending while Finance deliberates.
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "approval_state" text NOT NULL DEFAULT 'auto_approved';
--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "approved_by" uuid REFERENCES "admin_users"("id");
--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint

ALTER TABLE "payouts"
  ADD CONSTRAINT "ck_payouts_approval_state"
  CHECK ("approval_state" IN ('auto_approved', 'pending_approval', 'approved', 'rejected'));
--> statement-breakpoint

-- §9.4.10's approval queue, oldest first. Partial, because the queue is a
-- handful of rows in a table that grows forever.
CREATE INDEX IF NOT EXISTS "idx_payouts_approval_queue"
  ON "payouts" ("requested_at") WHERE "approval_state" = 'pending_approval';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8 · `ratings`
-- ---------------------------------------------------------------------------

-- §6.2 gives rating 15 % of the dispatch score and `drivers.rating` has been
-- read by the scorer since Phase 17 while nothing ever wrote it. This table is
-- that writer — the LAST of the four scorer inputs to get one (Phase 18 gave
-- `completion_rate` and `total_trips` theirs).
--
-- `driver_id` and `user_id` are DENORMALISED FROM THE BOOKING DELIBERATELY.
-- Phase 20 ships admin reassignment; a rollup that re-joined `bookings` would
-- silently move a rating to whoever holds the booking today. §17's shape
-- (`booking_id, driver_id, rating, review`) is preserved — `direction` and
-- `user_id` are what make it two-way.
CREATE TABLE IF NOT EXISTS "ratings" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "driver_id"  uuid NOT NULL REFERENCES "drivers"("id")  ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "users"("id")    ON DELETE CASCADE,
  "direction"  text NOT NULL,
  "rating"     integer NOT NULL,
  "review"     text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "ratings" ADD CONSTRAINT "ck_ratings_value" CHECK ("rating" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "ratings"
  ADD CONSTRAINT "ck_ratings_direction"
  CHECK ("direction" IN ('customer_to_driver', 'driver_to_customer'));
--> statement-breakpoint

-- The two-way shape AND the idempotency backstop in one index: one rating per
-- booking per direction. A double-tapped star is an UPSERT, never a second
-- row — which is also why the rate endpoints take no `Idempotency-Key`.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ratings_booking_direction"
  ON "ratings" ("booking_id", "direction");
--> statement-breakpoint

-- Backs the `drivers.rating` rollup, which averages the customer's half only.
CREATE INDEX IF NOT EXISTS "idx_ratings_driver"
  ON "ratings" ("driver_id", "created_at" DESC NULLS LAST)
  WHERE "direction" = 'customer_to_driver';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9 · Wallet transaction feed index
-- ---------------------------------------------------------------------------

-- The driver's and customer's wallet history: WHERE wallet_id = $1 ORDER BY
-- created_at DESC, id DESC. `idx_wallet_transactions_wallet` is
-- (wallet_id, created_at) ASC — servable backwards, but not once the `id`
-- tiebreaker a keyset cursor needs is in the ORDER BY.
CREATE INDEX IF NOT EXISTS "idx_wallet_transactions_wallet_feed"
  ON "wallet_transactions" ("wallet_id", "created_at" DESC NULLS LAST, "id" DESC NULLS LAST);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10 · A reserved ledger type
-- ---------------------------------------------------------------------------

-- `tax_debit` IS RESERVED AND MUST NEVER BE WRITTEN — exactly like
-- `commission_debit`, and for the identical reason: GST is remitted to a
-- government that has no wallet, so the tax has no counterparty leg. It lives
-- as `bookings.tax_amount` and as a line on the invoice.
--
-- Writing an actual tax leg would need a fourth `wallet_owner_type`, would
-- break `ledgerDrift` (whose type list is credit-only), and would mean
-- crediting gross then debiting — the precise shape `walletTxnTypeEnum`'s own
-- docstring already rejects for commission. The value exists so that the
-- decision is documented in the schema rather than rediscovered.
--
-- Safe inside drizzle's single-transaction-per-file, by 0007's rule: a label
-- added by ALTER TYPE cannot be USED in the same transaction, and nothing
-- below (or anywhere) inserts, defaults to, or compares against 'tax_debit'.
-- Never writing it is the whole point.
ALTER TYPE "public"."wallet_txn_type" ADD VALUE IF NOT EXISTS 'tax_debit';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 11 · Backfills — last, per the house order
-- ---------------------------------------------------------------------------

-- `payments.idempotency_key` has been NULLABLE under a GLOBAL unique index
-- since 0001, and Postgres treats NULLs as distinct — so a keyless payment has
-- been exempt from the dedup §14.1 requires. That is exactly the hole 0006
-- closed on `wallet_transactions`, with exactly this backfill-then-NOT-NULL
-- pattern. Only the seed has ever written this table, so the UPDATE touches
-- seeded rows or nothing.
UPDATE "payments" SET "idempotency_key" = 'legacy:v1:pay:' || "id"::text
  WHERE "idempotency_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "idempotency_key" SET NOT NULL;
--> statement-breakpoint

-- `refunds` has zero rows anywhere — not even the seed writes it. The UPDATE
-- is here so the SET NOT NULL is unconditional rather than dependent on that
-- staying true.
UPDATE "refunds" SET "idempotency_key" = 'legacy:v1:rf:' || "id"::text
  WHERE "idempotency_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "idempotency_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_refunds_idempotency_key" ON "refunds" ("idempotency_key");
