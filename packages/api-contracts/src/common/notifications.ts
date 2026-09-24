import { z } from 'zod';
import { cursorEnvelopeSchema } from './pagination';

/**
 * §12 — the notification spine (Phase 13). Dual-realm: a customer and a driver
 * both register devices, both read an in-app centre and both hold preferences,
 * so these live in `common/` per the flat-barrel rule — a name declared in two
 * realm folders is a build error, same reasoning as `account-privacy.ts`.
 *
 * THIS FILE IS THE SINGLE SOURCE for devices, the inbox, preferences and the
 * push data payload. B1/B2 (the two apps) import from here; they do not
 * redeclare. `notificationPrefsSchema` in `fleet/settings.ts` is a DIFFERENT
 * thing — fleet-owner console toggles, four keys, Track A — and the two must
 * not be unified: it is a live column with its own defaults.
 */

export const notificationChannelSchema = z.enum(['push', 'sms', 'whatsapp', 'email']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/**
 * §12.3's "transactional/safety always on" made structural. Only `promotions`
 * and `weeklySummary` are opt-out-able; every other category is always-on by
 * construction, which is why there is no key for it here. Pinned by
 * `ck_notifications_category` in migration 0010 — the two lists must agree.
 */
export const notificationCategorySchema = z.enum([
  'transactional',
  'safety',
  'job',
  'money',
  'promotions',
  'compliance',
]);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const devicePlatformSchema = z.enum(['ios', 'android']);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

// --- Preferences ------------------------------------------------------------

/**
 * ONLY the categories a person may legally switch off. A key absent from this
 * object is not "defaulted on" — it is unsuppressible, and `PreferenceService`
 * never consults it. Adding a key here is what makes a category opt-out-able,
 * so do not add one without checking §12.3.
 *
 * Stored as jsonb (`users.notification_prefs`, `drivers.notification_prefs`):
 * unknown keys are dropped on write and missing keys default on read, so an old
 * client can never blank a preference a newer one added.
 */
export const subjectNotificationPrefsSchema = z.object({
  promotions: z.boolean().default(false),
  weeklySummary: z.boolean().default(true),
});
export type SubjectNotificationPrefs = z.infer<typeof subjectNotificationPrefsSchema>;

export const SUBJECT_NOTIFICATION_PREF_DEFAULTS: SubjectNotificationPrefs = {
  promotions: false,
  weeklySummary: true,
};

/**
 * `PUT /v1/{me,driver}/notification-prefs` — a genuine partial.
 *
 * ⚠ DELIBERATELY NOT `subjectNotificationPrefsSchema.partial()`. `.partial()`
 * makes a key optional but does NOT strip its `.default()`, so parsing
 * `{ weeklySummary: false }` through that would yield
 * `{ promotions: false, weeklySummary: false }` — silently resetting a
 * preference the client never mentioned, and making the "at least one field"
 * refinement unreachable because `{}` also parses to two keys.
 *
 * The fields are therefore restated without defaults. Keep the two objects in
 * step by hand; the round-trip is covered by
 * `notification-centre.e2e.spec.ts`'s merge test.
 */
export const subjectNotificationPrefsUpdateSchema = z
  .object({
    promotions: z.boolean(),
    weeklySummary: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, {
    message: 'Provide at least one preference to update',
  });
export type SubjectNotificationPrefsUpdate = z.infer<typeof subjectNotificationPrefsUpdateSchema>;

// --- Devices ----------------------------------------------------------------

/**
 * `POST /v1/{me,driver}/devices`.
 *
 * `installationId` is CLIENT-GENERATED, opaque and stable across push-token
 * rotation — it is what makes re-registration an update rather than a second
 * row every time Expo mints a new token. Deliberately `string`, not `z.uuid()`:
 * the server has no reason to care how a client derives it, and pinning UUID
 * would break any client that uses a platform install id.
 *
 * `pushToken` is nullable so a device whose owner denied the OS permission
 * still registers — the row is what lets `last_seen_at` and app-version
 * telemetry work, and it flips to a real token if permission is granted later.
 */
export const deviceRegisterSchema = z.object({
  installationId: z.string().trim().min(8).max(128),
  pushToken: z.string().trim().min(1).max(512).nullable(),
  platform: devicePlatformSchema,
  appVersion: z.string().trim().max(32).optional(),
});
export type DeviceRegisterRequest = z.infer<typeof deviceRegisterSchema>;

export const deviceSchema = z.object({
  id: z.uuid(),
  installationId: z.string(),
  platform: devicePlatformSchema,
  appVersion: z.string().nullable(),
  /** Whether this row currently holds a usable push token. The token never crosses the wire back. */
  pushEnabled: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
});
export type DeviceDto = z.infer<typeof deviceSchema>;

/**
 * `DELETE /v1/{me,driver}/devices` — body-carrying, matching
 * `DELETE /v1/me`'s existing shape (the mobile `apiFetch` and the console BFF
 * proxy both already send DELETE bodies). A path param would leak the
 * installation id into access logs for no gain.
 */
export const deviceUnregisterSchema = z.object({
  installationId: z.string().trim().min(8).max(128),
});
export type DeviceUnregisterRequest = z.infer<typeof deviceUnregisterSchema>;

// --- Push data payload ------------------------------------------------------

/**
 * THE discriminator is `event`, and it is declared exactly once — here.
 *
 * Both halves of the §9.4.3 acceptance chain depend on it: the backend stamps
 * it onto every push's `data`, and each app's `handleNotificationData` switches
 * on it. If the two sides ever pick different field names the chain silently
 * no-ops — the push arrives, nothing refetches, and the bug is invisible
 * without a device. A backend spec parses emitted `data` through this schema
 * and each app imports the same type, so a rename breaks the build instead.
 *
 * `action: 'refetch'` means "invalidate `invalidate` and stay put";
 * `'open'` means "navigate to `route`". Values are strings because APNs/FCM
 * data payloads are string-to-string maps — numbers and booleans arrive
 * stringified regardless of what was sent.
 */
export const pushDataPayloadSchema = z.object({
  event: z.string().min(1),
  notificationId: z.uuid(),
  action: z.enum(['refetch', 'open']),
  /** A query-key namespace the client should invalidate, e.g. `driver.kyc`. */
  invalidate: z.string().optional(),
  /** An app route to open on tap, e.g. `mitowdriver://kyc`. */
  route: z.string().optional(),
});
export type PushDataPayload = z.infer<typeof pushDataPayloadSchema>;

// --- In-app notification centre ---------------------------------------------

/**
 * One row of the bell.
 *
 * Written in `emit()`'s own transaction, NEVER derived from a delivery receipt
 * (invariant 74). A notification with no push token, delivered only by the log
 * adapter, or aimed at a revoked device must still appear here — that is what
 * makes the whole spine demonstrable with zero vendor credentials.
 */
export const notificationSchema = z.object({
  id: z.uuid(),
  /** The trigger key, e.g. `driver.kyc.approved`. Same vocabulary as `PushDataPayload.event`. */
  event: z.string(),
  category: notificationCategorySchema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.string()),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const notificationsListResponseSchema = cursorEnvelopeSchema(notificationSchema);
export type NotificationsListResponse = z.infer<typeof notificationsListResponseSchema>;

export const unreadCountResponseSchema = z.object({
  unread: z.number().int().min(0),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;

/**
 * `POST /v1/{me,driver}/notifications/read`.
 *
 * `ids` ABSENT means "mark everything read" — one route, not a separate
 * `/read-all`. `.default({})` for the same reason `accountDeletionRequestSchema`
 * has it: a bodyless POST arrives as `undefined` and would otherwise 422.
 */
export const notificationsReadRequestSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(200).optional(),
  })
  .default({});
export type NotificationsReadRequest = z.infer<typeof notificationsReadRequestSchema>;

export const notificationsReadResponseSchema = z.object({
  markedRead: z.number().int().min(0),
  unread: z.number().int().min(0),
});
export type NotificationsReadResponse = z.infer<typeof notificationsReadResponseSchema>;
