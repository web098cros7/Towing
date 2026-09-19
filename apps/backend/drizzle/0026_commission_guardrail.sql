--
-- ===========================================================================
-- W11 — the commission guardrail becomes data, and operations can propose.
--
-- Decision G2 (§2.4/§4.2/§31): "a Super Admin may change the floor/cap". Until
-- now the 5–10 window was three hard-coded copies — the contract constants and
-- two CHECK constraints — so every change to it needed a release.
--
-- The shape of the fix matters more than the table:
--
--   • `commission_guardrail` is the CURRENT window (one row, seeded 5/10). It
--     is what `AdminConfigService.updateCommission` enforces and what
--     `GET /v1/admin/commission` serves so a form can render it.
--   • The two CHECKs are RELAXED to the ABSOLUTE bound decision G2 names
--     (`0 < pct <= 30`). A CHECK cannot read another table, so the database's
--     job is now "refuse the absurd", not "enforce the current policy" — the
--     service holds the window, and it is the service that a human changes
--     without a deploy.
--   • `commission_proposals` is §4.2's Operations ⚠️: Operations proposes, and
--     Super Admin/Finance applies through the SAME write path as a direct edit,
--     so a proposal can never become a rate that bypassed the guardrail.
--
-- Hand-written, like every migration from 0002 onward. Journal idx 26.
-- The literal values here are pinned to the exported contract unions by
-- `migration-0026.spec.ts` — the house rule wherever a CHECK duplicates a
-- TypeScript union.
--
-- Backfills: one guardrail row at the launch window (5/10). Existing
-- `commission_config` rows are already inside it, so the widened CHECKs accept
-- every stored value unchanged.
-- ===========================================================================
--

-- ---------------------------------------------------------------------------
-- 1 · commission_guardrail — the window itself, one row
-- ---------------------------------------------------------------------------

CREATE TABLE "commission_guardrail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"floor_pct" numeric(5, 2) NOT NULL,
	"cap_pct" numeric(5, 2) NOT NULL,
	"updated_by" uuid REFERENCES "admin_users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_guardrail_singleton_unique" UNIQUE("singleton")
);--> statement-breakpoint

-- UNIQUE(singleton) alone does not make this a singleton: a second row could be
-- inserted with singleton = false. The CHECK is the other half — the same pair
-- `charge_config` and `dispatch_config` carry.
ALTER TABLE "commission_guardrail" ADD CONSTRAINT "ck_commission_guardrail_singleton"
  CHECK ("singleton");--> statement-breakpoint

-- THE ABSOLUTE OUTER BOUND (decision G2): 0 < floor < cap <= 30. This is the
-- backstop that survives any bug in the service, and it is deliberately NOT the
-- 5–10 launch window — that lives in the row.
ALTER TABLE "commission_guardrail" ADD CONSTRAINT "ck_commission_guardrail_bounds"
  CHECK ("floor_pct" > 0 AND "cap_pct" <= 30 AND "floor_pct" < "cap_pct");--> statement-breakpoint

-- The launch window, so a fresh database behaves exactly as it did before this
-- migration existed.
INSERT INTO "commission_guardrail" ("floor_pct", "cap_pct") VALUES (5.00, 10.00);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2 · Relax the two CHECKs to the outer bound
-- ---------------------------------------------------------------------------

-- `commission_config.pct` — the live band percentages.
ALTER TABLE "commission_config" DROP CONSTRAINT "ck_commission_config_guardrail";--> statement-breakpoint
ALTER TABLE "commission_config" ADD CONSTRAINT "ck_commission_config_guardrail"
  CHECK ("pct" > 0 AND "pct" <= 30);--> statement-breakpoint

-- `bookings.commission_pct` — the percentage LOCKED onto a booking at confirm.
-- Relaxed in lockstep on purpose: if this column kept the old 5–10 bound, a
-- guardrail widened to 12 in the table would not fail at the admin's edit — it
-- would fail as an insert error on the first booking afterwards, which is the
-- exact unattributable failure 0011's comment warns about.
ALTER TABLE "bookings" DROP CONSTRAINT "ck_bookings_commission_pct_guardrail";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "ck_bookings_commission_pct_guardrail"
  CHECK ("commission_pct" IS NULL OR ("commission_pct" > 0 AND "commission_pct" <= 30));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3 · commission_proposals — §4.2's Operations ⚠️
-- ---------------------------------------------------------------------------

CREATE TABLE "commission_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band" "commission_band" NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"proposed_by" uuid NOT NULL REFERENCES "admin_users"("id"),
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid REFERENCES "admin_users"("id"),
	"decided_at" timestamp with time zone,
	"admin_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_commission_proposals_status" CHECK ("status" IN ('open', 'applied', 'declined')),
	CONSTRAINT "ck_commission_proposals_pct" CHECK ("pct" > 0 AND "pct" <= 30),
	CONSTRAINT "ck_commission_proposals_reason" CHECK (length("reason") >= 3)
);--> statement-breakpoint

-- ONE OPEN PROPOSAL PER BAND. Two open proposals for Band A would make
-- "apply" ambiguous about which decision the console is executing — the same
-- reasoning as the single-open-dispute index in 0025. Decided rows are exempt,
-- which is what makes the history readable.
CREATE UNIQUE INDEX "uq_commission_proposals_open"
  ON "commission_proposals" ("band")
  WHERE "status" = 'open';--> statement-breakpoint

CREATE INDEX "idx_commission_proposals_status_created"
  ON "commission_proposals" ("status", "created_at" DESC NULLS LAST);
