import { sql } from 'drizzle-orm';
import { rupeeStringToPaise, type DriverJobPayment } from '@towing/api-contracts';
import type { DatabaseExecutor } from '../../db/db.module';

/**
 * The ONE place both the job DTO and the `job:payment` frame read what the
 * customer is paying and how.
 *
 * A driver deciding whether to hand over the keys needs to know whether the
 * customer is paying cash or in the app, and — if cash — exactly how much to
 * collect. That answer lives on the newest non-failed `payments` row for the
 * booking, with the booking's own status as the tiebreaker for the terminal
 * cases. Reading it in two places would eventually produce two answers.
 */
export async function loadJobPayment(
  db: DatabaseExecutor,
  booking: {
    id: string;
    status: string;
    total: string;
    discount: string;
    paymentMethod: string | null;
  },
): Promise<DriverJobPayment> {
  const rows = (await db.execute(sql`
    select provider, status, amount
      from payments
     where booking_id = ${booking.id}::uuid
       and purpose = 'booking'
       and status <> 'failed'
     order by created_at desc
     limit 1
  `)) as unknown as Array<{ provider: string | null; status: string; amount: string }>;

  const row = rows[0];
  const amountDuePaise = rupeeStringToPaise(booking.total);
  const discountPaise = rupeeStringToPaise(booking.discount);

  // Terminal: the booking is paid, or the row is captured/refunded. The method
  // is cash if the row says so, or if the booking itself was marked cash.
  if (
    booking.status === 'paid' ||
    row?.status === 'captured' ||
    row?.status === 'refunded'
  ) {
    const method: 'cash' | 'online' =
      row?.provider === 'cash' || booking.paymentMethod === 'cash' ? 'cash' : 'online';
    return { method, status: 'paid', amountDuePaise, discountPaise };
  }

  // A live cash row: the driver must collect the amount on the row, which is
  // the booking total net of any coupon applied at payment time.
  if (row?.provider === 'cash') {
    return {
      method: 'cash',
      status: 'awaiting_cash',
      amountDuePaise: rupeeStringToPaise(row.amount),
      discountPaise,
    };
  }

  // Any other live row: the customer is paying in the app.
  if (row) {
    return { method: 'online', status: 'pending', amountDuePaise, discountPaise };
  }

  // Nothing yet: the customer has not chosen.
  return { method: null, status: 'pending', amountDuePaise, discountPaise };
}
