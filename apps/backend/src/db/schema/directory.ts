import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin';
import { primaryId } from './columns';
import { drivers } from './drivers';
import { serviceZones } from './service-zones';

/**
 * W6's directory-support tables (migration 0024).
 *
 * The searches themselves are raw SQL in `AdminDirectoryRepo` (trigram probes
 * and keyset pagination read better as SQL, and that module reads on
 * `DB_READER`); these definitions exist for the same reason every other table
 * has one — the schema barrel is what keeps a hand-written migration and the
 * TypeScript side from drifting, and W6's own writes (suspension, zone
 * restrictions, impersonation sessions) go through drizzle.
 */

/**
 * §4.2's "Support may request, not perform": support holds
 * `user.suspend.request`, and a suspension attempt without `user.suspend`
 * files one of these rows and is refused. The partial unique index — one OPEN
 * request per subject — is expressed in the migration (drizzle-kit emits no
 * WHERE clause on indexes).
 */
export const suspensionRequests = pgTable(
  'suspension_requests',
  {
    id: primaryId(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => adminUsers.id),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    decidedBy: uuid('decided_by').references(() => adminUsers.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_suspension_requests_status_created').on(t.status, t.createdAt.desc())],
);

/**
 * §6.10's zone restrictions: a restricted driver is EXCLUDED from dispatch in
 * those zones, not hidden — the live map keeps drawing them so an operator can
 * see why supply disappeared (the W4 contract comment states the rule).
 */
export const driverZoneRestrictions = pgTable(
  'driver_zone_restrictions',
  {
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => serviceZones.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.driverId, t.zoneId] })],
);

/**
 * Document versions — created by migration 0024, WRITTEN BY W7. A resubmission
 * that overwrites `driver_documents` orphans the storage object; this table is
 * the history W7's upload/review path writes and W19's erasure walks.
 */
export const driverDocumentVersions = pgTable(
  'driver_document_versions',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(),
    fileUrl: text('file_url').notNull(),
    status: text('status').notNull(),
    rejectionReason: text('rejection_reason'),
    verifiedBy: uuid('verified_by').references(() => adminUsers.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_driver_document_versions_driver').on(t.driverId, t.createdAt.desc())],
);

/**
 * G8's read-only impersonation bookmarks. NO TOKEN IS EVER MINTED for the
 * subject: a session row authorises nothing by itself, it names the admin whose
 * audited reads render "what the customer sees" — which is why "no write route
 * accepts an impersonation session" is true by construction.
 */
export const impersonationSessions = pgTable(
  'impersonation_sessions',
  {
    id: primaryId(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    reason: text('reason').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_impersonation_sessions_subject').on(t.subjectType, t.subjectId, t.startedAt.desc()),
  ],
);
