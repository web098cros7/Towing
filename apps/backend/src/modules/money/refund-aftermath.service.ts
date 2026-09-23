import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PartialRefundTerms } from '@towing/api-contracts';
import { NotificationService } from '../../common/notifications/notification.service';
import { DB, type Database } from '../../db/db.module';
import { AdminNotesService, type NotesViewer } from '../admin-notes/admin-notes.service';
import type { SessionContext } from '../auth/token.service';

/**
 * What happens around a partial refund that is not money (ADM-6).
 *
 * Two things the industry does and MiTow did not:
 *
 * 1. THE DRIVER IS TOLD. Uber shows a "fare adjustment" on the driver's
 *    statement and says why. A deduction the driver only discovers by adding
 *    up their earnings reads as theft, and it is the fastest way to lose them.
 *    The statement line itself is the ledger leg's reason (`adjustmentLabel`);
 *    this is the push that goes with it.
 * 2. MISCONDUCT IS RECORDED. A refund given because of the driver's conduct
 *    leaves a note on their record, whoever ends up paying for it. Repeat
 *    complaints are what lead to a suspension, and nobody can see a pattern in
 *    refunds scattered across bookings.
 *
 * Kept out of `RefundsService` on purpose: that is the money engine, and its
 * steps are all idempotent and resumable. These are side effects, run once by
 * the admin paths after a refund they actually issued (never on a replay), and
 * a failure here must not undo money that has already moved.
 */
@Injectable()
export class RefundAftermathService {
  private readonly logger = new Logger(RefundAftermathService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationService,
    // The notes module is the only writer of `admin_notes` (its source guard
    // enforces it), so the misconduct note gets the same subject-access check
    // and audit row as one typed in the console.
    private readonly notes: AdminNotesService,
  ) {}

  async afterPartialRefund(params: {
    bookingId: string;
    refundId: string;
    terms: PartialRefundTerms;
    providerSharePaise: number;
    adminId: string;
    replayed: boolean;
    context?: SessionContext;
  }): Promise<void> {
    if (params.replayed) return;

    const [booking] = (await this.db.execute(sql`
      select driver_id from bookings where id = ${params.bookingId}::uuid
    `)) as unknown as Array<{ driver_id: string | null }>;
    const driverId = booking?.driver_id ?? null;
    if (!driverId) return;

    const bookingRef = params.bookingId.slice(0, 8).toUpperCase();

    try {
      if (params.terms.cause === 'driver_misconduct') {
        const deducted =
          params.providerSharePaise > 0
            ? `${rupees(params.providerSharePaise)} was deducted from their earnings`
            : 'MiTow bore the refund (override), nothing was deducted';
        const [admin] = (await this.db.execute(sql`
          select sub_role from admin_users where id = ${params.adminId}::uuid
        `)) as unknown as Array<{ sub_role: NotesViewer['subRole'] }>;
        if (admin) {
          await this.notes.create(
            { id: params.adminId, subRole: admin.sub_role },
            {
              subjectType: 'driver',
              subjectId: driverId,
              body:
                `Service complaint on booking TW-${bookingRef}: the customer was refunded ` +
                `and ${deducted}. Refund ${params.refundId.slice(0, 8).toUpperCase()}.`,
            },
            params.context ?? {},
          );
        }
      }

      if (params.providerSharePaise > 0) {
        await this.notifications.emit('earnings.adjusted', {
          bookingId: params.bookingId,
          refundId: params.refundId,
          driverId,
          amount: rupees(params.providerSharePaise),
          cause: params.terms.cause,
        });
      }
    } catch (error) {
      // The money has moved and is correct. A missed note or push is logged
      // loudly rather than thrown back at the admin as a failed refund, which
      // they would retry into a replay that does nothing.
      this.logger.error(
        `event=refund_aftermath_failed refund=${params.refundId} booking=${params.bookingId} ` +
          `error=${String(error)}`,
      );
    }
  }
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
