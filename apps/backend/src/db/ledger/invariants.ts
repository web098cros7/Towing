import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';

/**
 * The money invariants — §14.1's "balances are derived from an append-only
 * transaction ledger" made checkable.
 *
 * These queries were written for `pnpm db:seed` and lived inline in
 * `verifySeedInvariants`. Phase 7 hoisted them here without changing a
 * character, because the seed, the test suite and the nightly reconciliation
 * job must all be asserting the *same* things. `verifySeedInvariants` is
 * now a thin wrapper over `ledgerInvariants`, so there is one definition.
 *
 * Phase 19 added the fourth and fifth (`reversalDrift`, `couponDrift`) when it
 * gave `refunds` and `coupons` their first writers, and made `bookingDrift`
 * GST-aware. All five must be zero on a healthy database. They are exact by construction
 * — NUMERIC arithmetic, no floats anywhere — so a non-zero count is a bug and
 * never rounding noise.
 */

export type LedgerDatabase = PostgresJsDatabase<typeof schema>;

export interface LedgerInvariants {
  /** §14.1: `wallets.balance` is a projection of SUM(wallet_transactions). */
  walletDrift: number;
  /** §7: commission + tax + driver payout reconstruct the total exactly. */
  bookingDrift: number;
  /** §14.3: the credited legs of a booking sum to its recorded payout. */
  ledgerDrift: number;
  /** §14.5: no booking has been refunded more than it was ever credited. */
  reversalDrift: number;
  /** §9.4.11: `coupons.used_count` matches its redemption rows. */
  couponDrift: number;
}

export async function ledgerInvariants(db: LedgerDatabase): Promise<LedgerInvariants> {
  const [walletDrift] = (await db.execute(sql`
    select count(*)::int as count
    from wallets w
    left join lateral (
      select coalesce(sum(amount), 0) as total
      from wallet_transactions t where t.wallet_id = w.id
    ) x on true
    where w.balance <> x.total
  `)) as unknown as [{ count: number }];

  // GST-AWARE SINCE PHASE 19. With `tax_amount` NOT NULL DEFAULT 0 this is
  // byte-identical arithmetic to the version it replaces — and it stays that
  // way until an admin sets a rate.
  //
  // THE MISTAKE THIS CATCHES: `creditBookingSettlement` must be called with the
  // PRE-TAX taxable amount, never `booking.total`. Passing `total` credits the
  // driver a share of the government's money; commission + payout then exceeds
  // `total - tax` and this count goes non-zero. (`ck_bookings_payout_within_total`
  // catches the same mistake harder and earlier, as a constraint violation on
  // the capture path itself — this is the backstop that also finds it in rows
  // written before that constraint existed.)
  const [bookingDrift] = (await db.execute(sql`
    select count(*)::int as count from bookings
    where status = 'paid' and commission_amount + driver_payout + tax_amount <> total
  `)) as unknown as [{ count: number }];

  // Note the type list: `commission_debit` is absent because it is never
  // written (see `walletTxnTypeEnum`). If a commission leg is ever introduced,
  // THIS query is the one that has to change with it.
  const [ledgerDrift] = (await db.execute(sql`
    select count(*)::int as count
    from bookings b
    left join lateral (
      select coalesce(sum(amount), 0) as total
      from wallet_transactions t
      where t.ref_id = b.id
        and t.type in ('driver_share_credit', 'fleet_share_credit', 'fare_credit')
    ) x on true
    where b.status = 'paid' and x.total <> b.driver_payout
  `)) as unknown as [{ count: number }];

  // §14.5's reversal check, and note what it is NOT filtered on.
  //
  // Every other invariant here keys on `status = 'paid'`, which is right for
  // them: they ask whether a settled booking settled correctly. A reversal is
  // precisely the operation that moves a booking OUT of `paid` — Phase 19's
  // rule is that a booking carrying any `refund_debit` leg is never left there
  // — so a check filtered on `paid` could never see one. This one therefore
  // runs at EVERY status, and asks the only question that matters about a
  // reversal: did we take back more than we ever gave?
  //
  // Refund legs are negative, hence the `abs()`.
  const [reversalDrift] = (await db.execute(sql`
    select count(*)::int as count
    from bookings b
    join lateral (
      select
        coalesce(sum(amount) filter (
          where type in ('driver_share_credit', 'fleet_share_credit', 'fare_credit')
        ), 0) as credited,
        coalesce(sum(amount) filter (where type = 'refund_debit'), 0) as refunded
      from wallet_transactions t
      where t.ref_id = b.id
    ) x on true
    where x.refunded <> 0 and abs(x.refunded) > x.credited
  `)) as unknown as [{ count: number }];

  // A denormalised counter that can drift silently is worse than no counter.
  // `coupons.used_count` is incremented by the same conditional UPDATE that
  // enforces `max_uses`, inside the confirm transaction — so this should be
  // structurally impossible, which is exactly the kind of claim worth checking
  // nightly rather than believing.
  const [couponDrift] = (await db.execute(sql`
    select count(*)::int as count from coupons c
    where c.used_count <> (
      select count(*) from coupon_redemptions r where r.coupon_id = c.id
    )
  `)) as unknown as [{ count: number }];

  return {
    walletDrift: walletDrift.count,
    bookingDrift: bookingDrift.count,
    ledgerDrift: ledgerDrift.count,
    reversalDrift: reversalDrift.count,
    couponDrift: couponDrift.count,
  };
}

export interface DriftedWallet {
  walletId: string;
  ownerType: string;
  ownerId: string;
  /** The cached projection, in paise. */
  balancePaise: number;
  /** SUM of the wallet's ledger entries, in paise — the truth. */
  ledgerPaise: number;
  deltaPaise: number;
}

/**
 * The offending rows behind a non-zero `walletDrift`, so the nightly job can
 * log something a human can act on rather than just a count.
 *
 * Bounded: a systemic bug would otherwise dump every wallet into the log at
 * 01:00 IST. The count from `ledgerInvariants` is the honest total.
 */
export async function driftedWallets(db: LedgerDatabase, limit = 20): Promise<DriftedWallet[]> {
  const rows = (await db.execute(sql`
    select w.id as wallet_id,
           w.owner_type,
           w.owner_id,
           (w.balance * 100)::bigint as balance_paise,
           (coalesce(x.total, 0) * 100)::bigint as ledger_paise,
           ((w.balance - coalesce(x.total, 0)) * 100)::bigint as delta_paise
    from wallets w
    left join lateral (
      select coalesce(sum(amount), 0) as total
      from wallet_transactions t where t.wallet_id = w.id
    ) x on true
    where w.balance <> coalesce(x.total, 0)
    order by abs(w.balance - coalesce(x.total, 0)) desc
    limit ${limit}
  `)) as unknown as Array<{
    wallet_id: string;
    owner_type: string;
    owner_id: string;
    balance_paise: string;
    ledger_paise: string;
    delta_paise: string;
  }>;

  return rows.map((row) => ({
    walletId: row.wallet_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    balancePaise: Number(row.balance_paise),
    ledgerPaise: Number(row.ledger_paise),
    deltaPaise: Number(row.delta_paise),
  }));
}
