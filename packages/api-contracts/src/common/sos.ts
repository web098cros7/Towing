import { z } from 'zod';

/**
 * §13's SOS — the REQUESTER half of the alert, shared by the customer and
 * driver realms (`POST /v1/sos`, `POST /v1/sos/:id/cancel`).
 *
 * The unions here are the source of truth for migration 0029's CHECK
 * constraints — `migration-0029.spec.ts` pins every SQL literal list to these
 * arrays, the house rule wherever a CHECK duplicates a TypeScript union.
 *
 * Three defaults the design fixes, stated here because they are product
 * decisions rather than implementation details:
 *
 *  - **Standalone SOS is ON** (G11). A person in trouble with no booking open
 *    must still reach ops; the kill switch that disables that is stored as a
 *    "disabled" flag so a Redis outage leaves SOS working.
 *  - **The nearest-driver broadcast is never automatic** (G12) — it reveals
 *    the caller's location to drivers who are not on the job, so it is an
 *    explicit ops action on the incident, not a fan-out rule.
 *  - **SMS is used even though DLT registration is not done**: the channel
 *    adapter treats a missing template id as a hard failure, and
 *    `contacts_notified` records that outcome per contact. The console states
 *    the degradation instead of implying a contact was reached.
 */

/** `user` | `driver` — the two database-backed subjects that can raise an alert. */
export const SOS_SUBJECT_TYPES = ['user', 'driver'] as const;
export const sosSubjectTypeSchema = z.enum(SOS_SUBJECT_TYPES);
export type SosSubjectType = z.infer<typeof sosSubjectTypeSchema>;

export const SOS_STATUSES = ['triggered', 'acknowledged', 'resolved', 'cancelled'] as const;
export const sosStatusSchema = z.enum(SOS_STATUSES);
export type SosStatus = z.infer<typeof sosStatusSchema>;

/**
 * `app` — raised from the app (the only writer today, alongside `ops`).
 * `ops` — an operator raised it on a caller's behalf (a phone call reaching
 * the console, which is how a standalone console stays useful before the
 * mobile button ships).
 * `sms_fallback` — reserved for the inbound-SMS path; no producer until the
 * MSG91/DLT registration exists.
 */
export const SOS_SOURCES = ['app', 'ops', 'sms_fallback'] as const;
export const sosSourceSchema = z.enum(SOS_SOURCES);
export type SosSource = z.infer<typeof sosSourceSchema>;

/** §13's "full timeline" vocabulary, pinned by `ck_sos_alert_events_kind`. */
export const SOS_EVENT_KINDS = [
  'triggered',
  'contacts_notified',
  'ops_alerted',
  'acknowledged',
  'contacted',
  'note',
  'broadcast',
  'resolved',
  'cancelled',
] as const;
export const sosEventKindSchema = z.enum(SOS_EVENT_KINDS);
export type SosEventKind = z.infer<typeof sosEventKindSchema>;

export const SOS_ACTOR_TYPES = ['subject', 'admin', 'system'] as const;
export const sosActorTypeSchema = z.enum(SOS_ACTOR_TYPES);
export type SosActorType = z.infer<typeof sosActorTypeSchema>;

/** The two fan-out channels a contact snapshot row can report on. Push is ops-only. */
export const SOS_CONTACT_CHANNELS = ['sms', 'whatsapp'] as const;
export const sosContactChannelSchema = z.enum(SOS_CONTACT_CHANNELS);
export type SosContactChannel = z.infer<typeof sosContactChannelSchema>;

/**
 * One channel's delivery attempt for one contact. `ok: false` carries the
 * adapter's code (`dlt_template_missing`, `wa_template_missing`, …) — the
 * console renders these next to the contact so "SMS-only for now" is visible
 * rather than assumed.
 */
export const sosContactChannelResultSchema = z.object({
  channel: sosContactChannelSchema,
  ok: z.boolean(),
  code: z.string().nullable(),
});
export type SosContactChannelResult = z.infer<typeof sosContactChannelResultSchema>;

// ---------------------------------------------------------------------------
// Raise + cancel (the requester's two calls)
// ---------------------------------------------------------------------------

export const sosCreateRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Device-reported accuracy, metres. A rough ping is still a ping. */
  accuracyM: z.number().nonnegative().max(10_000).optional(),
  /** The booking in progress, when there is one — the console deep-links it. */
  bookingId: z.uuid().optional(),
});
export type SosCreateRequest = z.infer<typeof sosCreateRequestSchema>;

export const sosCreateResponseSchema = z.object({
  alertId: z.uuid(),
  status: sosStatusSchema,
  createdAt: z.iso.datetime(),
  /**
   * True when an alert was ALREADY open for this subject and the tap was
   * folded into it. The timeline gains a duplicate `triggered` event and the
   * console is re-pinged; contacts are not messaged twice.
   */
  replayed: z.boolean(),
});
export type SosCreateResponse = z.infer<typeof sosCreateResponseSchema>;

export const sosCancelResponseSchema = z.object({
  alertId: z.uuid(),
  status: sosStatusSchema,
  cancelledAt: z.iso.datetime(),
});
export type SosCancelResponse = z.infer<typeof sosCancelResponseSchema>;

/** The window in which the app's undo button is shown, seconds (§13's "5-second undo"). */
export const SOS_UNDO_WINDOW_SECONDS = 5;
