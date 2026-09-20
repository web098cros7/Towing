import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { AdminContentPage, ContentPage, ContentPageKind } from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import { adminUsers } from '../../db/schema/admin';
import { contentPages } from '../../db/schema/support';

/**
 * W15's content reads. Two shapes over one table: the public one (published
 * only, ordered for display) and the console's (everything, with the author
 * and the lifecycle columns the editor needs).
 */
@Injectable()
export class ContentRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  async published(kind: ContentPageKind): Promise<ContentPage[]> {
    const rows = await this.db
      .select({
        slug: contentPages.slug,
        kind: contentPages.kind,
        title: contentPages.title,
        bodyMd: contentPages.bodyMd,
        locale: contentPages.locale,
        sortOrder: contentPages.sortOrder,
        updatedAt: contentPages.updatedAt,
      })
      .from(contentPages)
      .where(and(eq(contentPages.kind, kind), eq(contentPages.isPublished, true)))
      .orderBy(asc(contentPages.sortOrder), asc(contentPages.title));

    return rows.map((row) => ({
      slug: row.slug,
      kind: row.kind as ContentPage['kind'],
      title: row.title,
      bodyMd: row.bodyMd,
      locale: row.locale,
      sortOrder: row.sortOrder,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async listAll(kind?: ContentPageKind): Promise<AdminContentPage[]> {
    return this.selectPages(kind ? eq(contentPages.kind, kind) : undefined);
  }

  async bySlug(slug: string): Promise<AdminContentPage | null> {
    const rows = await this.selectPages(eq(contentPages.slug, slug));
    return rows[0] ?? null;
  }

  private async selectPages(where: SQL | undefined): Promise<AdminContentPage[]> {
    const rows = await this.db
      .select({
        slug: contentPages.slug,
        kind: contentPages.kind,
        title: contentPages.title,
        bodyMd: contentPages.bodyMd,
        locale: contentPages.locale,
        isPublished: contentPages.isPublished,
        sortOrder: contentPages.sortOrder,
        updatedBy: contentPages.updatedBy,
        updatedByName: adminUsers.name,
        createdAt: contentPages.createdAt,
        updatedAt: contentPages.updatedAt,
      })
      .from(contentPages)
      .leftJoin(adminUsers, eq(adminUsers.id, contentPages.updatedBy))
      .where(where)
      .orderBy(asc(contentPages.kind), asc(contentPages.sortOrder), asc(contentPages.title));

    return rows.map((row) => ({
      slug: row.slug,
      kind: row.kind as AdminContentPage['kind'],
      title: row.title,
      bodyMd: row.bodyMd,
      locale: row.locale,
      isPublished: row.isPublished,
      sortOrder: row.sortOrder,
      updatedBy: row.updatedBy,
      updatedByName: row.updatedByName ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** The raw row for the audit `before` snapshot — null when it does not exist yet. */
  async rawBySlug(slug: string): Promise<Record<string, unknown> | null> {
    const rows = (await this.db.execute(sql`
      select slug, kind, title, body_md, locale, is_published, sort_order
      from content_pages where slug = ${slug}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  }
}
