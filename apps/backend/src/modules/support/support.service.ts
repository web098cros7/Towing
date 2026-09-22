import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  SUPPORT_STATUS_TRANSITIONS,
  type AdminSupportAssignBody,
  type AdminSupportLinkBookingBody,
  type AdminSupportNoteBody,
  type AdminSupportReplyBody,
  type AdminSupportStatusBody,
  type AdminSupportTicket,
  type AdminSupportTicketDetail,
  type AdminSupportTicketsQuery,
  type AdminSupportTicketsResponse,
  type SupportTicketCreateRequest,
  type SupportTicketCreateResponse,
  type SupportTicketDetail,
  type SupportTicketMessageCreate,
  type SupportTicketsQuery,
  type SupportTicketsResponse,
} from '@towing/api-contracts';
import { randomUUID } from 'node:crypto';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { NotificationService } from '../../common/notifications/notification.service';
import { keyFromFileUrl } from '../../common/storage/file-url';
import { PresignedUploadService } from '../../common/storage/presigned-upload.helper';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import { DB, type Database } from '../../db/db.module';
import {
  supportTicketEvents,
  supportTicketMessages,
  supportTickets,
} from '../../db/schema/support';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { SupportRepo, type TicketRequester } from './support.repo';

/** Storage key prefix for ticket-message photo attachments. */
export const SUPPORT_ATTACHMENT_KEY_PREFIX = 'support-attachments';

/**
 * W15's support tickets (§9.4.12, §6.6).
 *
 * THREE RULES THE IMPLEMENTATION ENFORCES, in order of how easy they are to
 * get wrong:
 *
 *  1. **A requester sees only their own tickets.** Every requester read is
 *     scoped by `(requester_type, requester_id)` from the JWT — the ownership
 *     check and the visibility rule are the same WHERE clause.
 *  2. **Internal notes never reach a requester payload.** The repository's
 *     `messagesFor(ticketId, includeInternal)` is the mechanism; this service
 *     never passes `true` on a requester path, and the e2e spec scans the
 *     responses to prove it.
 *  3. **Status moves only along the legal graph** (`SUPPORT_STATUS_TRANSITIONS`)
 *     and every move writes a `support_ticket_events` row plus an
 *     `admin_actions` audit entry.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: SupportRepo,
    private readonly notifications: NotificationService,
    private readonly audit: AdminAuditService,
    private readonly uploads: PresignedUploadService,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  // -------------------------------------------------------------------------
  // Requester rail
  // -------------------------------------------------------------------------

  /** Mints one upload slot for a ticket-message photo. */
  async presignAttachment(requester: TicketRequester) {
    return this.uploads.presign(
      SUPPORT_ATTACHMENT_KEY_PREFIX,
      requester.requesterId,
      'att',
    );
  }

  async create(
    requester: TicketRequester,
    body: SupportTicketCreateRequest,
  ): Promise<SupportTicketCreateResponse> {
    const identity = await this.repo.findRequester(requester);
    if (!identity) throw ApiException.notFound('Account not found');

    const checked = this.checkAttachments(requester, body.attachments);

    let bookingId: string | null = null;
    if (body.bookingId) {
      if (!(await this.repo.findOwnedBooking(requester, body.bookingId))) {
        throw ApiException.notFound('Booking not found');
      }
      bookingId = body.bookingId;
    }

    const created = await this.insertWithReference(async (tx, reference) => {
      const [ticket] = await tx
        .insert(supportTickets)
        .values({
          reference,
          requesterType: requester.requesterType,
          requesterId: requester.requesterId,
          bookingId,
          category: body.category,
          subject: body.subject,
          status: 'open',
          priority: 'normal',
        })
        .returning({ id: supportTickets.id, createdAt: supportTickets.createdAt });
      if (!ticket) throw new Error('support_tickets insert returned no row');

      await tx.insert(supportTicketMessages).values({
        ticketId: ticket.id,
        authorType: 'requester',
        authorId: requester.requesterId,
        body: body.body,
        visibility: 'public',
        attachments: checked,
      });

      await tx.insert(supportTicketEvents).values({
        ticketId: ticket.id,
        kind: 'created',
        actorType: 'requester',
        actorId: requester.requesterId,
        data: { category: body.category, bookingId },
      });

      return { id: ticket.id, reference, createdAt: ticket.createdAt };
    });

    return {
      ticketId: created.id,
      reference: created.reference,
      status: 'open',
      createdAt: created.createdAt.toISOString(),
    };
  }

  async listMine(
    requester: TicketRequester,
    query: SupportTicketsQuery,
  ): Promise<SupportTicketsResponse> {
    const { items, total } = await this.repo.listForRequester(requester, query);
    return { items, page: query.page, limit: query.limit, total };
  }

  async myDetail(requester: TicketRequester, ticketId: string): Promise<SupportTicketDetail> {
    const detail = await this.repo.requesterDetail(requester, ticketId);
    if (!detail) throw ApiException.notFound('Ticket not found');
    return this.signAttachments(detail);
  }

  /**
   * A requester reply. On `pending_requester` it moves the ticket back to
   * `in_progress` — the ball is with support again. On `resolved`/`closed` it
   * refuses: reopening is an operator decision, and a ticket that silently
   * un-resolves itself would falsify the SLA numbers it just fed.
   */
  async reply(
    requester: TicketRequester,
    ticketId: string,
    body: SupportTicketMessageCreate,
  ): Promise<SupportTicketDetail> {
    const ticket = await this.repo.requesterDetail(requester, ticketId);
    if (!ticket) throw ApiException.notFound('Ticket not found');
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      throw ApiException.conflict('This ticket is closed — raise a new one', {
        code: 'ticket_closed',
      });
    }

    const checked = this.checkAttachments(requester, body.attachments);

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(supportTicketMessages).values({
        ticketId,
        authorType: 'requester',
        authorId: requester.requesterId,
        body: body.body,
        visibility: 'public',
        attachments: checked,
      });
      await tx.insert(supportTicketEvents).values({
        ticketId,
        kind: 'message',
        actorType: 'requester',
        actorId: requester.requesterId,
        data: null,
      });
      if (ticket.status === 'pending_requester') {
        await tx
          .update(supportTickets)
          .set({ status: 'in_progress', updatedAt: now })
          .where(eq(supportTickets.id, ticketId));
        await tx.insert(supportTicketEvents).values({
          ticketId,
          kind: 'status_changed',
          actorType: 'system',
          actorId: null,
          data: { from: 'pending_requester', to: 'in_progress', via: 'requester_reply' },
        });
      }
    });

    return this.myDetail(requester, ticketId);
  }

  // -------------------------------------------------------------------------
  // Console rail
  // -------------------------------------------------------------------------

  async listForAdmin(query: AdminSupportTicketsQuery): Promise<AdminSupportTicketsResponse> {
    const { items, total } = await this.repo.listForAdmin(query);
    return { items, page: query.page, limit: query.limit, total };
  }

  async adminDetail(ticketId: string): Promise<AdminSupportTicketDetail> {
    const ticket = await this.repo.adminDetail(ticketId);
    if (!ticket) throw ApiException.notFound('Ticket not found');
    const [messages, events] = await Promise.all([
      this.repo.messagesFor(ticketId, true),
      this.repo.eventsFor(ticketId),
    ]);
    return this.signAttachments({ ...ticket, messages, events });
  }

  async assign(
    adminId: string,
    ticketId: string,
    body: AdminSupportAssignBody,
    context: SessionContext,
  ): Promise<AdminSupportTicketDetail> {
    const ticket = await this.requireTicket(ticketId);
    const assignee = body.adminId ?? adminId;

    await this.db.transaction(async (tx) => {
      await tx
        .update(supportTickets)
        .set({ assignedAdminId: assignee, updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
      await tx.insert(supportTicketEvents).values({
        ticketId,
        kind: 'assigned',
        actorType: 'admin',
        actorId: adminId,
        data: { from: ticket.assignedAdminId, to: assignee },
      });
    });

    await this.audit.record({
      adminId,
      action: 'ticket.assign',
      subjectType: 'support_ticket',
      subjectId: ticketId,
      before: { assignedAdminId: ticket.assignedAdminId },
      after: { assignedAdminId: assignee },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return this.adminDetail(ticketId);
  }

  async setStatus(
    adminId: string,
    ticketId: string,
    body: AdminSupportStatusBody,
    context: SessionContext,
  ): Promise<AdminSupportTicketDetail> {
    const ticket = await this.requireTicket(ticketId);
    this.assertTransition(ticket.status, body.status);

    const now = new Date();
    const patch: Partial<typeof supportTickets.$inferInsert> = {
      status: body.status,
      updatedAt: now,
    };
    if (body.priority) patch.priority = body.priority;
    // The stamps move WITH the status: a reopened ticket must stop counting as
    // resolved, and a re-resolved one gets a fresh clock rather than keeping
    // the first resolution's timestamp.
    if (body.status === 'resolved') patch.resolvedAt = now;
    else patch.resolvedAt = null;
    if (body.status === 'closed') patch.closedAt = now;
    else if (ticket.status === 'closed') patch.closedAt = null;

    await this.db.transaction(async (tx) => {
      await tx.update(supportTickets).set(patch).where(eq(supportTickets.id, ticketId));
      await tx.insert(supportTicketEvents).values({
        ticketId,
        kind: 'status_changed',
        actorType: 'admin',
        actorId: adminId,
        data: { from: ticket.status, to: body.status, note: body.note ?? null },
      });
      if (body.priority) {
        await tx.insert(supportTicketEvents).values({
          ticketId,
          kind: 'status_changed',
          actorType: 'admin',
          actorId: adminId,
          data: { priority: { from: ticket.priority, to: body.priority } },
        });
      }
    });

    await this.audit.record({
      adminId,
      action: 'ticket.status',
      subjectType: 'support_ticket',
      subjectId: ticketId,
      before: { status: ticket.status, priority: ticket.priority },
      after: { status: body.status, priority: body.priority ?? ticket.priority },
      reason: body.note ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    if (body.status === 'resolved') {
      await this.emitSafely('support.resolved', {
        ticketId,
        reference: ticket.reference,
        requesterType: ticket.requesterType,
        requesterId: ticket.requesterId,
        resolvedAt: now.toISOString(),
      });
    }

    return this.adminDetail(ticketId);
  }

  /**
   * A PUBLIC reply: it reaches the requester, it notifies them, and it stops
   * the first-response clock. `note` below is the other half of the toggle.
   */
  async adminReply(
    adminId: string,
    ticketId: string,
    body: AdminSupportReplyBody,
    context: SessionContext,
  ): Promise<AdminSupportTicketDetail> {
    const ticket = await this.requireTicket(ticketId);

    const messageId = await this.db.transaction(async (tx) => {
      const [message] = await tx
        .insert(supportTicketMessages)
        .values({
          ticketId,
          authorType: 'admin',
          authorId: adminId,
          body: body.body,
          visibility: 'public',
        })
        .returning({ id: supportTicketMessages.id });
      if (!message) throw new Error('support_ticket_messages insert returned no row');

      await tx.insert(supportTicketEvents).values({
        ticketId,
        kind: 'message',
        actorType: 'admin',
        actorId: adminId,
        data: { visibility: 'public' },
      });

      if (!ticket.firstResponseAt) {
        await tx
          .update(supportTickets)
          .set({ firstResponseAt: new Date(), updatedAt: new Date() })
          .where(eq(supportTickets.id, ticketId));
      }

      return message.id;
    });

    await this.audit.record({
      adminId,
      action: 'ticket.message',
      subjectType: 'support_ticket',
      subjectId: ticketId,
      after: { messageId, visibility: 'public' },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    await this.emitSafely('support.reply', {
      ticketId,
      reference: ticket.reference,
      requesterType: ticket.requesterType,
      requesterId: ticket.requesterId,
      messageId,
    });

    return this.adminDetail(ticketId);
  }

  /** An INTERNAL note: recorded, audited, and never notified. */
  async adminNote(
    adminId: string,
    ticketId: string,
    body: AdminSupportNoteBody,
    context: SessionContext,
  ): Promise<AdminSupportTicketDetail> {
    await this.requireTicket(ticketId);

    await this.db.transaction(async (tx) => {
      await tx.insert(supportTicketMessages).values({
        ticketId,
        authorType: 'admin',
        authorId: adminId,
        body: body.body,
        visibility: 'internal',
      });
      await tx.insert(supportTicketEvents).values({
        ticketId,
        kind: 'note',
        actorType: 'admin',
        actorId: adminId,
        data: { visibility: 'internal' },
      });
    });

    await this.audit.record({
      adminId,
      action: 'ticket.note',
      subjectType: 'support_ticket',
      subjectId: ticketId,
      after: { visibility: 'internal' },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return this.adminDetail(ticketId);
  }

  async linkBooking(
    adminId: string,
    ticketId: string,
    body: AdminSupportLinkBookingBody,
    context: SessionContext,
  ): Promise<AdminSupportTicketDetail> {
    const ticket = await this.requireTicket(ticketId);

    // The booking must exist; whose it is does not matter to an operator
    // reconciling a complaint ("the customer quoted a different trip").
    if (!(await this.bookingExists(body.bookingId))) {
      throw ApiException.notFound('Booking not found');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(supportTickets)
        .set({ bookingId: body.bookingId, updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
      await tx.insert(supportTicketEvents).values({
        ticketId,
        kind: 'linked_booking',
        actorType: 'admin',
        actorId: adminId,
        data: { bookingId: body.bookingId },
      });
    });

    await this.audit.record({
      adminId,
      action: 'ticket.link_booking',
      subjectType: 'support_ticket',
      subjectId: ticketId,
      before: { bookingId: ticket.bookingId },
      after: { bookingId: body.bookingId },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return this.adminDetail(ticketId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Every key must be one this requester minted via `presignAttachment` —
   * otherwise a caller could claim another subject's uploaded file by
   * replaying its key. Returns the stored form (`local://<key>`), deduped.
   */
  private checkAttachments(
    requester: TicketRequester,
    keys: string[] | undefined,
  ): string[] {
    if (!keys || keys.length === 0) return [];
    const unique = Array.from(new Set(keys));
    for (const key of unique) {
      if (
        !this.uploads.isOwnKey(
          key,
          SUPPORT_ATTACHMENT_KEY_PREFIX,
          requester.requesterId,
          'att',
        )
      ) {
        throw ApiException.forbidden('This attachment was not uploaded by you');
      }
    }
    return unique.map((key) => `local://${key}`);
  }

  /**
   * Swaps stored `local://<key>` attachment values for fetchable signed URLs
   * on the way out. Non-`local://` values pass through untouched.
   *
   * Generic over any detail shape carrying `messages[].attachments` so the
   * requester rail (`myDetail`) and the console rail (`adminDetail`) share one
   * implementation. Signed URLs last 1 hour.
   */
  private async signAttachments<T extends { messages: Array<{ attachments: string[] }> }>(
    detail: T,
  ): Promise<T> {
    const messages = await Promise.all(
      detail.messages.map(async (message) => {
        if (message.attachments.length === 0) return message;
        const attachments = await Promise.all(
          message.attachments.map(async (value) => {
            if (!value.startsWith('local://')) return value;
            const signed = await this.storage.presignGet(keyFromFileUrl(value), 3600);
            return signed.url;
          }),
        );
        return { ...message, attachments };
      }),
    );
    return { ...detail, messages };
  }

  private async requireTicket(ticketId: string): Promise<AdminSupportTicket> {
    const ticket = await this.repo.adminDetail(ticketId);
    if (!ticket) throw ApiException.notFound('Ticket not found');
    return ticket;
  }

  private assertTransition(from: string, to: string): void {
    const allowed = SUPPORT_STATUS_TRANSITIONS[from as keyof typeof SUPPORT_STATUS_TRANSITIONS];
    if (!allowed || !allowed.includes(to as never)) {
      throw ApiException.validation(`Cannot move a ticket from "${from}" to "${to}"`, {
        code: 'ticket_transition_invalid',
        from,
        to,
        allowed,
      });
    }
  }

  private async bookingExists(bookingId: string): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      select exists(select 1 from bookings where id = ${bookingId}::uuid) as exists
    `)) as unknown as Array<{ exists: boolean }>;
    return Boolean(rows[0]?.exists);
  }

  /**
   * `TKT-XXXXXXXX`, retried on the unique index. Random rather than a sequence
   * because the reference is quoted over the phone and printed on the app's
   * ticket card; a sequence would leak how busy support is and invite guessing
   * yesterday's numbers.
   */
  private async insertWithReference<T>(
    write: (tx: Database, reference: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const reference = `TKT-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      try {
        return await this.db.transaction((tx) => write(tx as unknown as Database, reference));
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new Error('could not allocate a unique ticket reference');
  }

  /** Best-effort, like every emit: the ticket is already durable. */
  private async emitSafely(event: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.notifications.emit(event, payload);
    } catch (error) {
      this.logger.error(
        `${event} emit failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
