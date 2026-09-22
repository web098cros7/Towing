CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"push_token" text,
	"platform" text,
	"app_version" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_documents" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD COLUMN "issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "kyc_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "current_zone_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_devices_subject" ON "devices" USING btree ("subject_type","subject_id");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_current_zone_id_service_zones_id_fk" FOREIGN KEY ("current_zone_id") REFERENCES "public"."service_zones"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

--
-- ===========================================================================
-- Hand-written from here down: drizzle-kit emits no CHECK constraints (same
-- reason 0002/0004/0005/0007 carry theirs).
-- ===========================================================================
--

-- `devices.subject_id` is polymorphic and FK-free, paired with `subject_type` —
-- the same shape `login_challenges`/`social_identities` already use, since one
-- push token belongs to either a `drivers` row or a `users` row and no single
-- foreign key expresses that.
ALTER TABLE "devices" ADD CONSTRAINT "ck_devices_subject_type" CHECK ("subject_type" IN ('driver', 'customer'));