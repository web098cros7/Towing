import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type PaymentCouponResponse,
} from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database, type DatabaseExecutor } from '../../db/db.module';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsRepo } from './payments.repo';

interface LockedBooking {
  id: string;
  userId: string;
  status: string;
  total: string;
  taxAmount: string;
  taxPct: string;
  discount: string;
  couponId: string | null;
}

/**
 * Figma 27 → 28's "Apply Coupon" at PAYMENT time.
 *
 * A booking that is `completed` but not yet `paid` can still take a coupon.
 * The fare is recomputed from the same arithmetic `bookings.service.ts` uses at
 * confirm, and any open payment intent is closed so the next intent charges the
 * new total — an intent that outlives a fare change is a customer paying the
 * old number.
 */
@Injectable()
export class PaymentCouponService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly coupons: CouponsService,
    private readonly payments: PaymentsRepo,
  ) {}

  async apply(
    bookingId: string,
    userId: string,
    code: string,
  ): Promise<PaymentCouponResponse> {
    await this.db.transaction(async (tx) => {
      const booking = await this.lockPayable(tx, bookingId, userId);

      // A booking that already carries a coupon releases it first — the
      // redemption row and the counter must agree with the new code, and
      // `couponDrift` is the nightly check that they do.
      if (booking.couponId) {
        await this.coupons.releaseForBooking(tx, bookingId);
      }

      const preDiscountTaxable = preDiscountTaxablePaise(booking);

      const applied = await this.coupons.applyInTransaction(tx, {
        userId,
        bookingId,
        code,
        subtotalPaise: preDiscountTaxable,
      });

      const totals = recompute(booking, applied.discountPaise);

      await tx.execute(sql`
        update bookings
           set discount = ${paiseToRupeeString(applied.discountPaise)}::numeric,
               tax_amount = ${paiseToRupeeString(totals.taxPaise)}::numeric,
               total = ${paiseToRupeeString(totals.totalPaise)}::numeric,
               coupon_id = ${applied.couponId}::uuid,
               coupon_code = ${applied.code},
               updated_at = now()
         where id = ${bookingId}::uuid
      `);
    });

    await this.closeOpenIntents(bookingId);

    return this.response(bookingId);
  }

  async remove(bookingId: string, userId: string): Promise<PaymentCouponResponse> {
    await this.db.transaction(async (tx) => {
      const booking = await this.lockPayable(tx, bookingId, userId);

      // No coupon is a no-op that still returns the current state — the
      // customer tapping "Remove" twice must not 4xx.
      if (booking.couponId) {
        await this.coupons.releaseForBooking(tx, bookingId);
      }

      const totals = recompute(booking, 0);

      await tx.execute(sql`
        update bookings
           set discount = '0'::numeric,
               tax_amount = ${paiseToRupeeString(totals.taxPaise)}::numeric,
               total = ${paiseToRupeeString(totals.totalPaise)}::numeric,
               coupon_id = null,
               coupon_code = null,
               updated_at = now()
         where id = ${bookingId}::uuid
      `);
    });

    await this.closeOpenIntents(bookingId);

    return this.response(bookingId);
  }

  /**
   * The booking, under a row lock, with every reason it cannot take a coupon
   * checked in one place.
   */
  private async lockPayable(
    tx: DatabaseExecutor,
    bookingId: string,
    userId: string,
  ): Promise<LockedBooking> {
    const rows = (await tx.execute(sql`
      select id, user_id, status, total, tax_amount, tax_pct, discount, coupon_id
        from bookings
       where id = ${bookingId}::uuid
       for update
    `)) as unknown as Array<Record<string, unknown>>;

    const row = rows[0];
    // 404 rather than 403 for somebody else's booking: confirming that a
    // booking exists to a stranger is itself a disclosure.
    if (!row || row.user_id !== userId) throw ApiException.notFound('Booking not found');

    const status = row.status as string;
    if (status !== 'completed') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'A coupon can only be changed before the trip is paid',
        { status },
      );
    }

    // A captured `booking` payment means the fare is already settled — the
    // status may lag by a moment, but the money has moved.
    const captured = (await tx.execute(sql`
      select 1 from payments
       where booking_id = ${bookingId}::uuid
         and purpose = 'booking'
         and status = 'captured'
       limit 1
    `)) as unknown as Array<unknown>;

    if (captured.length > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'A coupon can only be changed before the trip is paid',
        { status },
      );
    }

    return {
      id: row.id as string,
      userId: row.user_id as string,
      status,
      total: row.total as string,
      taxAmount: (row.tax_amount as string | null) ?? '0',
      taxPct: (row.tax_pct as string | null) ?? '0',
      discount: (row.discount as string | null) ?? '0',
      couponId: (row.coupon_id as string | null) ?? null,
    };
  }

  /**
   * Closes any open intent so the next one is minted against the new total.
   *
   * A cash intent is left alone: the customer chose to hand over notes, and
   * failing it would silently flip them back to online payment.
   */
  private async closeOpenIntents(bookingId: string): Promise<void> {
    const open = await this.payments.openIntent(bookingId, 'booking');
    if (open && open.provider !== 'cash') {
      await this.payments.markFailed(open.id, 'Coupon changed');
    }
  }

  /** A fresh read, so the response reflects what actually committed. */
  private async response(bookingId: string): Promise<PaymentCouponResponse> {
    const [row] = (await this.db.execute(sql`
      select coupon_code, base_fare, distance_charge, night_charge, highway_charge,
             accident_charge, waiting_charge, surge_amount, discount, tax_amount, total
        from bookings where id = ${bookingId}::uuid
    `)) as unknown as Array<Record<string, unknown> | undefined>;

    if (!row) throw ApiException.notFound('Booking not found');

    const paise = (value: unknown): number => rupeeStringToPaise((value as string | null) ?? '0');

    return {
      bookingId,
      couponCode: (row.coupon_code as string | null) ?? null,
      discountPaise: paise(row.discount),
      totalPaise: paise(row.total),
      breakdown: {
        basePaise: paise(row.base_fare) + paise(row.distance_charge),
        nightPaise: paise(row.night_charge),
        highwayPaise: paise(row.highway_charge),
        accidentPaise: paise(row.accident_charge),
        waitingPaise: paise(row.waiting_charge),
        surgePaise: paise(row.surge_amount),
        discountPaise: paise(row.discount),
        taxPaise: paise(row.tax_amount),
        totalPaise: paise(row.total),
      },
    };
  }
}

/**
 * The taxable amount BEFORE any coupon: `(total − tax) + discount`. Adding the
 * old discount back is what makes a re-apply idempotent — the coupon is priced
 * against the fare, not against the fare-minus-a-previous-coupon.
 */
function preDiscountTaxablePaise(booking: LockedBooking): number {
  const total = rupeeStringToPaise(booking.total);
  const tax = rupeeStringToPaise(booking.taxAmount);
  const discount = rupeeStringToPaise(booking.discount);
  return total - tax + discount;
}

/** The same arithmetic `bookings.service.ts` runs at confirm. */
function recompute(
  booking: LockedBooking,
  newDiscountPaise: number,
): { taxPaise: number; totalPaise: number } {
  const preDiscountTaxable = preDiscountTaxablePaise(booking);
  const taxable = preDiscountTaxable - newDiscountPaise;
  const taxPaise = Math.round((taxable * Number(booking.taxPct)) / 100);
  return { taxPaise, totalPaise: taxable + taxPaise };
}
