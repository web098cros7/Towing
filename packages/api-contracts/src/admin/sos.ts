import { z } from 'zod';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import {
  sosActorTypeSchema,
  sosContactChannelResultSchema,
  sosEventKindSchema,
  sosSourceSchema,
  sosStatusSchema,
  sosSubjectTypeSchema,
} from '../common/sos';

/**
 * W14's operations console — `/v1/admin/sos/*` (§13, §9.4).
 *
 * The queue exists to answer one question ("what is on fire right now?") and
 * the detail exists to reconstruct everything about one incident. `ackSeconds`
 * is computed server-side rather than left to the client: it is §22.2's
 * response-time metric, and two clients computing it from two clocks is how a
 * KPI drifts.
 */

export const adminSosAlertSchema = z.object({
  id: z.uuid(),
  subjectType: sosSubjectTypeSchema,
  subjectId: z.uuid(),
  /** Resolved from `users`/`drivers` at read time — null if the row is gone. */
  subjectName: z.string().nullable(),
  subjectMobile: z.string().nullable(),
  bookingId: z.uuid().nullable(),
  bookingCode: z.string().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nullable(),
  source: sosSourceSchema,
  status: sosStatusSchema,
  acknowledgedBy: z.uuid().nullable(),
  acknowledgedByName: z.string().nullable(),
  acknowledgedAt: z.iso.datetime().nullable(),
  resolvedBy: z.uuid().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  resolution: z.string().nullable(),
  /** Trigger→acknowledge, whole seconds; null until acknowledged. The KPI's input. */
  ackSeconds: z.number().int().min(0).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminSosAlert = z.infer<typeof adminSosAlertSchema>;

export const adminSosQuerySchema = pageQuerySchema.extend({
  status: sosStatusSchema.optional(),
  /**
   * "Open" = `triggered` OR `acknowledged`. The default tab; kept as one flag
   * because the alternative is a client-side union the server can do cheaper.
   */
  open: z.coerce.boolean().optional(),
  subjectType: sosSubjectTypeSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type AdminSosQuery = z.infer<typeof adminSosQuerySchema>;

export const adminSosResponseSchema = pageEnvelopeSchema(adminSosAlertSchema);
export type AdminSosResponse = z.infer<typeof adminSosResponseSchema>;

/** The contact snapshot, read back with each channel's delivery outcome. */
export const adminSosContactSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  relation: z.string().nullable(),
  notifiedChannels: z.array(sosContactChannelResultSchema),
});
export type AdminSosContact = z.infer<typeof adminSosContactSchema>;

export const adminSosEventSchema = z.object({
  id: z.uuid(),
  kind: sosEventKindSchema,
  actorType: sosActorTypeSchema,
  actorId: z.uuid().nullable(),
  /** Admin display name for `actorType: 'admin'` — a timeline reads as people, not ids. */
  actorName: z.string().nullable(),
  note: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminSosEvent = z.infer<typeof adminSosEventSchema>;

export const adminSosDetailSchema = adminSosAlertSchema.extend({
  contacts: z.array(adminSosContactSchema),
  events: z.array(adminSosEventSchema),
});
export type AdminSosDetail = z.infer<typeof adminSosDetailSchema>;

// ---------------------------------------------------------------------------
// Workflow: acknowledge, note, contact, resolve, broadcast
// ---------------------------------------------------------------------------

/** Shared answer for the workflow steps that only move the status. */
export const adminSosActionResponseSchema = z.object({
  alertId: z.uuid(),
  status: sosStatusSchema,
  at: z.iso.datetime(),
});
export type AdminSosActionResponse = z.infer<typeof adminSosActionResponseSchema>;

export const adminSosNoteBodySchema = z.object({
  note: z.string().trim().min(2).max(2000),
});
export type AdminSosNoteBody = z.infer<typeof adminSosNoteBodySchema>;

/**
 * `POST /:id/contact` — opens a masked call through the telephony port and
 * logs a `contacted` event. The response carries what the OPERATOR needs to
 * dial next; the vendor reference is what support cites to Exotel later.
 */
export const adminSosContactBodySchema = z.object({
  /** Which snapshot contact to reach; defaults to the first one on file. */
  contactId: z.uuid().optional(),
});
export type AdminSosContactBody = z.infer<typeof adminSosContactBodySchema>;

export const adminSosContactResponseSchema = z.object({
  alertId: z.uuid(),
  /** Null when the port could not produce a number for this contact. */
  dialNumber: z.string().nullable(),
  /**
   * False when the free direct-dial fallback answered instead of Exotel — the
   * console must not claim a call is masked when it is the real number.
   */
  masked: z.boolean(),
  /** Provider-side binding reference; null on the direct-dial path. */
  reference: z.string().nullable(),
});
export type AdminSosContactResponse = z.infer<typeof adminSosContactResponseSchema>;

export const adminSosResolveBodySchema = z.object({
  resolution: z.string().trim().min(4).max(2000),
});
export type AdminSosResolveBody = z.infer<typeof adminSosResolveBodySchema>;

/**
 * `POST /:id/broadcast` (G12) — the ONE way a location reaches drivers who are
 * not on the job, and it is never automatic: an operator decides that the
 * people closest to the incident are more useful alerted than uninvolved.
 */
export const adminSosBroadcastBodySchema = z.object({
  radiusKm: z.number().min(0.5).max(25).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type AdminSosBroadcastBody = z.infer<typeof adminSosBroadcastBodySchema>;

export const adminSosBroadcastResponseSchema = z.object({
  alertId: z.uuid(),
  /** Drivers the broadcast actually reached (online, in radius, capped). */
  notified: z.number().int().min(0),
  radiusKm: z.number(),
});
export type AdminSosBroadcastResponse = z.infer<typeof adminSosBroadcastResponseSchema>;

/**
 * `POST /v1/admin/sos` — an operator raising an alert on a caller's behalf
 * (`source: 'ops'`). This is what keeps the console useful before the mobile
 * SOS button exists: a customer telephones, ops opens an incident, and the
 * whole workflow is identical from the acknowledge step on.
 */
export const adminSosCreateBodySchema = z.object({
  subjectType: sosSubjectTypeSchema,
  subjectId: z.uuid(),
  /** Omit to fall back to the subject's known position (home pin / last ping). */
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  bookingId: z.uuid().optional(),
  /** What the caller said — lands on the timeline as the first note. */
  note: z.string().trim().min(2).max(2000).optional(),
});
export type AdminSosCreateBody = z.infer<typeof adminSosCreateBodySchema>;

export const adminSosCreateResponseSchema = z.object({
  alertId: z.uuid(),
  status: sosStatusSchema,
  /** True when the subject already had an open alert — the call added a note, not a new incident. */
  replayed: z.boolean(),
});
export type AdminSosCreateResponse = z.infer<typeof adminSosCreateResponseSchema>;
