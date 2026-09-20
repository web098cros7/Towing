import { z } from 'zod';
import { pageEnvelopeSchema, pageQuerySchema } from './pagination';

/**
 * W15's support tickets — the REQUESTER half (`/v1/support/tickets`), shared by
 * the customer, driver and fleet realms.
 *
 * The unions here are the source of truth for migration 0030's CHECK
 * constraints — `migration-0030.spec.ts` pins every SQL literal list to these
 * arrays, the house rule wherever a CHECK duplicates a TypeScript union.
 *
 * THE ONE RULE THIS FILE ENCODES BEYOND SHAPE: a requester's payload carries
 * messages, and the repository never selects `internal` ones into it. There is
 * no `visibility` field on the requester schemas at all — a requester cannot
 * even NAME an internal note, let alone read one.
 */

/** `user` | `driver` | `fleet` — the three requester subjects. */
export const SUPPORT_REQUESTER_TYPES = ['user', 'driver', 'fleet'] as const;
export const supportRequesterTypeSchema = z.enum(SUPPORT_REQUESTER_TYPES);
export type SupportRequesterType = z.infer<typeof supportRequesterTypeSchema>;

/** §9.4.12's categories, pinned by `ck_support_tickets_category`. */
export const SUPPORT_TICKET_CATEGORIES = [
  'booking',
  'payment',
  'kyc',
  'app',
  'safety',
  'other',
] as const;
export const supportTicketCategorySchema = z.enum(SUPPORT_TICKET_CATEGORIES);
export type SupportTicketCategory = z.infer<typeof supportTicketCategorySchema>;

export const SUPPORT_TICKET_STATUSES = [
  'open',
  'pending_requester',
  'in_progress',
  'resolved',
  'closed',
] as const;
export const supportTicketStatusSchema = z.enum(SUPPORT_TICKET_STATUSES);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

export const SUPPORT_TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const supportTicketPrioritySchema = z.enum(SUPPORT_TICKET_PRIORITIES);
export type SupportTicketPriority = z.infer<typeof supportTicketPrioritySchema>;

/** The message visibility vocabulary — `internal` exists only on the admin side. */
export const SUPPORT_MESSAGE_VISIBILITIES = ['public', 'internal'] as const;
export const supportMessageVisibilitySchema = z.enum(SUPPORT_MESSAGE_VISIBILITIES);
export type SupportMessageVisibility = z.infer<typeof supportMessageVisibilitySchema>;

export const SUPPORT_TICKET_EVENT_KINDS = [
  'created',
  'assigned',
  'status_changed',
  'message',
  'note',
  'linked_booking',
] as const;
export const supportTicketEventKindSchema = z.enum(SUPPORT_TICKET_EVENT_KINDS);
export type SupportTicketEventKind = z.infer<typeof supportTicketEventKindSchema>;

export const SUPPORT_ACTOR_TYPES = ['requester', 'admin', 'system'] as const;
export const supportActorTypeSchema = z.enum(SUPPORT_ACTOR_TYPES);
export type SupportActorType = z.infer<typeof supportActorTypeSchema>;

/**
 * The legal status graph. `closed` is terminal; `resolved` can be reopened to
 * `in_progress` when the requester answers the resolution, which is the one
 * edge the naive "forward only" design would have made impossible.
 * `SupportService` enforces exactly this table and the e2e spec walks it.
 */
export const SUPPORT_STATUS_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  open: ['in_progress', 'pending_requester', 'resolved', 'closed'],
  in_progress: ['pending_requester', 'resolved', 'closed'],
  pending_requester: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

// ---------------------------------------------------------------------------
// Rows + requests
// ---------------------------------------------------------------------------

export const supportTicketSummarySchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  category: supportTicketCategorySchema,
  subject: z.string(),
  status: supportTicketStatusSchema,
  priority: supportTicketPrioritySchema,
  bookingId: z.uuid().nullable(),
  firstResponseAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SupportTicketSummary = z.infer<typeof supportTicketSummarySchema>;

export const supportTicketMessageSchema = z.object({
  id: z.uuid(),
  authorType: supportActorTypeSchema,
  /** Resolved for admin authors so the requester sees "Priya (Support)". */
  authorName: z.string().nullable(),
  body: z.string(),
  attachments: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type SupportTicketMessage = z.infer<typeof supportTicketMessageSchema>;

/** The requester's create — `POST /v1/support/tickets`. */
export const supportTicketCreateRequestSchema = z.object({
  category: supportTicketCategorySchema,
  subject: z.string().trim().min(4).max(160),
  body: z.string().trim().min(4).max(4000),
  /** §6.6: "Get help" from a booking attaches the trip. */
  bookingId: z.uuid().optional(),
});
export type SupportTicketCreateRequest = z.infer<typeof supportTicketCreateRequestSchema>;

export const supportTicketCreateResponseSchema = z.object({
  ticketId: z.uuid(),
  reference: z.string(),
  status: supportTicketStatusSchema,
  createdAt: z.iso.datetime(),
});
export type SupportTicketCreateResponse = z.infer<typeof supportTicketCreateResponseSchema>;

/** `POST /v1/support/tickets/:id/messages` — a requester reply, public by definition. */
export const supportTicketMessageCreateSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type SupportTicketMessageCreate = z.infer<typeof supportTicketMessageCreateSchema>;

export const supportTicketDetailSchema = supportTicketSummarySchema.extend({
  requesterType: supportRequesterTypeSchema,
  /** PUBLIC messages only — the repository never selects internal rows here. */
  messages: z.array(supportTicketMessageSchema),
});
export type SupportTicketDetail = z.infer<typeof supportTicketDetailSchema>;

export const supportTicketsQuerySchema = pageQuerySchema.extend({
  status: supportTicketStatusSchema.optional(),
});
export type SupportTicketsQuery = z.infer<typeof supportTicketsQuerySchema>;

export const supportTicketsResponseSchema = pageEnvelopeSchema(supportTicketSummarySchema);
export type SupportTicketsResponse = z.infer<typeof supportTicketsResponseSchema>;
