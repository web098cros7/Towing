import type { SubjectNotificationPrefs } from '@towing/api-contracts';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from '../geography';
import { primaryId, timestamps } from './columns';
import {
  docReviewStatusEnum,
  driverDocTypeEnum,
  driverLevelEnum,
  kycStatusEnum,
  vehicleClassEnum,
} from './enums';
import { adminUsers } from './admin';
import { fleets } from './fleets';
import { serviceZones } from './service-zones';
import { fleetTrucks } from './trucks';

/** Drivers (§17 DRIVERS). `fleet_id` is null for independent drivers. */
export const drivers = pgTable(
  'drivers',
  {
    id: primaryId(),
    mobile: text('mobile').notNull().unique(),
    name: text('name'),
    email: text('email'),
    photoUrl: text('photo_url'),
    fleetId: uuid('fleet_id').references(() => fleets.id, { onDelete: 'set null' }),
    /**
     * Which fleet truck this driver currently operates (§16.4 assign-truck).
     * One driver per truck — enforced by a partial unique index added in the
     * migration (drizzle-kit does not emit partial unique indexes).
     */
    assignedTruckId: uuid('assigned_truck_id').references(() => fleetTrucks.id, {
      onDelete: 'set null',
    }),

    /**
     * DEFAULT IS `incomplete`, NOT `pending` (changed in migration 0007).
     *
     * `pending` means "submitted and awaiting a human" and nothing else —
     * Phase 11's approval queue selects exactly that. With the old default,
     * every driver who had merely entered an OTP would land in the queue with
     * zero documents, and the "resume from incomplete" path would be
     * unreachable for anyone who self-signed-up.
     */
    kycStatus: kycStatusEnum('kyc_status').notNull().default('incomplete'),
    isOnline: boolean('is_online').notNull().default(false),
    vehicleClass: vehicleClassEnum('vehicle_class'),
    // §3.2 Band C opt-in — long hauls need a willing driver, not a pricier plan.
    longDistanceEnabled: boolean('long_distance_enabled').notNull().default(false),

    /**
     * Last known position, flushed from the ping pipeline every ~30s and on
     * go-online/offline (§11.2's "only samples and final positions are
     * persisted"). Redis holds the live fix; this is the authoritative copy that
     * survives a Redis flush and backs the §19.2 degraded candidate read.
     */
    currentLocation: geographyPoint('current_location'),
    lastPingAt: timestamp('last_ping_at', { withTimezone: true }),

    rating: numeric('rating', { precision: 2, scale: 1 }),
    totalTrips: integer('total_trips').notNull().default(0),
    acceptanceRate: numeric('acceptance_rate', { precision: 5, scale: 2 }),
    completionRate: numeric('completion_rate', { precision: 5, scale: 2 }),
    level: driverLevelEnum('level').notNull().default('bronze'),

    // An approver is an ADMIN. This referenced `users` — the customer table —
    // until migration 0007, which had never been exercised because nothing
    // wrote it; repointing it post-launch would be a data migration.
    approvedBy: uuid('approved_by').references(() => adminUsers.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    /**
     * Set when a driver completes `POST /v1/driver/kyc/submit` (Phase 11). Drives
     * the admin queue's "submitted date" column — `kyc_status` alone tells you
     * a driver is `pending` but not since when.
     */
    kycSubmittedAt: timestamp('kyc_submitted_at', { withTimezone: true }),
    /**
     * §6.1 partitions the presence hot set by zone. Written by
     * `POST /v1/driver/online` (Phase 16), which point-in-polygons the driver's
     * current fix against `service_zones` and refuses to bring them online if it
     * resolves to nothing — a driver in no zone is in no GEO set, i.e. online in
     * their own UI and invisible to every search.
     *
     * CLEARED ON GO-OFFLINE, unlike `current_location`. The zone is a claim
     * about availability and stops being true the moment the shift ends; the
     * position is a fact about the world that stays true and is what the §19.2
     * PostGIS fallback reads.
     */
    currentZoneId: uuid('current_zone_id').references(() => serviceZones.id, {
      onDelete: 'set null',
    }),
    /**
     * §12.3 per-driver channel opt-outs (Phase 13) — same shape and same
     * reasoning as `users.notification_prefs`. `weeklySummary` is the key that
     * matters here; Phase 19's summary job is its only reader.
     */
    notificationPrefs: jsonb('notification_prefs')
      .notNull()
      .default({})
      .$type<Partial<SubjectNotificationPrefs>>(),
    /**
     * A14's deferred suspension shelf. Set when an admin suspends a driver who
     * holds a live booking (`after_current_job`): dispatch eligibility and
     * go-online read these, and the suspension applies when the job completes.
     * All NULL means no suspension pending. Added by migration 0017; W6's
     * directory migration must not re-add them.
     */
    pendingSuspensionReason: text('pending_suspension_reason'),
    pendingSuspensionBy: uuid('pending_suspension_by').references(() => adminUsers.id),
    pendingSuspensionAt: timestamp('pending_suspension_at', { withTimezone: true }),
    /**
     * W6: who suspended this driver and why. The operational state itself stays
     * `kyc_status = 'suspended'` (the gate `KycApprovedGuard` and eligibility
     * already honour); the A14 shelf above stays the deferred-decision state.
     * These columns are the audit the directory detail renders.
     */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedBy: uuid('suspended_by').references(() => adminUsers.id),
    suspensionReason: text('suspension_reason'),
    ...timestamps,
  },
  (t) => [
    // GIST index is added in the migration — drizzle-kit does not emit USING GIST.
    //
    // So are the three PARTIAL indexes this table now carries, for the same
    // reason (drizzle-kit emits no WHERE clause either): `idx_drivers_geo`
    // (0002, unfiltered GIST), `idx_drivers_online_geo` (0013, the same column
    // filtered to online + approved, which is what §19.2's PostGIS fallback
    // actually queries) and `idx_drivers_zone` (0013). If you add a partial
    // index here, add it to a migration — nothing in this file will emit it.
    index('idx_drivers_status').on(t.kycStatus, t.isOnline),
    index('idx_drivers_fleet').on(t.fleetId),
  ],
);

export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    docType: driverDocTypeEnum('doc_type').notNull(),
    fileUrl: text('file_url').notNull(),
    status: docReviewStatusEnum('status').notNull().default('pending'),
    // Same repoint as `drivers.approved_by` — a verifier is an admin, not a customer.
    verifiedBy: uuid('verified_by').references(() => adminUsers.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /**
     * Per-document rejection reason (Phase 11) — distinct from the overall
     * `drivers.rejection_reason`, which was the only place a reason could live
     * while the only admin action was a driver-level decision.
     */
    rejectionReason: text('rejection_reason'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('idx_driver_documents_driver').on(t.driverId)],
);
