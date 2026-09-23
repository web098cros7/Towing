--
-- ADM-6: a partial refund's cause decides who pays (Ehsan, 23 Sep).
--
-- Until now the admin picked ONE party per partial refund (driver, fleet or
-- platform), and that party bore all of it. Ehsan's call, after comparing how
-- Uber, Ola and Rapido do it: the admin states WHY the refund is being given,
-- and the cause decides.
--
--   fare_error         -> shared   (both sides give back their share, like a
--                                    fare recalculation)
--   platform_error     -> platform
--   goodwill           -> platform (never the driver's cost)
--   driver_misconduct  -> provider (capped at what the trip paid them)
--
-- An admin may override who pays, with a written reason.
--
-- The two old values stay legal on both tables. Refunds and disputes already
-- resolved carry them and are history; nothing rewrites them, and nothing new
-- writes them.
--
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "ck_refunds_liability";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "ck_refunds_liability" CHECK ("liability" IS NULL OR "liability" IN ('shared', 'platform', 'provider', 'driver', 'fleet'));--> statement-breakpoint
ALTER TABLE "disputes" DROP CONSTRAINT IF EXISTS "ck_disputes_liability";--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "ck_disputes_liability" CHECK ("liability" IN ('shared', 'platform', 'provider', 'driver', 'fleet'));--> statement-breakpoint

-- Why the refund was given. Null on full refunds and on partials issued
-- before this migration.
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "cause" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "ck_refunds_cause" CHECK ("cause" IS NULL OR "cause" IN ('fare_error', 'platform_error', 'goodwill', 'driver_misconduct'));--> statement-breakpoint

-- Where the money went. `wallet` sends the whole refund to the customer's
-- MiTow wallet; `gateway_amount` / `wallet_amount` keep recording which POOL
-- it was spent from, so the remaining refundable balance stays exact.
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "delivery" text NOT NULL DEFAULT 'original';--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "ck_refunds_delivery" CHECK ("delivery" IN ('original', 'wallet'));--> statement-breakpoint

-- The driver side's part of a partial refund, fixed at issue time so a
-- resumed refund claws back exactly what was decided.
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "provider_share" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "ck_refunds_provider_share" CHECK ("provider_share" IS NULL OR ("provider_share" >= 0 AND "provider_share" <= "amount"));--> statement-breakpoint

ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "bearer_override_reason" text;
