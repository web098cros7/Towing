import {
  boolean,
  index,
  integer,
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
 * W15 — support tickets (migration 0030, §9.4.12, §6.6).
 *
 * `support_tickets` is the thread's head: one reference a human can quote, the
 * requester (polymorphic — a customer, a driver or a fleet), the workflow
 * columns ops actually move, and the stamps the SLA colouring reads.
 *
 * `support_ticket_messages` carries the visibility that matters most in this
 * feature: `public` messages are the requester's view of the conversation,
 * `internal` notes never leave the console. The separation is enforced by the
 * repository (requester queries never select internal rows) AND asserted by a
 * test, because "we remembered to filter" is not a mechanism.
 *
 * `support_ticket_events` is the audited trail: who assigned what, when a
 * status moved, which message was the first response. `requester_id` is
 * FK-free and paired with `requester_type` — the same shape `admin_notes` and
 * `devices` use — because no single foreign key expresses three subject types.
 */
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: primaryId(),
    /** `TKT-XXXXXXXX` — the reference the requester quotes. */
    reference: text('reference').notNull(),
    /** `user` | `driver` | `fleet`, CHECK-pinned. */
    requesterType: text('requester_type').notNull(),
    requesterId: uuid('requester_id').notNull(),
    /** §6.6's "Get help" from a booking — the trip the ticket is about. */
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    category: text('category').notNull(),
    subject: text('subject').notNull(),
    /** `open` | `pending_requester` | `in_progress` | `resolved` | `closed`. */
    status: text('status').notNull().default('open'),
    /** `low` | `normal` | `high` | `urgent`. */
    priority: text('priority').notNull().default('normal'),
    assignedAdminId: uuid('assigned_admin_id').references(() => adminUsers.id),
    /** Stamped by the first PUBLIC admin reply — the SLA's clock stops here. */
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('uq_support_tickets_reference').on(t.reference),
    // The console queue: newest first, usually filtered by status.
    index('idx_support_tickets_status_created').on(t.status, t.createdAt.desc()),
    // The requester's own list.
    index('idx_support_tickets_requester').on(t.requesterType, t.requesterId, t.createdAt.desc()),
    index('idx_support_tickets_assigned').on(t.assignedAdminId),
  ],
);

export const supportTicketMessages = pgTable(
  'support_ticket_messages',
  {
    id: primaryId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    /** `requester` | `admin` | `system`. */
    authorType: text('author_type').notNull(),
    authorId: uuid('author_id'),
    body: text('body').notNull(),
    /**
     * `public` | `internal`. INTERNAL IS THE ONE THAT MATTERS: it is excluded
     * from every requester-facing payload by construction, and the e2e spec
     * scans requester responses for it.
     */
    visibility: text('visibility').notNull().default('public'),
    /** Reserved: uploaded file references. No upload UI ships with W15. */
    attachments: jsonb('attachments').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_support_ticket_messages_ticket').on(t.ticketId, t.createdAt)],
);

export const supportTicketEvents = pgTable(
  'support_ticket_events',
  {
    id: primaryId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    /** `created` | `assigned` | `status_changed` | `message` | `note` | `linked_booking`. */
    kind: text('kind').notNull(),
    /** `requester` | `admin` | `system` — mirrors the ticket's own vocabulary. */
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_support_ticket_events_ticket').on(t.ticketId, t.createdAt)],
);

/**
 * W15 — FAQ and legal pages (§9.4.12; ToBeDoneEhsan D-v). The customer app
 * still ships hardcoded FAQs and dead legal links; this table is what replaces
 * both with content an operator can edit without a release.
 *
 * `body_md` is authored as markdown but rendered as whitespace-preserved text
 * by every consumer today — no console or app in this repo ships a markdown
 * renderer, and inventing one to render six FAQs would be a dependency for
 * nothing. The column name is the contract's promise, not a rendering claim.
 */
export const contentPages = pgTable(
  'content_pages',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    /** `faq` | `legal`, CHECK-pinned. */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    bodyMd: text('body_md').notNull(),
    locale: text('locale').notNull().default('en'),
    isPublished: boolean('is_published').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedBy: uuid('updated_by').references(() => adminUsers.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('uq_content_pages_slug').on(t.slug),
    index('idx_content_pages_kind_order').on(t.kind, t.sortOrder),
  ],
);
