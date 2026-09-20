import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns';
import { adminUsers } from './admin';
import { bookings } from './bookings';

/**
 * W14 — SOS (§13). Three tables, and each one exists for a different reason.
 *
 * `sos_alerts` is the incident: who raised it, from where, and where it stands.
 * One OPEN alert per subject is a database fact (the partial unique index) —
 * a second panic tap while the first alert is live returns the same incident
 * instead of opening a parallel one for the next operator to pick up.
 *
 * `sos_alert_contacts` is a SNAPSHOT of the subject's emergency contacts as
 * they were at trigger time. Contacts can be edited mid-incident and the
 * notification spine re-resolves recipients at delivery time; without the
 * snapshot an operator could never reconstruct who was supposed to be told.
 *
 * `sos_alert_events` is §13's "full timeline" and the source of the response
 * time KPI (`acknowledged → triggered`). Nothing about an incident is ever
 * updated in place without a row landing here.
 *
 * `subject_type` allows `driver` as well as `user`, but a driver has no
 * `emergency_contacts` rows today (that table is user-scoped): a driver alert
 * fans out to ops only. That is a real state, not a bug.
 */
export const sosAlerts = pgTable(
  'sos_alerts',
  {
    id: primaryId(),
    /** `user` | `driver` — CHECK-pinned; the subject vocabulary of the JWT realm that raised it. */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /**
     * The booking in progress when the alert fired, when there was one.
     * SET NULL rather than cascade: a safety record must outlive the row it
     * happened during.
     */
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracyM: doublePrecision('accuracy_m'),
    /** `app` | `ops` | `sms_fallback` — the console tells an operator-raised alert apart. */
    source: text('source').notNull(),
    /** `triggered` | `acknowledged` | `resolved` | `cancelled`. */
    status: text('status').notNull().default('triggered'),
    acknowledgedBy: uuid('acknowledged_by').references(() => adminUsers.id),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => adminUsers.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
    ...timestamps,
  },
  (t) => [
    // One OPEN incident per subject. A resolved or cancelled alert does not
    // block the next one — history may accumulate freely.
    uniqueIndex('uq_sos_alerts_open_per_subject')
      .on(t.subjectType, t.subjectId)
      .where(sql`"status" IN ('triggered', 'acknowledged')`),
    // The queue's only read: open alerts, newest first.
    index('idx_sos_alerts_status_created').on(t.status, t.createdAt.desc()),
    index('idx_sos_alerts_subject').on(t.subjectType, t.subjectId, t.createdAt.desc()),
  ],
);

/**
 * The contacts as they were at trigger time — the snapshot that makes an
 * incident reconstructable. `notified_channels` records the per-channel
 * outcome (`sent` / `failed:dlt_template_missing` / …), because today SMS is
 * blocked on DLT registration and the console must be able to say so honestly
 * rather than imply the contact was reached.
 */
export const sosAlertContacts = pgTable(
  'sos_alert_contacts',
  {
    id: primaryId(),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => sosAlerts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    relation: text('relation'),
    notifiedChannels: jsonb('notified_channels').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_sos_alert_contacts_alert').on(t.alertId)],
);

/**
 * The audit trail of the incident — §13's "full timeline", and the source of
 * the ack-time KPI. `kind` and `actor_type` are CHECK-pinned in migration 0029:
 * the console renders this list as the incident's history, so an unknown kind
 * would be a row no reader can interpret.
 */
export const sosAlertEvents = pgTable(
  'sos_alert_events',
  {
    id: primaryId(),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => sosAlerts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** `subject` | `admin` | `system`. */
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    note: text('note'),
    /** Free-shape detail: masked-call reference, broadcast count, duplicate marker. */
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_sos_alert_events_alert').on(t.alertId, t.createdAt)],
);
