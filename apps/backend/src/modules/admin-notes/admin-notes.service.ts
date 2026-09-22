import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminCreateNote,
  type AdminNote,
  type AdminNotesQuery,
  type AdminNotesResponse,
  type AdminSubRole,
  type AdminUpdateNote,
} from '@towing/api-contracts';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { adminNotes } from '../../db/schema';
import { canReadSubject } from '../admin-audit/subject-access';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';

/** The caller, as far as note visibility cares. */
export interface NotesViewer {
  id: string;
  subRole: AdminSubRole;
}

/**
 * Admin notes on any subject (W21, §9.4.4).
 *
 * Two rules, and everything else follows from them:
 *
 *  1. A note is only reachable through a subject its reader may read
 *     (`subject-access.ts`, shared with the audit viewer). Support writes
 *     driver notes; support cannot write payout notes because it holds
 *     neither `finance.read` nor that screen.
 *  2. A note may be EDITED and DELETED by its author, or by a super admin.
 *     Anyone who may read the subject can READ all its notes — the point of a
 *     shared panel is that the next operator sees what the last one wrote.
 *
 * Every write is audited through `AdminAuditService`, the sole writer of
 * `admin_actions`; deletes are SOFT (`deleted_at`), because "who wrote this
 * and who removed it" is exactly the question notes exist to answer.
 */
@Injectable()
export class AdminNotesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
  ) {}

  async list(viewer: NotesViewer, query: AdminNotesQuery): Promise<AdminNotesResponse> {
    this.assertSubjectReadable(viewer, query.subjectType);

    const rows = await this.db
      .select()
      .from(adminNotes)
      .where(
        and(
          eq(adminNotes.subjectType, query.subjectType),
          eq(adminNotes.subjectId, query.subjectId),
          isNull(adminNotes.deletedAt),
        ),
      )
      // Pinned first, then newest. `desc(pinned)` works because Postgres
      // orders booleans false < true.
      .orderBy(desc(adminNotes.pinned), desc(adminNotes.createdAt));

    return { notes: rows.map(toNote) };
  }

  async create(
    viewer: NotesViewer,
    input: AdminCreateNote,
    context: SessionContext,
  ): Promise<AdminNote> {
    this.assertSubjectReadable(viewer, input.subjectType);

    const [row] = await this.db
      .insert(adminNotes)
      .values({
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        adminId: viewer.id,
        body: input.body,
        pinned: input.pinned ?? false,
      })
      .returning();

    await this.audit.record({
      adminId: viewer.id,
      action: 'admin.note.create',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      after: { noteId: row!.id, body: row!.body, pinned: row!.pinned },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return toNote(row!);
  }

  async update(
    viewer: NotesViewer,
    id: string,
    input: AdminUpdateNote,
    context: SessionContext,
  ): Promise<AdminNote> {
    const existing = await this.loadActive(id);
    this.assertCanEdit(viewer, existing.adminId);

    const [row] = await this.db
      .update(adminNotes)
      .set({
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        updatedAt: new Date(),
      })
      .where(eq(adminNotes.id, id))
      .returning();

    await this.audit.record({
      adminId: viewer.id,
      action: 'admin.note.update',
      subjectType: existing.subjectType,
      subjectId: existing.subjectId,
      before: { noteId: id, body: existing.body, pinned: existing.pinned },
      after: { noteId: id, body: row!.body, pinned: row!.pinned },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return toNote(row!);
  }

  async remove(viewer: NotesViewer, id: string, context: SessionContext): Promise<void> {
    const existing = await this.loadActive(id);
    this.assertCanEdit(viewer, existing.adminId);

    const now = new Date();
    await this.db
      .update(adminNotes)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(adminNotes.id, id));

    await this.audit.record({
      adminId: viewer.id,
      action: 'admin.note.delete',
      subjectType: existing.subjectType,
      subjectId: existing.subjectId,
      before: { noteId: id, body: existing.body, pinned: existing.pinned },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  /** A soft-deleted note is GONE for every purpose outside the audit trail. */
  private async loadActive(id: string): Promise<typeof adminNotes.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(adminNotes)
      .where(and(eq(adminNotes.id, id), isNull(adminNotes.deletedAt)))
      .limit(1);

    if (!row) throw ApiException.notFound('Note not found');
    return row;
  }

  private assertSubjectReadable(viewer: NotesViewer, subjectType: string): void {
    if (viewer.subRole === 'super_admin') return;
    if (!canReadSubject(viewer.subRole, subjectType)) {
      throw ApiException.forbidden('You do not have access to this subject');
    }
  }

  private assertCanEdit(viewer: NotesViewer, authorId: string): void {
    if (authorId !== viewer.id && viewer.subRole !== 'super_admin') {
      throw ApiException.forbidden('Only the author or a super admin may change a note');
    }
  }
}

function toNote(row: typeof adminNotes.$inferSelect): AdminNote {
  return {
    id: row.id,
    subjectType: row.subjectType as AdminNote['subjectType'],
    subjectId: row.subjectId,
    adminId: row.adminId,
    body: row.body,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
