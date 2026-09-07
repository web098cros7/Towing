import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type CouponRejection,
  type CouponValidationDto,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';

interface CouponRow {
  id: string;
  code: string;
  kind: 'percent' | 'flat';
  value: string;
  maxDiscount: string | null;
  minOrder: string;
  maxUses: number | null;
  maxUsesPerUser: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
}

/**
 * §9.4.11's coupons — the half a customer touches.
 *
 * TWO CALLS, AND ONLY THE SECOND IS AUTHORITATIVE. `validate` tells the app
 * what a code is worth so it can render the discount before the customer
 * commits; `applyInTransaction` runs inside the confirm transaction and
 * computes its own number. A fare lock based on a figure the client carried is
 * not a lock, and §3.4 is explicit that the lock is what the whole money model
 * rests on.
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async validate(
    userId: string,
    code: string,
    subtotalPaise: number,
  ): Promise<CouponValidationDto> {
    const coupon = await this.byCode(this.db, code);

    // An unknown code and an inactive one return the SAME answer. A coupon
    // endpoint is a code-guessing surface, and distinguishing the two would
    // confirm which strings exist.
    if (!coupon || !coupon.isActive) return reject('invalid');

    const rejection = await this.rejectionFor(this.db, coupon, userId, subtotalPaise);
    if (rejection) return reject(rejection, coupon);

    return {
      valid: true,
      // Echoed in the casing the coupon was CREATED with, not as typed — the
      // unique index is on `upper(code)`, so `save20` and `SAVE20` are one
      // coupon and the app should show its real name.
      code: coupon.code,
      kind: coupon.kind,
      discountPaise: discountFor(coupon, subtotalPaise),
      reason: null,
    };
  }

  /**
   * Consumes a coupon inside the caller's transaction.
   *
   * THE CAP IS A CONDITIONAL UPDATE, NOT A SELECT-THEN-CHECK. Reading
   * `used_count`, comparing it and then incrementing is a textbook race: two
   * concurrent confirms both read 0 against a `max_uses: 1` coupon and both
   * pass. `where used_count < max_uses returning id` decides it in one
   * statement, and a zero-row result means somebody else got the last one.
   *
   * Everything here is in the SAME transaction that locks the fare, so there is
   * no window in which a booking carries a discount whose redemption went
   * unrecorded, and none in which a redemption survives a booking that rolled
   * back.
   */
  async applyInTransaction(
    tx: DatabaseExecutor,
    params: { userId: string; bookingId: string; code: string; subtotalPaise: number },
  ): Promise<{ couponId: string; code: string; discountPaise: number }> {
    const coupon = await this.byCode(tx, params.code);
    if (!coupon || !coupon.isActive) throw couponInvalid('invalid');

    const rejection = await this.rejectionFor(tx, coupon, params.userId, params.subtotalPaise);
    if (rejection) throw couponInvalid(rejection);

    const discountPaise = discountFor(coupon, params.subtotalPaise);
    if (discountPaise <= 0) throw couponInvalid('below_min_order');

    const claimed = (await tx.execute(sql`
      update coupons
         set used_count = used_count + 1, updated_at = now()
       where id = ${coupon.id}::uuid
         and is_active
         and (max_uses is null or used_count < max_uses)
      returning id
    `)) as unknown as Array<{ id: string }>;

    if (claimed.length === 0) {
      // Exhausted between validate and confirm. Throwing rolls back the WHOLE
      // transaction — the fare lock, the OTP, the booking row and the
      // redemption together — so there is no orphan booking carrying a
      // discount nobody recorded.
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCodes.COUPON_EXHAUSTED,
        'That coupon was just used up',
      );
    }

    await tx.execute(sql`
      insert into coupon_redemptions (coupon_id, user_id, booking_id, discount_amount)
      values (${coupon.id}::uuid, ${params.userId}::uuid, ${params.bookingId}::uuid,
              ${paiseToRupeeString(discountPaise)}::numeric)
    `);

    return { couponId: coupon.id, code: coupon.code, discountPaise };
  }

  /**
   * Returns a coupon a FREE cancellation burnt.
   *
   * Burning a single-use code on a ninety-second cancellation is user-hostile.
   * A CHARGEABLE cancellation keeps it burnt — the customer got a driver.
   */
  async releaseForBooking(tx: DatabaseExecutor, bookingId: string): Promise<void> {
    const released = (await tx.execute(sql`
      delete from coupon_redemptions where booking_id = ${bookingId}::uuid
      returning coupon_id
    `)) as unknown as Array<{ coupon_id: string }>;

    const couponId = released[0]?.coupon_id;
    if (!couponId) return;

    // `used_count > 0` guards against a hand-edited counter going negative,
    // which `ck_coupons_used_count` would reject outright.
    await tx.execute(sql`
      update coupons set used_count = used_count - 1, updated_at = now()
       where id = ${couponId}::uuid and used_count > 0
    `);
  }

  private async byCode(tx: DatabaseExecutor, code: string): Promise<CouponRow | null> {
    const rows = (await tx.execute(sql`
      select * from coupons where upper(code) = upper(${code})
    `)) as unknown as Array<Record<string, unknown>>;

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id as string,
      code: row.code as string,
      kind: row.kind as 'percent' | 'flat',
      value: row.value as string,
      maxDiscount: (row.max_discount as string | null) ?? null,
      minOrder: row.min_order as string,
      maxUses: (row.max_uses as number | null) ?? null,
      maxUsesPerUser: row.max_uses_per_user as number,
      startsAt: row.starts_at ? new Date(row.starts_at as string) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      isActive: row.is_active as boolean,
    };
  }

  /** Everything that can stop a real, active coupon applying right now. */
  private async rejectionFor(
    tx: DatabaseExecutor,
    coupon: CouponRow,
    userId: string,
    subtotalPaise: number,
  ): Promise<CouponRejection | null> {
    const now = Date.now();

    if (coupon.startsAt && coupon.startsAt.getTime() > now) return 'not_started';
    if (coupon.expiresAt && coupon.expiresAt.getTime() < now) return 'expired';
    if (subtotalPaise < rupeeStringToPaise(coupon.minOrder)) return 'below_min_order';

    const [used] = (await tx.execute(sql`
      select count(*)::int as count from coupon_redemptions
       where coupon_id = ${coupon.id}::uuid and user_id = ${userId}::uuid
    `)) as unknown as [{ count: number }];

    if (used.count >= coupon.maxUsesPerUser) return 'already_used';

    if (coupon.maxUses !== null) {
      const [total] = (await tx.execute(sql`
        select used_count from coupons where id = ${coupon.id}::uuid
      `)) as unknown as [{ used_count: number }];
      if (total.used_count >= coupon.maxUses) return 'usage_limit_reached';
    }

    return null;
  }
}

/**
 * `percent` is capped by `max_discount`; both are clamped to the subtotal, so a
 * ₹500 flat coupon on a ₹300 fare discounts ₹300 and never makes the total
 * negative (`ck_bookings_non_negative` would reject that outright).
 */
function discountFor(coupon: CouponRow, subtotalPaise: number): number {
  const raw =
    coupon.kind === 'percent'
      ? Math.round((subtotalPaise * Number(coupon.value)) / 100)
      : rupeeStringToPaise(coupon.value);

  const capped =
    coupon.maxDiscount === null ? raw : Math.min(raw, rupeeStringToPaise(coupon.maxDiscount));

  return Math.max(0, Math.min(capped, subtotalPaise));
}

function reject(reason: CouponRejection, coupon?: CouponRow): CouponValidationDto {
  return {
    valid: false,
    code: coupon?.code ?? null,
    kind: coupon?.kind ?? null,
    discountPaise: 0,
    reason,
  };
}

function couponInvalid(reason: CouponRejection): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCodes.COUPON_INVALID,
    'That coupon cannot be applied to this booking',
    { reason },
  );
}
