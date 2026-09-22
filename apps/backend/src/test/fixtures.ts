import { eq } from 'drizzle-orm';
import { paiseToRupeeString, rupeeStringToPaise } from '@towing/api-contracts';
import { bookings, fleetTrucks, wallets, walletTransactions } from '../db/schema';
import { seedCustomer, type TestDatabase } from './db';

/** Minimal truck row for e2e fixtures. */
export async function seedTruck(
  db: TestDatabase,
  fleetId: string,
  overrides: Partial<typeof fleetTrucks.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(fleetTrucks)
    .values({
      fleetId,
      type: 'flatbed',
      plate: `KA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      capacity: '5t',
      status: 'active',
      ...overrides,
    })
    .returning({ id: fleetTrucks.id });
  return row!.id;
}

/** Minimal booking row; money fields default to '0.00' unless overridden. */
export async function seedBooking(
  db: TestDatabase,
  params: {
    userId: string;
    fleetId?: string | null;
    driverId?: string | null;
    status?: (typeof bookings.$inferInsert)['status'];
    createdAt?: Date;
    total?: string;
    /** §14 GST snapshot — the impact preview recomputes from `total − taxAmount`. */
    taxAmount?: string;
    commissionBand?: (typeof bookings.$inferInsert)['commissionBand'];
    commissionPct?: string;
    commissionAmount?: string;
    driverPayout?: string;
    pickupAddress?: string;
    serviceType?: (typeof bookings.$inferInsert)['serviceType'];
  },
): Promise<string> {
  const [row] = await db
    .insert(bookings)
    .values({
      userId: params.userId,
      fleetId: params.fleetId ?? null,
      driverId: params.driverId ?? null,
      serviceType: params.serviceType ?? 'tow',
      vehicleClass: 'flatbed',
      pickupLat: 12.97,
      pickupLng: 77.59,
      pickupAddress: params.pickupAddress ?? 'Indiranagar',
      status: params.status ?? 'paid',
      total: params.total ?? '0.00',
      taxAmount: params.taxAmount ?? '0.00',
      commissionBand: params.commissionBand ?? null,
      commissionPct: params.commissionPct ?? null,
      commissionAmount: params.commissionAmount ?? '0.00',
      driverPayout: params.driverPayout ?? '0.00',
      ...(params.createdAt ? { createdAt: params.createdAt, updatedAt: params.createdAt } : {}),
    })
    .returning({ id: bookings.id });
  return row!.id;
}

/**
 * A booking plus the customer it needs. Most money specs only care that a
 * booking id exists to hang `ref_id` on, and threading a customer through every
 * one of them is noise.
 */
export async function seedCustomerBooking(
  db: TestDatabase,
  params: Omit<Parameters<typeof seedBooking>[1], 'userId'> = {},
): Promise<string> {
  const userId = await seedCustomer(db);
  return seedBooking(db, { ...params, userId });
}

/**
 * Wallet + optional signed ledger rows for one owner.
 *
 * `wallets.balance` is written to SUM(entries) so the fixture leaves the
 * database satisfying the first ledger invariant. Before Phase 7 the balance
 * stayed at zero here, which was harmless while nothing read it — the payout
 * balance check reads it, and a fixture that silently violates the invariant it
 * is about to be tested against is a trap.
 *
 * This writes `wallet_transactions` directly and is therefore on
 * `sole-writer.spec.ts`'s allowlist: fixtures build arbitrary starting states
 * (including ones `LedgerService` would refuse), which is exactly what a test
 * fixture is for.
 */
export async function seedWalletWithLedger(
  db: TestDatabase,
  owner: { ownerId: string; ownerType: 'driver' | 'fleet' },
  entries: Array<{
    type: (typeof walletTransactions.$inferInsert)['type'];
    amount: string;
    createdAt?: Date;
    refId?: string;
  }> = [],
): Promise<string> {
  const [wallet] = await db
    .insert(wallets)
    .values({ ownerId: owner.ownerId, ownerType: owner.ownerType })
    .returning({ id: wallets.id });

  if (entries.length > 0) {
    await db.insert(walletTransactions).values(
      entries.map((entry, i) => ({
        walletId: wallet!.id,
        type: entry.type,
        amount: entry.amount,
        idempotencyKey: `test:${wallet!.id}:${i}`,
        ...(entry.refId ? { refId: entry.refId } : {}),
        ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
      })),
    );

    const balancePaise = entries.reduce((sum, e) => sum + rupeeStringToPaise(e.amount), 0);
    await db
      .update(wallets)
      .set({ balance: paiseToRupeeString(balancePaise) })
      .where(eq(wallets.id, wallet!.id));
  }

  return wallet!.id;
}
