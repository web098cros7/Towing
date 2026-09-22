import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  AdminContentPage,
  AdminContentPagesQuery,
  AdminContentPagesResponse,
  AdminContentUpsertBody,
  ContentPageKind,
  ContentPagesResponse,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { contentPages } from '../../db/schema/support';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';
import { ContentRepo } from './content.repo';

/**
 * W15's FAQ/legal content (§9.4.12; ToBeDoneEhsan D-v).
 *
 * The public read is the whole point of the table: the customer app currently
 * ships hardcoded FAQs and two dead legal links, and this is the surface that
 * lets an operator fix the copy without a store release. The admin write is an
 * UPSERT — creating a page and editing one are the same action on a slug — and
 * every write is audited with the full before/after row, because a legal page
 * is exactly the kind of content somebody will later ask "who changed this?".
 */
@Injectable()
export class ContentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: ContentRepo,
    private readonly audit: AdminAuditService,
  ) {}

  async published(kind: ContentPageKind): Promise<ContentPagesResponse> {
    return { items: await this.repo.published(kind) };
  }

  async adminList(query: AdminContentPagesQuery): Promise<AdminContentPagesResponse> {
    return { items: await this.repo.listAll(query.kind) };
  }

  async adminGet(slug: string): Promise<AdminContentPage> {
    const page = await this.repo.bySlug(slug);
    if (!page) throw ApiException.notFound('Content page not found');
    return page;
  }

  async upsert(
    adminId: string,
    slug: string,
    body: AdminContentUpsertBody,
    context: SessionContext,
  ): Promise<AdminContentPage> {
    const before = await this.repo.rawBySlug(slug);
    const now = new Date();

    await this.db
      .insert(contentPages)
      .values({
        slug,
        kind: body.kind,
        title: body.title,
        bodyMd: body.bodyMd,
        locale: body.locale ?? 'en',
        isPublished: body.isPublished,
        sortOrder: body.sortOrder,
        updatedBy: adminId,
      })
      .onConflictDoUpdate({
        target: contentPages.slug,
        set: {
          kind: body.kind,
          title: body.title,
          bodyMd: body.bodyMd,
          locale: body.locale ?? 'en',
          isPublished: body.isPublished,
          sortOrder: body.sortOrder,
          updatedBy: adminId,
          updatedAt: now,
        },
      });

    await this.audit.record({
      adminId,
      action: 'content.update',
      subjectType: 'content_page',
      subjectId: null,
      before,
      after: {
        slug,
        kind: body.kind,
        title: body.title,
        isPublished: body.isPublished,
        sortOrder: body.sortOrder,
      },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return this.adminGet(slug);
  }

  /** Exposed for the seed's "does this page exist" check without a second repo. */
  async exists(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: contentPages.id })
      .from(contentPages)
      .where(eq(contentPages.slug, slug))
      .limit(1);
    return Boolean(row);
  }
}
