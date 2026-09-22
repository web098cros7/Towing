CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"policy_type" text NOT NULL,
	"policy_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_consent_records_subject" ON "consent_records" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_deletion_requests_subject" ON "deletion_requests" USING btree ("subject_type","subject_id");
--> statement-breakpoint

--
-- ===========================================================================
-- Hand-written from here down: drizzle-kit emits neither CHECK constraints nor
-- partial unique indexes (same reason 0002/0004/0005/0007/0008 carry theirs).
-- ===========================================================================
--

-- `subject_id` is polymorphic and FK-free, paired with `subject_type` — same
-- shape `devices`/`login_challenges`/`social_identities` already use, since one
-- consent record belongs to either a `users` row or a `drivers` row and no
-- single foreign key expresses that.
ALTER TABLE "consent_records" ADD CONSTRAINT "ck_consent_records_subject_type" CHECK ("subject_type" IN ('user', 'driver'));--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "ck_consent_records_policy_type" CHECK ("policy_type" IN ('privacy_policy', 'terms_of_service'));--> statement-breakpoint

ALTER TABLE "deletion_requests" ADD CONSTRAINT "ck_deletion_requests_subject_type" CHECK ("subject_type" IN ('user', 'driver'));--> statement-breakpoint

-- One open (`requested`) deletion request per subject — mirrors
-- `uq_payouts_one_open_per_owner`'s shape exactly. Without this, a subject
-- filing the request twice (a slow client retry, two tabs) would open two
-- rows for Phase 20's erasure worker to race on.
CREATE UNIQUE INDEX "uq_deletion_requests_one_open_per_subject" ON "deletion_requests" USING btree ("subject_type","subject_id") WHERE "status" = 'requested';