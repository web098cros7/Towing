import { Inject, Injectable } from '@nestjs/common';
import {
  paiseToRupeeString,
  rupeeStringToPaise,
  type AdminCoupon,
  type AdminCouponCreate,
  type AdminCouponRedemptionsResponse,
  type AdminCouponsQuery,
  type AdminCouponsResponse,
  type AdminCouponUpdate,
  type CouponKind,
} from '@towing/api-contracts';
import { sql, type SQL } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { codeOf } from '../admin-bookings/admin-bookings.repo';
import type { SessionContext } from '../auth/token.service';
import { couponWindowError, couponWriteFailure } from './coupon-write-failure';

interface CouponRow {
  id: string;
  code: string;
  kind: CouponKind;
  value: string;
  max_discount: string | null;
  min_order: string;
  max_uses: number | null;
  max_uses_per_user: number;
  used_count: number;
  starts_at: string | Date | null;
  expires_at: string | Date | null;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

/**
 * W16 — §9.4.11's coupon manager, over the table Phase 19 shipped.
 *
 * THE MONEY PATH DOES NOT CHANGE HERE. The console edits definitions; the
 * confirm transaction still re-validates from scratch and still claims a use
 * with a conditional UPDATE (`coupons.service.ts`). The two things this
 * service must never do are the two the phase's verification names: change
 * `used_count`, or delete a coupon a booking references.
 *
 * `used_count` is not in the update SET list and not in the write contracts —
 * belt and braces, because a single stray line here would diverge the counter
 * from `coupon_redemptions` and the `couponDrift` invariant would only notice
 * at the next bench/reconcile.
 */
@Injectable()
export class AdminCouponsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminCouponsQuery): Promise<AdminCouponsResponse> {
    const filters: SQL[] = [];
    if (query.code) {
      filters.push(sql`upper(code) like upper(${`%${escapeLike(query.code)}%`})`);
    }
    if (query.isActive) {
      filters.push(sql`is_active = ${query.isActive === 'true'}`);
    }
    const where = filters.length > 0 ? sql.join(filters, sql` and `) : sql`true`;

    const offset = (query.page - 1) * query.limit;
    const rows = (await this.db.execute(sql`
      select *, count(*) over() as total_count
        from coupons
       where ${where}
       order by created_at desc, id desc
       limit ${query.limit} offset ${offset}
    `)) as unknown as Array<CouponRow & { total_count: number }>;

    return {
      items: rows.map((row) => this.toCoupon(row)),
      page: query.page,
      limit: query.limit,
      total: rows[0] ? Number(rows[0].total_count) : 0,
    };
  }

  async get(couponId: string): Promise<AdminCoupon> {
    const rows = (await this.db.execute(sql`
      select * from coupons where id = ${couponId}::uuid
    `)) as unknown as CouponRow[];
    const row = rows[0];
    if (!row) throw ApiException.notFound('Coupon not found');
    return this.toCoupon(row);
  }

  async create(
    adminId: string,
    body: AdminCouponCreate,
    context: SessionContext,
  ): Promise<AdminCoupon> {
    const value = valueColumn(body.kind, body);

    // The contract refuses a reversed window too; this is the same check the update path runs, so a caller that bypasses the pipe still gets a 422 rather than a database error.
    if (body.startsAt && body.expiresAt && new Date(body.startsAt) >= new Date(body.expiresAt)) {
      throw couponWindowError();
    }

    let createdId: string;
    try {
      const rows = (await this.db.execute(sql`
        insert into coupons
          (code, kind, value, max_discount, min_order, max_uses, max_uses_per_user,
           starts_at, expires_at, is_active)
        values (
          ${body.code},
          ${body.kind},
          ${value}::numeric,
          ${toRupeeParam(body.maxDiscountPaise)}::numeric,
          ${toRupeeParam(body.minOrderPaise) ?? '0'}::numeric,
          ${body.maxUses ?? null},
          ${body.maxUsesPerUser ?? 1},
          ${body.startsAt ?? null}::timestamptz,
          ${body.expiresAt ?? null}::timestamptz,
          ${body.isActive ?? true}
        )
        returning id
      `)) as unknown as Array<{ id: string }>;
      createdId = rows[0]!.id;
    } catch (error) {
      throw couponWriteFailure(error, { code: body.code, kind: body.kind });
    }

    const coupon = await this.get(createdId);
    await this.audit.record({
      adminId,
      action: 'coupon.create',
      subjectType: 'coupon',
      subjectId: createdId,
      before: null,
      after: coupon,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return coupon;
  }

  /**
   * A PATCH over the editable fields. There is no path in this method that
   * writes `used_count`, and adding one would fail the invariant test before
   * it ever shipped.
   */
  async update(
    adminId: string,
    couponId: string,
    body: AdminCouponUpdate,
    context: SessionContext,
  ): Promise<AdminCoupon> {
    const before = await this.get(couponId);

    // The exactly-one-value rule, checked against the EFFECTIVE row: omitted
    // fields keep their stored values, so a kind switch that would leave both
    // (or neither) populated is refused here rather than stored for the
    // customer route to choke on later.
    const kind = body.kind ?? before.kind;
    const percentValue =
      body.percentValue !== undefined
        ? body.percentValue
        : body.kind !== undefined && body.kind !== 'percent'
          ? null
          : before.percentValue;
    const flatValuePaise =
      body.flatValuePaise !== undefined
        ? body.flatValuePaise
        : body.kind !== undefined && body.kind !== 'flat'
          ? null
          : before.flatValuePaise;

    if (!valueMatchesKind(kind, percentValue, flatValuePaise)) {
      throw ApiException.validation(
        'A coupon carries exactly one value: percentValue for kind=percent, flatValuePaise for kind=flat',
        { kind },
      );
    }

    const startsAt = body.startsAt !== undefined ? body.startsAt : before.startsAt;
    const endsAt = body.expiresAt !== undefined ? body.expiresAt : before.expiresAt;
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
      throw couponWindowError();
    }

    const sets: SQL[] = [];
    if (body.code !== undefined) sets.push(sql`code = ${body.code}`);
    if (body.kind !== undefined) sets.push(sql`kind = ${body.kind}`);
    if (
      body.kind !== undefined ||
      body.percentValue !== undefined ||
      body.flatValuePaise !== undefined
    ) {
      sets.push(sql`value = ${valueColumn(kind, { percentValue, flatValuePaise })}::numeric`);
    }
    if (body.maxDiscountPaise !== undefined) {
      sets.push(sql`max_discount = ${toRupeeParam(body.maxDiscountPaise)}::numeric`);
    }
    if (body.minOrderPaise !== undefined) {
      sets.push(sql`min_order = ${toRupeeParam(body.minOrderPaise)}::numeric`);
    }
    if (body.maxUses !== undefined) sets.push(sql`max_uses = ${body.maxUses}`);
    if (body.maxUsesPerUser !== undefined)
      sets.push(sql`max_uses_per_user = ${body.maxUsesPerUser}`);
    if (body.startsAt !== undefined) sets.push(sql`starts_at = ${body.startsAt}::timestamptz`);
    if (body.expiresAt !== undefined) sets.push(sql`expires_at = ${body.expiresAt}::timestamptz`);
    if (body.isActive !== undefined) sets.push(sql`is_active = ${body.isActive}`);

    try {
      if (sets.length > 0) {
        await this.db.execute(sql`
          update coupons set ${sql.join(sets, sql`, `)} , updated_at = now()
           where id = ${couponId}::uuid
        `);
      }
    } catch (error) {
      throw couponWriteFailure(error, { code: body.code, kind });
    }

    const after = await this.get(couponId);
    await this.audit.record({
      adminId,
      action: 'coupon.update',
      subjectType: 'coupon',
      subjectId: couponId,
      before,
      after,
      reason: body.reason ?? null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return after;
  }

  /**
   * The live redemption rows — the truth `used_count` summarises. Released
   * (free-cancel) uses are deleted, not flagged, so they simply are not here.
   */
  async redemptions(
    couponId: string,
    query: { page: number; limit: number },
  ): Promise<AdminCouponRedemptionsResponse> {
    await this.get(couponId);

    const offset = (query.page - 1) * query.limit;
    const rows = (await this.db.execute(sql`
      select r.id, r.user_id, u.name as user_name, r.booking_id, r.discount_amount,
             r.created_at, count(*) over() as total_count
        from coupon_redemptions r
        left join users u on u.id = r.user_id
       where r.coupon_id = ${couponId}::uuid
       order by r.created_at desc, r.id desc
       limit ${query.limit} offset ${offset}
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        userId: row.user_id as string,
        userName: (row.user_name as string | null) ?? null,
        bookingId: row.booking_id as string,
        bookingCode: codeOf(row.booking_id as string),
        discountPaise: rupeeStringToPaise(row.discount_amount as string),
        createdAt: new Date(row.created_at as string).toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total: rows[0] ? Number(rows[0].total_count) : 0,
    };
  }

  private toCoupon(row: CouponRow): AdminCoupon {
    return {
      id: row.id,
      code: row.code,
      kind: row.kind,
      percentValue: row.kind === 'percent' ? Number(row.value) : null,
      flatValuePaise: row.kind === 'flat' ? rupeeStringToPaise(row.value) : null,
      maxDiscountPaise: row.max_discount === null ? null : rupeeStringToPaise(row.max_discount),
      minOrderPaise: rupeeStringToPaise(row.min_order),
      maxUses: row.max_uses ?? null,
      maxUsesPerUser: row.max_uses_per_user,
      usedCount: row.used_count,
      startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      isActive: row.is_active,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

/** ILIKE metacharacters in a probe are escaped — "100%" means the literal string. */
function escapeLike(probe: string): string {
  return probe.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toRupeeParam(paise: number | null | undefined): string | null {
  return paise === null || paise === undefined ? null : paiseToRupeeString(paise);
}

function valueMatchesKind(
  kind: CouponKind,
  percentValue: number | null,
  flatValuePaise: number | null,
): boolean {
  return kind === 'percent'
    ? percentValue !== null && flatValuePaise === null
    : flatValuePaise !== null && percentValue === null;
}

/** The NUMERIC(12,2) string for the `value` column, unit decided by kind. */
function valueColumn(
  kind: CouponKind,
  value: { percentValue?: number | null; flatValuePaise?: number | null },
): string {
  if (kind === 'percent') {
    const percent = value.percentValue;
    if (percent === null || percent === undefined) {
      throw ApiException.validation('percentValue is required for a percent coupon');
    }
    return percent.toFixed(2);
  }
  const flat = value.flatValuePaise;
  if (flat === null || flat === undefined) {
    throw ApiException.validation('flatValuePaise is required for a flat coupon');
  }
  return paiseToRupeeString(flat);
}
