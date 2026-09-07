import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { rupeeStringToPaise, type WalletDto, type WalletTransactionDto } from '@towing/api-contracts';
import { DB_READER, type Database } from '../../db/db.module';

/**
 * §9.1.9's customer wallet.
 *
 * THE FIRST `owner_type = 'user'` ROWS THE PRODUCT HAS EVER HAD.
 * `walletOwnerTypeEnum` has carried `user` since migration 0001 and nothing has
 * ever written one: every wallet in existence belongs to a fleet. They arrive
 * now as §14.5 refunds and adjustments land — which is also why this is
 * READ-ONLY. There is no top-up: that is a second payment flow, and neither
 * §9.1.9 nor the plan's B1 slice asks for one.
 *
 * `DB_READER`, and `sole-writer.spec.ts`'s second describe fails the build if
 * this file ever grows a write call of any kind. Every wallet write in the
 * system goes through `LedgerService.post`.
 *
 * (That guard matches on source text, so even naming the forbidden method calls
 * in this comment would trip it — which is a fair demonstration that it works.)
 *
 * Wallets are created LAZILY by `LedgerService` on first credit, so a customer
 * who has never been refunded has no row at all — and a zero balance is the
 * honest answer, not an error.
 */
@Injectable()
export class WalletService {
  constructor(@Inject(DB_READER) private readonly db: Database) {}

  async balance(userId: string): Promise<WalletDto> {
    const [row] = (await this.db.execute(sql`
      select balance from wallets where owner_type = 'user' and owner_id = ${userId}::uuid
    `)) as unknown as Array<{ balance: string } | undefined>;

    return { balancePaise: row ? rupeeStringToPaise(row.balance) : 0 };
  }

  /**
   * The ledger feed, newest first, over `idx_wallet_transactions_wallet_feed`.
   *
   * `amountPaise` IS SIGNED — this is the first customer-facing screen in the
   * product to render negative money, which is why `formatPaise` had to be
   * fixed for negatives in the same phase (it produced `₹-,500`).
   */
  async transactions(userId: string, limit = 50): Promise<{ items: WalletTransactionDto[] }> {
    const rows = (await this.db.execute(sql`
      select t.id, t.amount, t.type, t.reason, t.ref_id, t.created_at
        from wallet_transactions t
        join wallets w on w.id = t.wallet_id
       where w.owner_type = 'user' and w.owner_id = ${userId}::uuid
       order by t.created_at desc nulls last, t.id desc nulls last
       limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        amountPaise: rupeeStringToPaise(row.amount as string),
        type: row.type as string,
        reason: (row.reason as string | null) ?? null,
        bookingId: (row.ref_id as string | null) ?? null,
        createdAt: new Date(row.created_at as string).toISOString(),
      })),
    };
  }
}
