--
-- Customer app live — the schema the customer app's remaining screens
-- need. Small additions, one per screen group:
--
--   * `coupons.is_public` — Figma 28's "Available offers" list. Private codes
--     still validate when typed; only the listing is gated.
--   * `users.language` / `users.appearance` — Figma 54/55's Language and Appearance.
--     NULL means "follow the device", which is why both are nullable.
--   * `app_config` support + referral reward columns — the support contact the app shows
--     (Figma 58/60) and Refer & Earn's amounts (Figma 45), both operator-tunable.
--   * `referral_codes` / `referral_redemptions` — one code per user, one
--     redemption per referee, ever.
--   * `booking_messages` — Figma 24's driver↔customer chat, scoped to a trip.
--
-- The last statement adds a `wallet_txn_type` label. It is safe in the same
-- file because nothing here uses the new label — see 0016's note on why
-- `ALTER TYPE ... ADD VALUE` cannot be followed by a use in the same
-- transaction.
--

ALTER TABLE "coupons" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "appearance" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_language" CHECK ("language" IS NULL OR "language" IN ('en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr', 'bn'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_appearance" CHECK ("appearance" IS NULL OR "appearance" IN ('light', 'dark', 'system'));--> statement-breakpoint

ALTER TABLE "app_config" ADD COLUMN "support_phone" text DEFAULT '+911800123456' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "support_email" text DEFAULT 'support@mitow.in' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "referrer_reward_paise" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "referee_reward_paise" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "ck_app_config_referrer_reward_paise" CHECK ("referrer_reward_paise" >= 0);--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "ck_app_config_referee_reward_paise" CHECK ("referee_reward_paise" >= 0);--> statement-breakpoint

-- Figma 18/20's vehicle card: the truck's make and model. Nullable: fleets fill them in.
ALTER TABLE "fleet_trucks" ADD COLUMN "make" text;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "model" text;--> statement-breakpoint

CREATE TABLE "referral_codes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_referral_codes_code" ON "referral_codes" USING btree (upper("code"));--> statement-breakpoint

CREATE TABLE "referral_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referee_user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rewarded_booking_id" uuid,
	"rewarded_at" timestamp with time zone,
	"referrer_reward_paise" integer,
	"referee_reward_paise" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_referee_user_id_users_id_fk" FOREIGN KEY ("referee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_rewarded_booking_id_bookings_id_fk" FOREIGN KEY ("rewarded_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_referral_redemptions_referee" ON "referral_redemptions" USING btree ("referee_user_id");--> statement-breakpoint
CREATE INDEX "idx_referral_redemptions_referrer" ON "referral_redemptions" USING btree ("referrer_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "ck_referral_redemptions_status" CHECK ("status" IN ('pending', 'rewarded'));--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "ck_referral_redemptions_not_self" CHECK ("referrer_user_id" <> "referee_user_id");--> statement-breakpoint

CREATE TABLE "booking_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "booking_messages" ADD CONSTRAINT "booking_messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_booking_messages_booking" ON "booking_messages" USING btree ("booking_id","created_at");--> statement-breakpoint
ALTER TABLE "booking_messages" ADD CONSTRAINT "ck_booking_messages_sender_type" CHECK ("sender_type" IN ('customer', 'driver'));--> statement-breakpoint
ALTER TABLE "booking_messages" ADD CONSTRAINT "ck_booking_messages_body" CHECK (char_length("body") BETWEEN 1 AND 1000);--> statement-breakpoint

-- Wallet spend at payment (Figma 27 bill, 44 Wallet). The wallet part of a
-- booking payment is recorded on the payment row; `amount` stays the part the
-- gateway collects, so refunds (capped at `amount`) never touch wallet money.
ALTER TABLE "payments" ADD COLUMN "wallet_applied" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_wallet_applied" CHECK ("wallet_applied" >= 0);--> statement-breakpoint
-- A wallet-only payment has no gateway part, so `amount` may now be 0 — but a
-- payment must still move SOME money.
ALTER TABLE "payments" DROP CONSTRAINT "ck_payments_amount_positive";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_amount_positive" CHECK ("amount" >= 0 AND "amount" + "wallet_applied" > 0);--> statement-breakpoint

-- Refund split: a booking is paid partly through the gateway and partly from the
-- customer's wallet (and a cash trip entirely outside the gateway), so a refund
-- returns each part to where it came from. `amount` stays the total refunded;
-- `payments.refunded_amount` now sums only the gateway part.
ALTER TABLE "refunds" ADD COLUMN "gateway_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "wallet_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "refunds" SET "gateway_amount" = "amount";--> statement-breakpoint
-- A refund written without a split (older code paths, fixtures) is what every
-- refund meant before this migration: all of it back through the gateway.
CREATE OR REPLACE FUNCTION refunds_default_split() RETURNS trigger AS $$
BEGIN
  IF NEW.gateway_amount = 0 AND NEW.wallet_amount = 0 THEN
    NEW.gateway_amount := NEW.amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_refunds_default_split BEFORE INSERT ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION refunds_default_split();--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "ck_refunds_split" CHECK ("gateway_amount" >= 0 AND "wallet_amount" >= 0 AND "gateway_amount" + "wallet_amount" = "amount");--> statement-breakpoint

-- A cash trip debits the driver the full fare they collected; their share is
-- still credited by the normal settlement legs, so the wallet nets to minus
-- (commission + tax) — what the driver owes. Safe in the same file because
-- nothing in this file uses the new label (see 0016's note).
ALTER TYPE "public"."wallet_txn_type" ADD VALUE IF NOT EXISTS 'cash_collected_debit';--> statement-breakpoint
-- The customer's wallet balance spent on a booking at payment.
ALTER TYPE "public"."wallet_txn_type" ADD VALUE IF NOT EXISTS 'wallet_spend_debit';--> statement-breakpoint
-- Figma 09's Car Lockout: a flat roadside service (catalogue row comes from the seed).
ALTER TYPE "public"."service_type" ADD VALUE IF NOT EXISTS 'lockout';
