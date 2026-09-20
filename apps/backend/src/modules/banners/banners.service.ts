import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminBanner,
  type AdminBannerCreate,
  type AdminBannerPresignResponse,
  type AdminBannersResponse,
  type AdminBannerUpdate,
  type BannerAudience,
  type BannerImageContentType,
  type PublicBannersResponse,
} from '@towing/api-contracts';
import { sql, type SQL } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import {
  PresignedUploadService,
  type PresignedExtension,
} from '../../common/storage/presigned-upload.helper';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import { DB, type Database } from '../../db/db.module';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import type { SessionContext } from '../auth/token.service';

/** Every banner image key lives under this prefix — see `PresignedUploadService`. */
export const BANNER_IMAGES_KEY_PREFIX = 'banner-images';

/** The image URL in an API response outlives the response by a coffee break, not a day. */
const PUBLIC_URL_TTL_SECONDS = 15 * 60;

/**
 * The extension follows the DECLARED CONTENT TYPE, not a client filename —
 * nothing free-form reaches the key.
 */
const EXTENSION_BY_CONTENT_TYPE: Record<BannerImageContentType, PresignedExtension> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

interface BannerRow {
  id: string;
  title: string;
  image_key: string;
  cta_link: string | null;
  cta_label: string | null;
  audience: BannerAudience;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  is_active: boolean;
  sort_order: number;
  created_at: string | Date;
  updated_at: string | Date;
}

/**
 * W16 — §9.4.11's banner manager.
 *
 * TWO READS, ONE WINDOW RULE. The console sees every banner (that is its
 * job); the public carousel sees only `is_active` rows inside their window,
 * in `sort_order` — the partial index `idx_banners_live` is exactly this
 * predicate. Both mint image URLs at read time from the stored key, so a
 * leaked response cannot be replayed against storage later.
 *
 * THE KEY IS VALIDATED AGAINST THE PRESIGN SHAPE on create and update
 * (`isMintedKey`), the same trust rule as every other upload path: the
 * signature proves a URL was not tampered with, not that the string a client
 * typed back belongs under the prefix it is stored against.
 */
@Injectable()
export class BannersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly uploads: PresignedUploadService,
    private readonly audit: AdminAuditService,
  ) {}

  /** `GET /v1/banners` — live banners for one audience, in carousel order. */
  async listPublic(audience: BannerAudience): Promise<PublicBannersResponse> {
    const rows = (await this.db.execute(sql`
      select id, title, image_key, cta_link, cta_label, audience
        from banners
       where is_active
         and audience = ${audience}
         and (starts_at is null or starts_at <= now())
         and (ends_at is null or ends_at > now())
       order by sort_order asc, created_at desc, id desc
    `)) as unknown as Array<Pick<BannerRow, 'id' | 'title' | 'image_key' | 'cta_link' | 'cta_label' | 'audience'>>;

    return {
      items: await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          title: row.title,
          imageUrl: (await this.storage.presignGet(row.image_key, PUBLIC_URL_TTL_SECONDS)).url,
          ctaLink: row.cta_link,
          ctaLabel: row.cta_label,
          audience: row.audience,
        })),
      ),
    };
  }

  async listAdmin(): Promise<AdminBannersResponse> {
    const rows = (await this.db.execute(sql`
      select * from banners
       order by audience asc, sort_order asc, created_at desc, id desc
    `)) as unknown as BannerRow[];

    return { items: await Promise.all(rows.map((row) => this.toBanner(row))) };
  }

  async create(
    adminId: string,
    body: AdminBannerCreate,
    context: SessionContext,
  ): Promise<AdminBanner> {
    this.assertMintedKey(body.imageKey);

    const rows = (await this.db.execute(sql`
      insert into banners
        (title, image_key, cta_link, cta_label, audience, starts_at, ends_at,
         is_active, sort_order, created_by)
      values (
        ${body.title},
        ${body.imageKey},
        ${body.ctaLink ?? null},
        ${body.ctaLabel ?? null},
        ${body.audience},
        ${body.startsAt ?? null}::timestamptz,
        ${body.endsAt ?? null}::timestamptz,
        ${body.isActive ?? true},
        ${body.sortOrder ?? 0},
        ${adminId}::uuid
      )
      returning id
    `)) as unknown as Array<{ id: string }>;

    const created = await this.get(rows[0]!.id);
    await this.audit.record({
      adminId,
      action: 'banner.create',
      subjectType: 'banner',
      subjectId: created.id,
      before: null,
      after: created,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return created;
  }

  async update(
    adminId: string,
    bannerId: string,
    body: AdminBannerUpdate,
    context: SessionContext,
  ): Promise<AdminBanner> {
    const before = await this.get(bannerId);
    if (body.imageKey !== undefined) this.assertMintedKey(body.imageKey);

    // The window's two halves are edited separately (schedule now, end later),
    // so the ordering rule is checked against the EFFECTIVE pair, not just the
    // fields this request happens to carry.
    const startsAt = body.startsAt !== undefined ? body.startsAt : before.startsAt;
    const endsAt = body.endsAt !== undefined ? body.endsAt : before.endsAt;
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
      throw ApiException.validation('The window must end after it starts', { startsAt, endsAt });
    }

    const sets: SQL[] = [];
    if (body.title !== undefined) sets.push(sql`title = ${body.title}`);
    if (body.imageKey !== undefined) sets.push(sql`image_key = ${body.imageKey}`);
    if (body.ctaLink !== undefined) sets.push(sql`cta_link = ${body.ctaLink}`);
    if (body.ctaLabel !== undefined) sets.push(sql`cta_label = ${body.ctaLabel}`);
    if (body.audience !== undefined) sets.push(sql`audience = ${body.audience}`);
    if (body.startsAt !== undefined) sets.push(sql`starts_at = ${body.startsAt}::timestamptz`);
    if (body.endsAt !== undefined) sets.push(sql`ends_at = ${body.endsAt}::timestamptz`);
    if (body.isActive !== undefined) sets.push(sql`is_active = ${body.isActive}`);
    if (body.sortOrder !== undefined) sets.push(sql`sort_order = ${body.sortOrder}`);

    if (sets.length > 0) {
      await this.db.execute(sql`
        update banners set ${sql.join(sets, sql`, `)} , updated_at = now()
         where id = ${bannerId}::uuid
      `);
    }

    const after = await this.get(bannerId);
    await this.audit.record({
      adminId,
      action: 'banner.update',
      subjectType: 'banner',
      subjectId: bannerId,
      before,
      after,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return after;
  }

  /**
   * `POST /v1/admin/banners/presign` — the console uploads bytes straight to
   * storage, then saves the returned key. The response carries the key so the
   * console never has to parse it out of the URL.
   */
  async presign(
    adminId: string,
    contentType: BannerImageContentType,
  ): Promise<AdminBannerPresignResponse> {
    const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
    const slot = await this.uploads.presign(
      BANNER_IMAGES_KEY_PREFIX,
      adminId,
      'banner',
      undefined,
      extension,
    );
    return { uploadUrl: slot.uploadUrl, key: slot.key, expiresAt: slot.expiresAt };
  }

  async get(bannerId: string): Promise<AdminBanner> {
    const rows = (await this.db.execute(sql`
      select * from banners where id = ${bannerId}::uuid
    `)) as unknown as BannerRow[];
    const row = rows[0];
    if (!row) throw ApiException.notFound('Banner not found');
    return this.toBanner(row);
  }

  private assertMintedKey(imageKey: string): void {
    if (!this.uploads.isMintedKey(imageKey, BANNER_IMAGES_KEY_PREFIX)) {
      throw ApiException.validation(
        'Upload the banner image first — imageKey must come from POST /v1/admin/banners/presign',
        { imageKey: 'not a minted key' },
      );
    }
  }

  private async toBanner(row: BannerRow): Promise<AdminBanner> {
    return {
      id: row.id,
      title: row.title,
      imageKey: row.image_key,
      imageUrl: (await this.storage.presignGet(row.image_key, PUBLIC_URL_TTL_SECONDS)).url,
      ctaLink: row.cta_link,
      ctaLabel: row.cta_label,
      audience: row.audience,
      startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
      endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
