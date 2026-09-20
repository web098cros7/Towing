--
-- W20: manual quotes (§7.3 "600 km+ — Custom quote (manual at launch)").
--
-- The estimate path has refused >600 km jobs since the pricing engine existed
-- (`CustomQuoteRequiredError`, surfaced as `manual_quote_required`). Until this
-- migration that refusal had no counterpart: the customer was told "contact
-- support" and the request evaporated. This table is the counterpart — the
-- request, the operator's price, and the booking that price became.
--
-- WHY A TABLE AND NOT A COLUMN ON `bookings`: a quote exists BEFORE there is a
-- booking (that is the point), can be rejected or lapse without one, and
-- carries the operator's own numbers (`quoted_by`, `quoted_at`, `valid_until`).
-- Folding it into `bookings` would mean a quote row that is also a booking row
-- that is not a trip.
--
-- MONEY IS PAISE here, unlike the domain tables' NUMERIC rupees: nothing else
-- reads these columns, the API's money vocabulary is paise everywhere, and the
-- one conversion happens at booking creation (`paiseToRupeeString`), where
-- every other booking amount already crosses.
--

CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"service_slug" text NOT NULL,
	"vehicle_class" text NOT NULL,
	"pickup_lat" double precision NOT NULL,
	"pickup_lng" double precision NOT NULL,
	"pickup_address" text,
	"drop_lat" double precision,
	"drop_lng" double precision,
	"drop_address" text,
	"distance_km" numeric(8, 2) NOT NULL,
	"notes" text,
	"total_paise" bigint,
	"breakdown" jsonb,
	"commission_pct" numeric(5, 2),
	"commission_paise" bigint,
	"driver_payout_paise" bigint,
	"quoted_by" uuid,
	"quoted_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"rejection_reason" text,
	"decided_at" timestamp with time zone,
	"booking_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_quoted_by_admin_users_id_fk" FOREIGN KEY ("quoted_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quotes_user" ON "quotes" USING btree ("user_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_quotes_status" ON "quotes" USING btree ("status","requested_at");

--
-- ===========================================================================
-- Hand-written from here down (drizzle-kit emits no CHECK constraints).
-- ===========================================================================
--

-- The workflow vocabulary, pinned against `QUOTE_STATUSES` by
-- `migration-0034.spec.ts`. `expired` is a real state rather than a computed
-- answer because an operator needs to see that an offer lapsed without being
-- told; `accepted` is terminal.
ALTER TABLE "quotes" ADD CONSTRAINT "ck_quotes_status" CHECK ("status" IN ('requested', 'quoted', 'accepted', 'rejected', 'expired'));--> statement-breakpoint

-- A quoted row without its numbers is not quotable, and a requested row with
-- them would let a bug price a job nobody reviewed. `rejected`/`expired` are
-- exempt because a request can be turned down — or left to lapse — before
-- anyone ever quoted it, and demanding amounts there would be demanding a
-- price for a job that was never priced.
ALTER TABLE "quotes" ADD CONSTRAINT "ck_quotes_amounts" CHECK (
  ("status" IN ('requested', 'rejected', 'expired'))
  OR ("total_paise" IS NOT NULL AND "commission_pct" IS NOT NULL)
);
