import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  rupeeStringToPaise,
  type AdminDispute,
  type AdminDisputeBooking,
  type AdminDisputesQuery,
  type DisputeEvidenceKind,
  type DisputeLiability,
  type DisputeOpenedByType,
  type DisputeReasonCode,
  type DisputeResolution,
  type DisputeStatus,
  type JobStatus,
} from '@towing/api-contracts';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';

/**
 * W8's dispute reads and writes (migration 0025).
 *
 * The queue row carries the booking context the list renders (`code`, status,
 * who, how much) because a disputes queue that shows dispute ids beside
 * bookkeeping columns nobody can interpret is a queue nobody works. The detail
 * adds the evidence.
 */

export interface DisputeRow {
  id: string;
  bookingId: string;
  status: DisputeStatus;
  reasonCode: DisputeReasonCode;
  description: string;
  openedByType: DisputeOpenedByType;
  openedById: string | null;
  openedFromStatus: JobStatus;
  assignedAdminId: string | null;
  resolution: DisputeResolution | null;
  liability: DisputeLiability | null;
  refundId: string | null;
  refundAmount: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisputeDetailRow extends DisputeRow {
  userId: string;
  driverId: string | null;
}

/** One evidence row as stored — `fileKey` becomes a presigned URL in the service. */
export interface DisputeEvidenceRow {
  id: string;
  kind: DisputeEvidenceKind;
  note: string | null;
  uploadedByType: DisputeOpenedByType;
  uploadedById: string | null;
  createdAt: string;
  fileKey: string;
}

@Injectable()
export class AdminDisputesRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * `POST /admin/bookings/:id/dispute`'s insert, INSIDE the caller's
   * transaction (the booking's `→ disputed` transition commits with it or not
   * at all). The partial unique index is the backstop; the service turns its
   * violation into a 409.
   */
  async insert(
    params: {
      bookingId: string;
      adminId: string;
      reasonCode: DisputeReasonCode;
      description: string;
      openedFromStatus: JobStatus;
    },
    tx: DatabaseExecutor = this.db,
  ): Promise<{ id: string }> {
    const rows = (await tx.execute(sql`
      insert into disputes (booking_id, opened_by_type, opened_by_id, reason_code, description,
                            status, opened_from_status)
      values (${params.bookingId}::uuid, 'admin', ${params.adminId}::uuid,
              ${params.reasonCode}, ${params.description}, 'open', ${params.openedFromStatus})
      returning id
    `)) as unknown as Array<{ id: string }>;
    return rows[0]!;
  }

  async queue(params: { query: AdminDisputesQuery; limit: number; offset: number }): Promise<{
    items: AdminDispute[];
    total: number;
  }> {
    const filters: SQL[] = [];
    if (params.query.status) filters.push(sql`d.status = ${params.query.status}`);
    if (params.query.assignedAdminId) {
      filters.push(sql`d.assigned_admin_id = ${params.query.assignedAdminId}::uuid`);
    }
    if (params.query.reasonCode) filters.push(sql`d.reason_code = ${params.query.reasonCode}`);
    const where = filters.length > 0 ? sql.join(filters, sql` and `) : sql`true`;

    const rows = (await this.db.execute(sql`
      select d.*, a.name as assigned_admin_name,
             b.status as booking_status, b.total::text as booking_total,
             b.created_at as booking_created_at,
             u.name as customer_name, dr.name as driver_name,
             count(*) over() as total_count
        from disputes d
        join bookings b on b.id = d.booking_id
        join users u on u.id = b.user_id
        left join drivers dr on dr.id = b.driver_id
        left join admin_users a on a.id = d.assigned_admin_id
       where ${where}
       order by d.created_at desc, d.id desc
       limit ${params.limit} offset ${params.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      items: rows.map((row) => this.disputeOf(row)),
      total: rows[0] ? Number(rows[0].total_count) : 0,
    };
  }

  async byId(disputeId: string): Promise<DisputeDetailRow | null> {
    const [row] = (await this.db.execute(sql`
      select d.*, b.user_id, b.driver_id
        from disputes d
        join bookings b on b.id = d.booking_id
       where d.id = ${disputeId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    if (!row) return null;

    return {
      id: row.id as string,
      bookingId: row.booking_id as string,
      status: row.status as DisputeStatus,
      reasonCode: row.reason_code as DisputeReasonCode,
      description: row.description as string,
      openedByType: row.opened_by_type as DisputeOpenedByType,
      openedById: (row.opened_by_id as string | null) ?? null,
      openedFromStatus: row.opened_from_status as JobStatus,
      assignedAdminId: (row.assigned_admin_id as string | null) ?? null,
      resolution: (row.resolution as DisputeResolution | null) ?? null,
      liability: (row.liability as DisputeLiability | null) ?? null,
      refundId: (row.refund_id as string | null) ?? null,
      refundAmount: (row.refund_amount as string | null) ?? null,
      resolutionNote: (row.resolution_note as string | null) ?? null,
      resolvedBy: (row.resolved_by as string | null) ?? null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      userId: row.user_id as string,
      driverId: (row.driver_id as string | null) ?? null,
    };
  }

  /** The dispute with its evidence — the service maps this to the contract. */
  async detail(
    disputeId: string,
  ): Promise<{ dispute: AdminDispute; evidence: DisputeEvidenceRow[] } | null> {
    const [row] = (await this.db.execute(sql`
      select d.*, a.name as assigned_admin_name,
             b.status as booking_status, b.total::text as booking_total,
             b.created_at as booking_created_at,
             u.name as customer_name, dr.name as driver_name
        from disputes d
        join bookings b on b.id = d.booking_id
        join users u on u.id = b.user_id
        left join drivers dr on dr.id = b.driver_id
        left join admin_users a on a.id = d.assigned_admin_id
       where d.id = ${disputeId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    if (!row) return null;

    return { dispute: this.disputeOf(row), evidence: await this.evidence(disputeId) };
  }

  private disputeOf(row: Record<string, unknown>): AdminDispute {
    const booking: AdminDisputeBooking = {
      id: row.booking_id as string,
      code: `TW-${(row.booking_id as string).slice(0, 8).toUpperCase()}`,
      status: row.booking_status as JobStatus,
      totalPaise: rupeeStringToPaise(row.booking_total as string),
      customerName: (row.customer_name as string | null) ?? null,
      driverName: (row.driver_name as string | null) ?? null,
      createdAt: new Date(row.booking_created_at as string).toISOString(),
    };

    return {
      id: row.id as string,
      bookingId: row.booking_id as string,
      status: row.status as DisputeStatus,
      reasonCode: row.reason_code as DisputeReasonCode,
      description: row.description as string,
      openedByType: row.opened_by_type as DisputeOpenedByType,
      openedById: (row.opened_by_id as string | null) ?? null,
      openedFromStatus: row.opened_from_status as JobStatus,
      assignedAdminId: (row.assigned_admin_id as string | null) ?? null,
      assignedAdminName: (row.assigned_admin_name as string | null) ?? null,
      resolution: (row.resolution as DisputeResolution | null) ?? null,
      liability: (row.liability as DisputeLiability | null) ?? null,
      refundId: (row.refund_id as string | null) ?? null,
      refundAmountPaise:
        row.refund_amount === null ? null : rupeeStringToPaise(row.refund_amount as string),
      resolutionNote: (row.resolution_note as string | null) ?? null,
      resolvedBy: (row.resolved_by as string | null) ?? null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string).toISOString() : null,
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
      booking,
    };
  }

  /**
   * Evidence rows with their raw storage keys — the SERVICE turns the keys into
   * short-TTL presigned GETs, because the storage port lives there and the
   * contract must never carry a key that outlives the request it was read in.
   */
  async evidence(disputeId: string): Promise<DisputeEvidenceRow[]> {
    const rows = (await this.db.execute(sql`
      select id, kind, note, uploaded_by_type, uploaded_by_id, file_key, created_at
        from dispute_evidence
       where dispute_id = ${disputeId}::uuid
       order by created_at asc
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      kind: row.kind as DisputeEvidenceKind,
      note: (row.note as string | null) ?? null,
      uploadedByType: row.uploaded_by_type as DisputeOpenedByType,
      uploadedById: (row.uploaded_by_id as string | null) ?? null,
      createdAt: new Date(row.created_at as string).toISOString(),
      fileKey: row.file_key as string,
    }));
  }

  async insertEvidence(params: {
    disputeId: string;
    adminId: string;
    kind: DisputeEvidenceKind;
    fileKey: string;
    note: string | null;
  }): Promise<string> {
    const rows = (await this.db.execute(sql`
      insert into dispute_evidence (dispute_id, uploaded_by_type, uploaded_by_id, kind, file_key, note)
      values (${params.disputeId}::uuid, 'admin', ${params.adminId}::uuid,
              ${params.kind}, ${params.fileKey}, ${params.note})
      returning id
    `)) as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  }

  /** Assign — also advances `open` to `under_review`, because it has a reader now. */
  async assign(disputeId: string, adminId: string): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      update disputes
         set assigned_admin_id = ${adminId}::uuid,
             status = case when status = 'open' then 'under_review' else status end,
             updated_at = now()
       where id = ${disputeId}::uuid and status <> 'resolved'
      returning id
    `)) as unknown as Array<{ id: string }>;
    return rows.length > 0;
  }

  /**
   * The resolution write. Guarded on `<> 'resolved'` so a double-resolve race
   * leaves one winner; the loser's action is a replay or a 409 of its own (the
   * dispute-keyed refund replays, the transition refuses).
   */
  async markResolved(params: {
    disputeId: string;
    adminId: string;
    resolution: DisputeResolution;
    liability: DisputeLiability | null;
    refundId: string | null;
    refundAmount: string | null;
    note: string;
  }): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      update disputes
         set status = 'resolved',
             resolution = ${params.resolution},
             liability = ${params.liability},
             refund_id = ${params.refundId}::uuid,
             refund_amount = ${params.refundAmount}::numeric,
             resolution_note = ${params.note},
             resolved_by = ${params.adminId}::uuid,
             resolved_at = now(),
             updated_at = now()
       where id = ${params.disputeId}::uuid and status <> 'resolved'
      returning id
    `)) as unknown as Array<{ id: string }>;
    return rows.length > 0;
  }

  /** The refunded amount the dispute records — read back after a money exit. */
  async refundAmount(refundId: string): Promise<string | null> {
    const [row] = (await this.db.execute(sql`
      select amount::text as amount from refunds where id = ${refundId}::uuid
    `)) as unknown as Array<{ amount: string }>;
    return row?.amount ?? null;
  }

  /**
   * The `cancel_no_charge` exit's other half: an intent or authorization still
   * open at the gateway is FAILED, not left to settle into a booking the
   * platform just cancelled. Raw SQL rather than `PaymentsRepo.markFailed`
   * because the money module does not export the repo, and widening its export
   * surface for one UPDATE would make "who writes payments?" vaguer, not clearer.
   */
  async failPendingIntents(bookingId: string, reason: string): Promise<number> {
    const rows = (await this.db.execute(sql`
      update payments
         set status = 'failed', failure_reason = ${reason}, updated_at = now()
       where booking_id = ${bookingId}::uuid and status in ('pending', 'authorized')
      returning id
    `)) as unknown as Array<{ id: string }>;
    return rows.length;
  }

  /** Open disputes for the ops badge — wired in W8 so the number stops being 0. */
  async openCount(): Promise<number> {
    const [row] = (await this.db.execute(sql`
      select count(*)::int as count from disputes where status <> 'resolved'
    `)) as unknown as Array<{ count: number }>;
    return row?.count ?? 0;
  }
}
