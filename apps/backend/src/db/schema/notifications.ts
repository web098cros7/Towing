import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { NotificationCategory, NotificationChannel } from '@towing/api-contracts';
import { primaryId, timestamps } from './columns';
import { devices } from './devices';

/**
 * §12 — the notification spine (Phase 13). Three tables, three jobs:
 *
 *   `notification_events`      one row per `emit()`. The durable record that
 *                              something happened, written in the producer's
 *                              own transaction.
 *   `notifications`            the in-app centre (the bell), one row per
 *                              recipient. Written in the SAME transaction as
 *                              the event — never derived from a delivery
 *                              receipt, so a message with no push token, a
 *                              log-adapter delivery or a revoked device still
 *                              appears (invariant 74).
 *   `notification_deliveries`  one row per (event, recipient, channel, device).
 *                              The outbound attempt log and the DLQ's paper
 *                              trail.
 *
 * `subject_id` is polymorphic and FK-free everywhere here, paired with
 * `subject_type` — the shape `devices`/`login_challenges`/`social_identities`
 * already use. CHECKs are hand-written in migration 0010.
 */

/** `'user' | 'driver' | 'fleet'` — the three things that can receive a §12.2 row. */
export type NotificationSubjectType = 'user' | 'driver' | 'fleet';

/**
 * The runtime companion to migration 0010's `ck_notifications_subject_type`.
 *
 * Since W14 the recipient union also carries `contact` (an SOS contact
 * snapshot) and `ops` (an on-call admin) — delivery-only kinds with no in-app
 * centre. This is what the inbox writer and the dispatcher consult instead of
 * maintaining their own copies of the three literal names.
 */
export function isInboxSubjectType(subjectType: string): subjectType is NotificationSubjectType {
  return subjectType === 'user' || subjectType === 'driver' || subjectType === 'fleet';
}

export const notificationEvents = pgTable(
  'notification_events',
  {
    id: primaryId(),
    /** Trigger key, e.g. `driver.kyc.approved`. Free text: the set grows every phase. */
    event: text('event').notNull(),
    /**
     * The trigger's own payload — domain ids, never resolved addresses. This is
     * what a replay re-resolves from, which is why a phone number changing
     * between emit and delivery yields the CURRENT number, not a stale one.
     *
     * ⚠ NEVER put a credential or a one-time code in here. This table has no
     * TTL and no purge until Phase 20. It is the reason OTP stays on `OtpPort`
     * rather than riding the spine: `login_challenges.code_hash` is hashed with
     * a 300 s TTL, and routing OTP through here would have written the live
     * plaintext code into a permanent table.
     */
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    /**
     * Optional collapse key. Partial-unique with `event` in the migration, so a
     * double-submitted decision produces one event rather than two pushes.
     * Choose something stable across the two calls — an audit row id, not a
     * per-call `new Date()`.
     */
    dedupeKey: text('dedupe_key'),
    /**
     * Stamped by the fan-out worker AFTER its per-channel jobs are enqueued,
     * never before: a crash between the stamp and the enqueue would otherwise
     * strand every delivery permanently, because the retry short-circuits on
     * this column. `notifications.sweep` re-enqueues anything still null.
     */
    fannedOutAt: timestamp('fanned_out_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('idx_notification_events_created').on(t.createdAt.desc())],
);

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    subjectId: uuid('subject_id').notNull(),
    /** `'user' | 'driver' | 'fleet'` — CHECK-constrained in the migration. */
    subjectType: text('subject_type').notNull().$type<NotificationSubjectType>(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => notificationEvents.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    /** CHECK-constrained to `notificationCategorySchema`'s six values. */
    category: text('category').notNull().$type<NotificationCategory>(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Rendered `PushDataPayload` — string-to-string, matching what FCM/APNs carry. */
    data: jsonb('data').notNull().default({}).$type<Record<string, string>>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('idx_notifications_subject').on(t.subjectType, t.subjectId, t.createdAt.desc())],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: primaryId(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => notificationEvents.id, { onDelete: 'cascade' }),
    /** `${subjectType}:${subjectId}` — one string so the unique indexes stay narrow. */
    recipientKey: text('recipient_key').notNull(),
    channel: text('channel').notNull().$type<NotificationChannel>(),
    /**
     * Set for `push` only — one delivery per live device, which is the entire
     * reason the `devices` table exists. `ON DELETE SET NULL` rather than
     * cascade: losing the device must not erase the record that we tried.
     */
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    /**
     * MASKED at rest — phone last 4, email local-part elided, push token last 6.
     * The raw address exists only inside the delivery job's payload, for the
     * lifetime of that job. A push token is a live delivery capability, not an
     * identifier, and this table has no purge until Phase 20.
     *
     * Nullable because a `skipped` row by definition has no address; the
     * migration's CHECK pins "non-null unless skipped".
     */
    destination: text('destination'),
    /** `queued | sending | sent | failed | skipped` — CHECK-constrained. */
    status: text('status').notNull().default('queued'),
    /** `no_address | no_push_target | suppressed_by_pref | notifications_disabled` — CHECK-constrained. */
    skipReason: text('skip_reason'),
    /** Adapter that handled it: `log` | `expo` | `msg91` | `whatsapp_cloud` | `ses`. */
    vendor: text('vendor'),
    /** Provider-side id. For Expo this is the ticket id the receipts job polls with. */
    vendorRef: text('vendor_ref'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('idx_notification_deliveries_event').on(t.eventId),
    index('idx_notification_deliveries_status').on(t.status, t.createdAt),
  ],
);
