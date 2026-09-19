import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  rupeeStringToPaise,
  type AdminDirectoryBooking,
  type AdminDirectoryUser,
  type AdminDirectoryUserDetail,
  type AdminSuspensionRequest,
} from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import { bookings, drivers, fleets, suspensionRequests, users } from '../../db/schema';

/**
 * W6's directory reads and suspension-request writes (§9.4.4).
 *
 * Search rules from the guide: TRIGRAM over names (the GIN indexes migration
 * 0024 installs), EXACT over mobiles, PREFIX over ids — one query, three
 * access paths, because an operator looks somebody up by whichever one they
 * have. ILIKE metacharacters in the probe are escaped: someone searching for
 * "100%" means the literal string, not "everything".
 */

export interface UserSearchParams {
  q?: string;
  status?: string;
  limit: number;
  offset: number;
}

export interface UserSearchResult {
  items: AdminDirectoryUser[];
  total: number;
}

export interface BookingListParams {
  userId: string;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminDirectoryRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** `users` row → the contract shape, one mapping for every read path. */
  private userOf(row: {
    id: string;
    name: string | null;
    mobile: string;
    email: string | null;
    status: string;
    suspended_at: Date | string | null;
    suspension_reason: string | null;
    created_at: Date | string;
  }): AdminDirectoryUser {
    return {
      id: row.id,
      name: row.name,
      mobile: row.mobile,
      email: row.email,
      status: row.status as AdminDirectoryUser['status'],
      suspendedAt: isoOrNull(row.suspended_at),
      suspensionReason: row.suspension_reason,
      createdAt: iso(row.created_at),
    };
  }

  async searchUsers(params: UserSearchParams): Promise<UserSearchResult> {
    const filters: SQL[] = [];
    if (params.status) filters.push(sql`status::text = ${params.status}`);
    if (params.q) {
      const q = params.q;
      const like = `%${escapeLike(q)}%`;
      const prefix = `${escapeLike(q)}%`;
      filters.push(sql`(name ILIKE ${like} OR mobile = ${q} OR id::text ILIKE ${prefix})`);
    }
    const where: SQL = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``;

    const rows = (await this.db.execute(sql`
      select id, name, mobile, email, status::text as status,
             suspended_at, suspension_reason, created_at,
             count(*) over() as total
      from users
      ${where}
      order by name asc nulls last, id asc
      limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<{
      id: string;
      name: string | null;
      mobile: string;
      email: string | null;
      status: string;
      suspended_at: Date | string | null;
      suspension_reason: string | null;
      created_at: Date | string;
      total: number | string;
    }>;

    return {
      items: rows.map((row) => this.userOf(row)),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }

  /** Profile plus the one stat the header shows; 404 is the service's call. */
  async userDetail(userId: string): Promise<AdminDirectoryUserDetail | undefined> {
    const rows = (await this.db.execute(sql`
      select u.id, u.name, u.mobile, u.email, u.status::text as status,
             u.suspended_at, u.suspension_reason, u.created_at,
             (select count(*) from bookings b where b.user_id = u.id)::int as bookings_count
      from users u
      where u.id = ${userId}::uuid
    `)) as unknown as Array<{
      id: string;
      name: string | null;
      mobile: string;
      email: string | null;
      status: string;
      suspended_at: Date | string | null;
      suspension_reason: string | null;
      created_at: Date | string;
      bookings_count: number;
    }>;

    const row = rows[0];
    if (!row) return undefined;
    return { ...this.userOf(row), bookingsCount: row.bookings_count };
  }

  /** The user's trips, newest first, over the W6 bookings list indexes. */
  async userBookings(
    params: BookingListParams,
  ): Promise<{ items: AdminDirectoryBooking[]; total: number }> {
    const rows = (await this.db.execute(sql`
      select b.id, b.status::text as status, b.service_type::text as service_type,
             b.zone_id, b.driver_id, b.total, b.created_at, b.updated_at,
             count(*) over() as total_count
      from bookings b
      where b.user_id = ${params.userId}::uuid
      order by b.created_at desc, b.id desc
      limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<{
      id: string;
      status: string;
      service_type: string;
      zone_id: string | null;
      driver_id: string | null;
      total: string;
      created_at: Date | string;
      updated_at: Date | string;
      total_count: number | string;
    }>;

    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status as AdminDirectoryBooking['status'],
        serviceType: row.service_type,
        zoneId: row.zone_id,
        driverId: row.driver_id,
        totalPaise: rupeeStringToPaise(row.total),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
      total: rows[0] ? Number(rows[0].total_count) : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Suspension requests
  // -------------------------------------------------------------------------

  async insertSuspensionRequest(entry: {
    subjectType: string;
    subjectId: string;
    requestedBy: string;
    reason: string;
  }): Promise<AdminSuspensionRequest> {
    const [row] = await this.db.insert(suspensionRequests).values(entry).returning();
    return requestOf(row!);
  }

  async listSuspensionRequests(status: string): Promise<AdminSuspensionRequest[]> {
    const rows = await this.db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.status, status))
      .orderBy(desc(suspensionRequests.createdAt))
      .limit(200);
    return rows.map(requestOf);
  }

  async suspensionRequest(id: string): Promise<AdminSuspensionRequest | undefined> {
    const [row] = await this.db
      .select()
      .from(suspensionRequests)
      .where(eq(suspensionRequests.id, id))
      .limit(1);
    return row ? requestOf(row) : undefined;
  }

  async decideSuspensionRequest(
    id: string,
    decision: { status: 'approved' | 'rejected'; decidedBy: string; note: string | null },
  ): Promise<void> {
    await this.db
      .update(suspensionRequests)
      .set({
        status: decision.status,
        decidedBy: decision.decidedBy,
        decidedAt: new Date(),
        decisionNote: decision.note,
      })
      .where(and(eq(suspensionRequests.id, id), eq(suspensionRequests.status, 'open')));
  }

  /**
   * The request target must exist — a typo'd id would otherwise become an
   * unactionable row in the inbox. One switch, three existence probes.
   */
  async subjectExists(subjectType: string, subjectId: string): Promise<boolean> {
    const table = subjectType === 'user' ? users : subjectType === 'driver' ? drivers : fleets;
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, subjectId))
      .limit(1);
    return Boolean(row);
  }

  /** The badge's source: open requests only. */
  async openSuspensionRequestCount(): Promise<number> {
    const rows = (await this.db.execute(sql`
      select count(*)::int as n from suspension_requests where status = 'open'
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }
}

function requestOf(row: typeof suspensionRequests.$inferSelect): AdminSuspensionRequest {
  return {
    id: row.id,
    subjectType: row.subjectType as AdminSuspensionRequest['subjectType'],
    subjectId: row.subjectId,
    reason: row.reason,
    status: row.status as AdminSuspensionRequest['status'],
    requestedBy: row.requestedBy,
    createdAt: iso(row.createdAt),
    decidedBy: row.decidedBy,
    decidedAt: isoOrNull(row.decidedAt),
    decisionNote: row.decisionNote,
  };
}

/** ILIKE metacharacters escaped so "100%" searches for the literal string. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}
