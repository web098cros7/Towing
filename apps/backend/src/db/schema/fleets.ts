import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { NotificationPrefs } from '@towing/api-contracts';
import { adminUsers } from './admin';
import { primaryId, timestamps } from './columns';
import { fleetOnboardingStepEnum, fleetStatusEnum } from './enums';
import { users } from './users';

/** Fleet businesses (§17 FLEETS). The tenant boundary for the whole fleet realm. */
export const fleets = pgTable(
  'fleets',
  {
    id: primaryId(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    businessName: text('business_name').notNull(),
    gstin: text('gstin'),
    address: text('address'),
    status: fleetStatusEnum('status').notNull().default('pending'),
    /**
     * §9.3.1 notification preferences. jsonb rather than four booleans or a
     * row-per-pref table: the list is product-driven and grows (Phase 13 adds
     * per-channel prefs), so adding one must not be a migration; it is never a
     * query predicate — it is always read as "all of them for this fleet", which
     * would make a normalised table EAV with a single consumer. The shape is
     * validated by `notificationPrefsSchema` on write and defaulted on read, so
     * an old client can never blank a new preference. `truck_imports.errors` is
     * the shipped precedent for a typed jsonb column.
     */
    notificationPrefs: jsonb('notification_prefs')
      .$type<Partial<NotificationPrefs>>()
      .notNull()
      .default({}),
    /** See `fleetOnboardingStepEnum` — a high-water mark, never the current view. */
    onboardingStep: fleetOnboardingStepEnum('onboarding_step').notNull().default('profile'),
    /**
     * §9.3.1's gate: "account usable only after business profile completes".
     * Derived from the profile fields but STORED, because the gate runs on every
     * money mutation (a stored timestamp plus a 60 s cache beats re-evaluating a
     * predicate) and because "when did this account become usable" is an honest
     * audit question. A CHECK constraint in migration 0006 stops it drifting
     * from the data it summarises.
     */
    profileCompletedAt: timestamp('profile_completed_at', { withTimezone: true }),
    /** W6 suspension metadata — same trio as users and drivers (migration 0024). */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedBy: uuid('suspended_by').references(() => adminUsers.id),
    suspensionReason: text('suspension_reason'),
    ...timestamps,
  },
  (t) => [index('idx_fleets_owner').on(t.ownerId), index('idx_fleets_status').on(t.status)],
);

/**
 * Per-driver revenue split within a fleet (§3.3: commission comes off the top,
 * then the remaining pool splits driver/fleet). Shares are percentages and are
 * expected to sum to 100 — enforced in the migration by a CHECK constraint.
 */
export const fleetDriverShares = pgTable(
  'fleet_driver_shares',
  {
    id: primaryId(),
    fleetId: uuid('fleet_id')
      .notNull()
      .references(() => fleets.id, { onDelete: 'cascade' }),
    // FK added in the migration to avoid a circular import with drivers.ts.
    driverId: uuid('driver_id').notNull(),
    driverShare: numeric('driver_share', { precision: 5, scale: 2 }).notNull(),
    fleetShare: numeric('fleet_share', { precision: 5, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [index('idx_fleet_driver_shares_fleet').on(t.fleetId)],
);
