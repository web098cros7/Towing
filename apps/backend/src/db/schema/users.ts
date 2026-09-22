import type { SubjectNotificationPrefs, VehicleCategory } from '@towing/api-contracts';
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin';
import { primaryId, timestamps } from './columns';
import { accountStatusEnum } from './enums';

/** Customers (§17 CUSTOMERS). Present in Phase 3 because bookings FK to it. */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    mobile: text('mobile').notNull().unique(),
    name: text('name'),
    email: text('email'),
    photoUrl: text('photo_url'),
    /** Figma 54 · Language. Null follows the device. Migration 0035. */
    language: text('language'),
    /** Figma 55 · Appearance: 'light' | 'dark' | 'system'. Null follows the device. */
    appearance: text('appearance'),
    defaultLat: doublePrecision('default_lat'),
    defaultLng: doublePrecision('default_lng'),
    status: accountStatusEnum('status').notNull().default('active'),
    /**
     * W6 suspension metadata. `status` is the gate every reader already honours
     * (`account_not_active` on booking creation, the customer policy at refresh);
     * these three columns record WHO decided and WHY, for the same reason
     * `admin_actions` exists — the status alone loses the story.
     */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedBy: uuid('suspended_by').references(() => adminUsers.id),
    suspensionReason: text('suspension_reason'),
    /**
     * §12.3 per-user channel opt-outs (Phase 13). Only the categories a person
     * may legally switch off have a key — transactional and safety rows are
     * unsuppressible by construction, not by a default that could be flipped.
     *
     * jsonb rather than columns for the same reasons `fleets.notification_prefs`
     * is: the list is product-driven and grows, it is never a query predicate,
     * and adding a preference must not be a migration. Unknown keys are dropped
     * on write and missing keys default on read.
     */
    notificationPrefs: jsonb('notification_prefs')
      .notNull()
      .default({})
      .$type<Partial<SubjectNotificationPrefs>>(),
    ...timestamps,
  },
  (t) => [index('idx_users_status').on(t.status)],
);

export const savedVehicles = pgTable(
  'saved_vehicles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * The customer's own vehicle category (§9.1.5) — no DB enum, since the
     * taxonomy is a Phase 12 default (`ToBeDoneEhsan.md`) that may still
     * change; widening this stays a contract change only, never a migration.
     */
    type: text('type').notNull().$type<VehicleCategory>(),
    makeModel: text('make_model'),
    plate: text('plate'),
    rcUrl: text('rc_url'),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('idx_saved_vehicles_user').on(t.userId)],
);

export const addresses = pgTable(
  'addresses',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label'),
    fullAddress: text('full_address').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('idx_addresses_user').on(t.userId)],
);

export const emergencyContacts = pgTable(
  'emergency_contacts',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    relation: text('relation'),
    ...timestamps,
  },
  (t) => [index('idx_emergency_contacts_user').on(t.userId)],
);
