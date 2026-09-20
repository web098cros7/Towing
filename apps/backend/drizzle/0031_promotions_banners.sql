--
-- ===========================================================================
-- W16 — promotions: the banner manager §9.4.11 asks for.
--
-- One table. The coupon half of §9.4.11 needs no schema — `coupons` and
-- `coupon_redemptions` have carried every field the spec asks for since
-- migration 0016; what never existed was the admin surface over them, and
-- that is code, not SQL.
--
-- WHY NOT `app_config`: W12's banner is an OPS STATUS LINE (a SEV notice the
-- console previews). This is marketing content with an image, a CTA, an
-- audience and a schedule — a different lifecycle, a different editor.
--
-- Order is EXPLICIT (`sort_order`, drag-to-rank in the console); the window is
-- the schedule; `is_active` is the operator's off switch. The public read is
-- "live banners for one audience, in order", which the partial index below
-- covers — an inactive row is invisible to it by construction.
--
-- Hand-written, like every migration from 0002 onward. Journal idx 31.
-- ===========================================================================
--

CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"image_key" text NOT NULL,
	"cta_link" text,
	"cta_label" text,
	"audience" text NOT NULL DEFAULT 'customer',
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean NOT NULL DEFAULT true,
	"sort_order" integer NOT NULL DEFAULT 0,
	"created_by" uuid REFERENCES "admin_users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_banners_audience" CHECK ("audience" IN ('customer', 'driver')),
	CONSTRAINT "ck_banners_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at")
);--> statement-breakpoint

-- The public read, exactly: WHERE is_active AND audience = $1 ORDER BY
-- sort_order. Partial so the index stays the size of the carousel rather than
-- the size of every banner ever created.
CREATE INDEX "idx_banners_live" ON "banners" ("audience", "sort_order") WHERE "is_active";--> statement-breakpoint
