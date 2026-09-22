import { z } from 'zod';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';
import {
  supportActorTypeSchema,
  supportRequesterTypeSchema,
  supportTicketCategorySchema,
  supportTicketEventKindSchema,
  supportTicketPrioritySchema,
  supportTicketStatusSchema,
} from '../common/support';

/**
 * W15's support console — `/v1/admin/support/tickets/*` (§9.4.12).
 *
 * The queue and the thread exist for one question each: "what needs a human?"
 * and "what actually happened on this one?" — which is why the DETAIL carries
 * the internal notes the requester's view cannot name, and why the queue's
 * shape is flat enough to colour by SLA on the client.
 */

export const adminSupportTicketSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  requesterType: supportRequesterTypeSchema,
  requesterId: z.uuid(),
  /** Resolved at read time so the queue is a list of people, not uuids. */
  requesterName: z.string().nullable(),
  requesterMobile: z.string().nullable(),
  bookingId: z.uuid().nullable(),
  bookingCode: z.string().nullable(),
  category: supportTicketCategorySchema,
  subject: z.string(),
  status: supportTicketStatusSchema,
  priority: supportTicketPrioritySchema,
  assignedAdminId: z.uuid().nullable(),
  assignedAdminName: z.string().nullable(),
  firstResponseAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminSupportTicket = z.infer<typeof adminSupportTicketSchema>;

/** The message row carries `visibility` — this is the console's own vocabulary. */
export const adminSupportMessageSchema = z.object({
  id: z.uuid(),
  authorType: supportActorTypeSchema,
  authorId: z.uuid().nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  visibility: z.enum(['public', 'internal']),
  attachments: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type AdminSupportMessage = z.infer<typeof adminSupportMessageSchema>;

export const adminSupportTicketEventSchema = z.object({
  id: z.uuid(),
  kind: supportTicketEventKindSchema,
  actorType: supportActorTypeSchema,
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminSupportTicketEvent = z.infer<typeof adminSupportTicketEventSchema>;

export const adminSupportTicketsQuerySchema = pageQuerySchema.extend({
  status: supportTicketStatusSchema.optional(),
  /**
   * "Open" = NOT `resolved`/`closed`. The queue's default tab, kept as one flag
   * because the alternative is a client-side union the server can do cheaper.
   * Wins over `status` when both are sent.
   */
  open: z.coerce.boolean().optional(),
  priority: supportTicketPrioritySchema.optional(),
  category: supportTicketCategorySchema.optional(),
  /** "Assigned to me" — the caller's own admin id comes from the web session. */
  assignedAdminId: z.uuid().optional(),
  requesterType: supportRequesterTypeSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type AdminSupportTicketsQuery = z.infer<typeof adminSupportTicketsQuerySchema>;

export const adminSupportTicketsResponseSchema = pageEnvelopeSchema(adminSupportTicketSchema);
export type AdminSupportTicketsResponse = z.infer<typeof adminSupportTicketsResponseSchema>;

export const adminSupportTicketDetailSchema = adminSupportTicketSchema.extend({
  /** PUBLIC AND INTERNAL — this is the only payload in the product that carries both. */
  messages: z.array(adminSupportMessageSchema),
  events: z.array(adminSupportTicketEventSchema),
});
export type AdminSupportTicketDetail = z.infer<typeof adminSupportTicketDetailSchema>;

// ---------------------------------------------------------------------------
// Workflow: assign, status, message, note, link-booking
// ---------------------------------------------------------------------------

/** `POST /:id/assign` — no body means "assign to me". */
export const adminSupportAssignBodySchema = z.object({
  adminId: z.uuid().optional(),
});
export type AdminSupportAssignBody = z.infer<typeof adminSupportAssignBodySchema>;

/**
 * `POST /:id/status` — the transition is validated against
 * `SUPPORT_STATUS_TRANSITIONS`; `priority` rides along because "this is now
 * urgent" is the same decision as "this is now in progress".
 */
export const adminSupportStatusBodySchema = z.object({
  status: supportTicketStatusSchema,
  priority: supportTicketPrioritySchema.optional(),
  note: z.string().trim().max(1000).optional(),
});
export type AdminSupportStatusBody = z.infer<typeof adminSupportStatusBodySchema>;

/** `POST /:id/message` — a PUBLIC reply; it notifies the requester and stops the SLA clock. */
export const adminSupportReplyBodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type AdminSupportReplyBody = z.infer<typeof adminSupportReplyBodySchema>;

/** `POST /:id/note` — INTERNAL; it never notifies and never leaves the console. */
export const adminSupportNoteBodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type AdminSupportNoteBody = z.infer<typeof adminSupportNoteBodySchema>;

export const adminSupportLinkBookingBodySchema = z.object({
  bookingId: z.uuid(),
});
export type AdminSupportLinkBookingBody = z.infer<typeof adminSupportLinkBookingBodySchema>;
