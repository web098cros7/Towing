import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type {
  AdminSupportMessage,
  AdminSupportTicket,
  AdminSupportTicketEvent,
  AdminSupportTicketsQuery,
  SupportTicketDetail,
  SupportTicketMessage,
  SupportTicketSummary,
  SupportTicketsQuery,
} from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import { adminUsers } from '../../db/schema/admin';
import { bookings } from '../../db/schema/bookings';
import { drivers } from '../../db/schema/drivers';
import { fleets } from '../../db/schema/fleets';
import {
  supportTicketEvents,
  supportTicketMessages,
  supportTickets,
} from '../../db/schema/support';
import { users } from '../../db/schema/users';
import { bookingCode } from '../sos/sos.repo';

/** Who is asking — derived from the JWT realm, never from the body. */
export interface TicketRequester {
  requesterType: 'user' | 'driver' | 'fleet';
  requesterId: string;
}

export interface RequesterIdentity {
  name: string | null;
  mobile: string | null;
}

/**
 * Reads over the four W15 tables plus the polymorphic joins the console needs.
 *
 * THE INTERNAL-NOTE FILTER LIVES HERE, in SQL: `messagesFor` takes
 * `includeInternal` and the requester path always passes `false`. A requester
 * payload therefore cannot contain an internal note even if a future service
 * method forgets to think about it — the row never leaves the database.
 */
@Injectable()
export class SupportRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  // -------------------------------------------------------------------------
  // Subjects
  // -------------------------------------------------------------------------

  /** Resolves a requester to a display identity, per subject type. */
  async findRequester(requester: TicketRequester): Promise<RequesterIdentity | null> {
    if (requester.requesterType === 'user') {
      const [row] = await this.db
        .select({ name: users.name, mobile: users.mobile })
        .from(users)
        .where(eq(users.id, requester.requesterId))
        .limit(1);
      return row ?? null;
    }

    if (requester.requesterType === 'driver') {
      const [row] = await this.db
        .select({ name: drivers.name, mobile: drivers.mobile })
        .from(drivers)
        .where(eq(drivers.id, requester.requesterId))
        .limit(1);
      return row ?? null;
    }

    // A fleet's contact is its owner — `fleets` has no phone of its own.
    const [row] = await this.db
      .select({ name: fleets.businessName, mobile: users.mobile })
      .from(fleets)
      .innerJoin(users, eq(users.id, fleets.ownerId))
      .where(eq(fleets.id, requester.requesterId))
      .limit(1);
    return row ?? null;
  }

  /** A booking the requester owns, in any status — the link's security check. */
  /**
   * The requester's booking, and when its trip happened, or null when it is
   * not theirs. "When" is when it finished, else when it was booked for, else
   * when it was booked: the moment a customer could first have noticed a
   * problem with it.
   */
  async findOwnedBooking(
    requester: TicketRequester,
    bookingId: string,
  ): Promise<{ tripAt: Date } | null> {
    const ownerFilter =
      requester.requesterType === 'user'
        ? eq(bookings.userId, requester.requesterId)
        : requester.requesterType === 'driver'
          ? eq(bookings.driverId, requester.requesterId)
          : eq(bookings.fleetId, requester.requesterId);

    const [row] = await this.db
      .select({
        completedAt: bookings.completedAt,
        scheduledAt: bookings.scheduledAt,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), ownerFilter))
      .limit(1);
    if (!row) return null;
    return { tripAt: row.completedAt ?? row.scheduledAt ?? row.createdAt };
  }

  // -------------------------------------------------------------------------
  // Requester reads
  // -------------------------------------------------------------------------

  async listForRequester(
    requester: TicketRequester,
    query: SupportTicketsQuery,
  ): Promise<{ items: SupportTicketSummary[]; total: number }> {
    const where = and(
      eq(supportTickets.requesterType, requester.requesterType),
      eq(supportTickets.requesterId, requester.requesterId),
      query.status ? eq(supportTickets.status, query.status) : undefined,
    );

    const rows = await this.db
      .select(this.summaryColumns())
      .from(supportTickets)
      .where(where)
      .orderBy(desc(supportTickets.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportTickets)
      .where(where);

    return { items: rows.map((row) => this.toSummary(row)), total: countRow?.count ?? 0 };
  }

  async requesterDetail(
    requester: TicketRequester,
    ticketId: string,
  ): Promise<SupportTicketDetail | null> {
    const [row] = await this.db
      .select(this.summaryColumns())
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.id, ticketId),
          eq(supportTickets.requesterType, requester.requesterType),
          eq(supportTickets.requesterId, requester.requesterId),
        ),
      )
      .limit(1);
    if (!row) return null;

    const messages = await this.messagesFor(ticketId, false);
    return {
      ...this.toSummary(row),
      requesterType: row.requesterType as SupportTicketDetail['requesterType'],
      messages: messages.map((message) => ({
        id: message.id,
        authorType: message.authorType,
        authorName: message.authorName,
        body: message.body,
        attachments: message.attachments,
        createdAt: message.createdAt,
      })),
    };
  }

  /** THE filter: `includeInternal` false is the requester path, always. */
  async messagesFor(ticketId: string, includeInternal: boolean): Promise<AdminSupportMessage[]> {
    const rows = await this.db
      .select({
        id: supportTicketMessages.id,
        authorType: supportTicketMessages.authorType,
        authorId: supportTicketMessages.authorId,
        body: supportTicketMessages.body,
        visibility: supportTicketMessages.visibility,
        attachments: supportTicketMessages.attachments,
        createdAt: supportTicketMessages.createdAt,
      })
      .from(supportTicketMessages)
      .where(
        includeInternal
          ? eq(supportTicketMessages.ticketId, ticketId)
          : and(
              eq(supportTicketMessages.ticketId, ticketId),
              eq(supportTicketMessages.visibility, 'public'),
            ),
      )
      .orderBy(asc(supportTicketMessages.createdAt));

    const names = await this.adminNames(
      rows.map((row) => row.authorId).filter((id): id is string => id !== null),
    );

    return rows.map((row) => ({
      id: row.id,
      authorType: row.authorType as AdminSupportMessage['authorType'],
      authorId: row.authorId,
      authorName: row.authorId ? (names.get(row.authorId) ?? null) : null,
      body: row.body,
      visibility: row.visibility as AdminSupportMessage['visibility'],
      attachments: (row.attachments ?? []) as string[],
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async eventsFor(ticketId: string): Promise<AdminSupportTicketEvent[]> {
    const rows = await this.db
      .select()
      .from(supportTicketEvents)
      .where(eq(supportTicketEvents.ticketId, ticketId))
      .orderBy(asc(supportTicketEvents.createdAt));

    const names = await this.adminNames(
      rows.map((row) => row.actorId).filter((id): id is string => id !== null),
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as AdminSupportTicketEvent['kind'],
      actorType: row.actorType as AdminSupportTicketEvent['actorType'],
      actorId: row.actorId,
      actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
      data: (row.data ?? null) as Record<string, unknown> | null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // Admin reads
  // -------------------------------------------------------------------------

  async listForAdmin(
    query: AdminSupportTicketsQuery,
  ): Promise<{ items: AdminSupportTicket[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.open) {
      // "Open" for a support queue is everything that is not finished.
      conditions.push(notInArray(supportTickets.status, ['resolved', 'closed']));
    } else if (query.status) {
      conditions.push(eq(supportTickets.status, query.status));
    }
    if (query.priority) conditions.push(eq(supportTickets.priority, query.priority));
    if (query.category) conditions.push(eq(supportTickets.category, query.category));
    if (query.requesterType) conditions.push(eq(supportTickets.requesterType, query.requesterType));
    if (query.assignedAdminId) {
      conditions.push(eq(supportTickets.assignedAdminId, query.assignedAdminId));
    }
    if (query.from) {
      conditions.push(
        sql`${supportTickets.createdAt} >= (${query.from}::date::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    if (query.to) {
      conditions.push(
        sql`${supportTickets.createdAt} < ((${query.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select(this.adminColumns())
      .from(supportTickets)
      .leftJoin(
        users,
        and(eq(users.id, supportTickets.requesterId), eq(supportTickets.requesterType, 'user')),
      )
      .leftJoin(
        drivers,
        and(eq(drivers.id, supportTickets.requesterId), eq(supportTickets.requesterType, 'driver')),
      )
      .leftJoin(
        fleets,
        and(eq(fleets.id, supportTickets.requesterId), eq(supportTickets.requesterType, 'fleet')),
      )
      // LEFT: a ticket does not need a booking (only §6.6's "get help" path
      // attaches one), and an inner join would silently drop the rest.
      .leftJoin(bookings, eq(bookings.id, supportTickets.bookingId))
      .where(where)
      .orderBy(desc(supportTickets.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportTickets)
      .where(where);

    return { items: await this.toAdminRows(rows), total: countRow?.count ?? 0 };
  }

  async adminDetail(ticketId: string): Promise<AdminSupportTicket | null> {
    const rows = await this.db
      .select(this.adminColumns())
      .from(supportTickets)
      .leftJoin(
        users,
        and(eq(users.id, supportTickets.requesterId), eq(supportTickets.requesterType, 'user')),
      )
      .leftJoin(
        drivers,
        and(eq(drivers.id, supportTickets.requesterId), eq(supportTickets.requesterType, 'driver')),
      )
      .leftJoin(
        fleets,
        and(eq(fleets.id, supportTickets.requesterId), eq(supportTickets.requesterType, 'fleet')),
      )
      .leftJoin(bookings, eq(bookings.id, supportTickets.bookingId))
      .where(eq(supportTickets.id, ticketId))
      .limit(1);

    const [row] = rows;
    if (!row) return null;
    const [mapped] = await this.toAdminRows([row]);
    return mapped ?? null;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private summaryColumns() {
    return {
      id: supportTickets.id,
      reference: supportTickets.reference,
      requesterType: supportTickets.requesterType,
      category: supportTickets.category,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      bookingId: supportTickets.bookingId,
      firstResponseAt: supportTickets.firstResponseAt,
      resolvedAt: supportTickets.resolvedAt,
      closedAt: supportTickets.closedAt,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    };
  }

  private adminColumns() {
    return {
      ...this.summaryColumns(),
      requesterId: supportTickets.requesterId,
      userName: users.name,
      userMobile: users.mobile,
      driverName: drivers.name,
      driverMobile: drivers.mobile,
      fleetName: fleets.businessName,
      assignedAdminId: supportTickets.assignedAdminId,
    };
  }

  private toSummary(row: {
    id: string;
    reference: string;
    category: string;
    subject: string;
    status: string;
    priority: string;
    bookingId: string | null;
    firstResponseAt: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SupportTicketSummary {
    return {
      id: row.id,
      reference: row.reference,
      category: row.category as SupportTicketSummary['category'],
      subject: row.subject,
      status: row.status as SupportTicketSummary['status'],
      priority: row.priority as SupportTicketSummary['priority'],
      bookingId: row.bookingId,
      firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async toAdminRows(
    rows: Array<{
      id: string;
      reference: string;
      requesterType: string;
      requesterId: string;
      category: string;
      subject: string;
      status: string;
      priority: string;
      bookingId: string | null;
      firstResponseAt: Date | null;
      resolvedAt: Date | null;
      closedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      userName: string | null;
      userMobile: string | null;
      driverName: string | null;
      driverMobile: string | null;
      fleetName: string | null;
      assignedAdminId: string | null;
    }>,
  ): Promise<AdminSupportTicket[]> {
    const adminIds = rows
      .map((row) => row.assignedAdminId)
      .filter((id): id is string => id !== null);
    const names = await this.adminNames(adminIds);

    return rows.map((row) => {
      const isUser = row.requesterType === 'user';
      const isDriver = row.requesterType === 'driver';
      return {
        ...this.toSummary(row),
        requesterType: row.requesterType as AdminSupportTicket['requesterType'],
        requesterId: row.requesterId,
        requesterName: isUser
          ? row.userName
          : isDriver
            ? row.driverName
            : (row.fleetName ?? 'Fleet'),
        requesterMobile: isUser ? row.userMobile : isDriver ? row.driverMobile : null,
        bookingCode: row.bookingId ? bookingCode(row.bookingId) : null,
        assignedAdminId: row.assignedAdminId,
        assignedAdminName: row.assignedAdminId ? (names.get(row.assignedAdminId) ?? null) : null,
      };
    });
  }

  private async adminNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({ id: adminUsers.id, name: adminUsers.name })
      .from(adminUsers)
      .where(inArray(adminUsers.id, unique));
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
