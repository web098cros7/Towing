import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { paiseToRupeeString, rupeeStringToPaise } from '@towing/api-contracts';
import { computeSettlement } from '../../modules/money/settlement';
import { grainKeysForBookings } from '../../modules/money/earnings-projector';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import type { Band } from '@towing/api-contracts';
import { DB, type Database } from '../db.module';
import { ledgerKeys } from './idempotency-keys';
import {
  driftedWallets,
  ledgerInvariants,
  type DriftedWallet,
  type LedgerInvariants,
} from './invariants';
import {
  ownerKey,
  type LedgerLeg,
  type PostOptions,
  type PostResult,
  type PostedEntry,
  type WalletOwner,
} from './ledger.types';

/**
 * The leg types that move `earnings_daily`. Same list as the third ledger
 * invariant's — they answer the same question and must not diverge.
 */
const EARNING_LEG_TYPES = new Set(['driver_share_credit', 'fleet_share_credit', 'fare_credit']);

/**
 * The ONLY thing in the application that writes `wallet_transactions` (§14.1,
 * §3.4 "ledger-first wallets"). Enforced three ways, cheapest first:
 *
 *  1. `sole-writer.spec.ts` — a pure spec that walks `src/` and fails the build
 *     the moment a second writer appears. This is the primary mechanism: it
 *     costs milliseconds, needs no tooling, and catches the mistake in review.
 *  2. `uq_wallet_transactions_idempotency_key`, now NOT NULL (migration 0006).
 *     Even a rogue writer cannot double-credit if it reuses the key.
 *  3. The nightly reconciliation, which catches balance drift by any route.
 *
 * A `BEFORE INSERT` trigger gated on a session GUC is deliberately NOT shipped:
 * it would break `pnpm db:seed` (which writes directly and correctly),
 * `seedWalletWithLedger`, and any psql repair. It stays documented here as the
 * escalation if a second writer ever does appear in a hurry.
 *
 * The transaction shape below mirrors `src/db/seed/seed.ts` deliberately — the
 * seed is this phase's executable specification, and 757 seeded rows plus three
 * invariants already depend on that shape.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
  ) {}

  /**
   * Post a set of legs atomically.
   *
   * A leg whose key is already present is a REPLAY, not an error: queue
   * redeliveries and webhook retries want "already done, carry on". Callers
   * that must not report success for work they did not perform (the payout
   * HTTP route) inspect `result.replayed`.
   */
  async post(legs: readonly LedgerLeg[], options: PostOptions = {}): Promise<PostResult> {
    if (legs.length === 0) {
      return { entries: [], replayed: true, balances: new Map() };
    }

    for (const leg of legs) this.validate(leg);

    const result = await this.db.transaction(async (tx) => {
      // Resolve every owner to a wallet id first, then lock in a DETERMINISTIC
      // order. Two concurrent settlements touching the same driver+fleet pair
      // in opposite orders would otherwise deadlock.
      const owners = new Map<string, WalletOwner>();
      for (const leg of legs) owners.set(ownerKey(leg.owner), leg.owner);

      const walletIds = new Map<string, string>();
      for (const [key, owner] of owners) {
        // Production creates wallets lazily on first credit; the seed creates
        // them up front. Both end at the same place.
        await tx.execute(sql`
          insert into wallets (owner_id, owner_type)
          values (${owner.ownerId}::uuid, ${owner.ownerType}::wallet_owner_type)
          on conflict (owner_type, owner_id) do nothing
        `);
        const [row] = (await tx.execute(sql`
          select id from wallets
          where owner_type = ${owner.ownerType}::wallet_owner_type
            and owner_id = ${owner.ownerId}::uuid
        `)) as unknown as [{ id: string }];
        walletIds.set(key, row.id);
      }

      const balances = new Map<string, number>();
      for (const key of [...walletIds.keys()].sort()) {
        const [row] = (await tx.execute(sql`
          select balance from wallets where id = ${walletIds.get(key)!}::uuid for update
        `)) as unknown as [{ balance: string }];
        balances.set(key, rupeeStringToPaise(row.balance));
      }

      // Every lock is held; the caller's rule now sees a stable balance.
      options.precondition?.(balances);

      const entries: PostedEntry[] = [];
      for (const leg of legs) {
        const key = ownerKey(leg.owner);
        const walletId = walletIds.get(key)!;

        const inserted = (await tx.execute(sql`
          insert into wallet_transactions (wallet_id, type, amount, reason, ref_id, idempotency_key)
          values (
            ${walletId}::uuid,
            ${leg.type}::wallet_txn_type,
            ${paiseToRupeeString(leg.amountPaise)}::numeric,
            ${leg.reason},
            ${leg.refId ?? null}::uuid,
            ${leg.idempotencyKey}
          )
          on conflict (idempotency_key) do nothing
          returning id
        `)) as unknown as Array<{ id: string }>;

        if (inserted.length === 0) {
          // Replay: an earlier post already applied this leg's balance effect.
          // Applying it again is precisely the double-credit the unique key
          // exists to prevent.
          entries.push({ id: null, walletId, owner: leg.owner, amountPaise: leg.amountPaise, replayed: true });
          continue;
        }

        // `balance = balance + x` rather than a recompute: Postgres serialises
        // concurrent updates to one row, the NUMERIC arithmetic is exact, and a
        // `SET balance = (select sum(...))` would be O(entries) and grow without
        // bound over a wallet's life. That recompute survives only in reconcile().
        await tx.execute(sql`
          update wallets
             set balance = balance + ${paiseToRupeeString(leg.amountPaise)}::numeric,
                 updated_at = now()
           where id = ${walletId}::uuid
        `);

        balances.set(key, (balances.get(key) ?? 0) + leg.amountPaise);
        entries.push({
          id: inserted[0]!.id,
          walletId,
          owner: leg.owner,
          amountPaise: leg.amountPaise,
          replayed: false,
        });
      }

      return { entries, replayed: entries.every((e) => e.replayed), balances };
    });

    // AFTER COMMIT, never inside: enqueueing from within the transaction would
    // let a worker read the cell before the credit is visible, and a rollback
    // would leave a job for money that does not exist.
    await this.enqueueProjection(legs, result);

    return result;
  }

  /**
   * Push the affected `(fleet, IST day, driver)` keys onto the projection queue.
   *
   * Best-effort by design: a queue outage must not fail a credit that has
   * already committed. The nightly reconciliation re-enqueues any cell that
   * drifted, so a dropped job costs freshness, never correctness — which is the
   * same trade `FleetEventsService` makes when a publish fails.
   */
  private async enqueueProjection(legs: readonly LedgerLeg[], result: PostResult): Promise<void> {
    const bookingIds = [
      ...new Set(
        legs
          .filter((leg, i) => EARNING_LEG_TYPES.has(leg.type) && !result.entries[i]?.replayed)
          .map((leg) => leg.refId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (bookingIds.length === 0) return;

    try {
      const keys = await grainKeysForBookings(this.db, bookingIds);
      for (const key of keys) {
        await this.queue.enqueue('earnings.project', key, {
          // BullMQ refuses a duplicate id while the first job is still known, so
          // a burst of credits for one driver on one day collapses to a single
          // recompute — the coalescing MetricsBroadcaster buys with a debounce,
          // free here.
          jobId: `earn:${key.fleetId}:${key.day}:${key.driverId}`,
        });
      }
    } catch (error) {
      this.logger.warn(`earnings projection not enqueued: ${String(error)}`);
    }
  }

  /**
   * §14.3 booking settlement — the seed's exact two shapes, as a named
   * operation. Track B owns the capture trigger that calls it; Phase 7 ships
   * and tests it so Phase 19 extends a ledger rather than inventing one.
   */
  async creditBookingSettlement(input: {
    bookingId: string;
    totalPaise: number;
    band: Band;
    /** The percentage LOCKED on the booking; null falls back to the band default. */
    commissionPct?: number | null;
    driverId: string;
    /** Null for an independent driver — the whole pool is one `fare_credit`. */
    fleet: { fleetId: string; driverSharePct: number } | null;
  }): Promise<PostResult> {
    const settlement = computeSettlement({
      totalPaise: input.totalPaise,
      band: input.band,
      commissionPct: input.commissionPct ?? null,
      driverSharePct: input.fleet?.driverSharePct ?? null,
    });

    const pctLabel = input.fleet ? `${input.fleet.driverSharePct}% of pool` : 'independent';

    const legs: LedgerLeg[] = settlement.legs.map((leg) => {
      const owner: WalletOwner =
        leg.owner === 'driver'
          ? { ownerType: 'driver', ownerId: input.driverId }
          : { ownerType: 'fleet', ownerId: input.fleet!.fleetId };

      // §14.3: "Every credit stores the band + % applied, making driver-facing
      // math and finance reconciliation trivially auditable."
      const reason =
        leg.type === 'driver_share_credit'
          ? `Net earning (Band ${input.band}, ${pctLabel})`
          : leg.type === 'fleet_share_credit'
            ? `Fleet share (Band ${input.band}, ${100 - input.fleet!.driverSharePct}% of pool)`
            : `Net fare after commission (Band ${input.band}, independent)`;

      const idempotencyKey =
        leg.type === 'driver_share_credit'
          ? ledgerKeys.bookingDriverShare(input.bookingId)
          : leg.type === 'fleet_share_credit'
            ? ledgerKeys.bookingFleetShare(input.bookingId)
            : ledgerKeys.bookingNetFare(input.bookingId);

      return { owner, type: leg.type, amountPaise: leg.amountPaise, reason, refId: input.bookingId, idempotencyKey };
    });

    return this.post(legs);
  }

  /** Cached balance in paise. Zero for an owner with no wallet yet. */
  async balanceOf(owner: WalletOwner): Promise<number> {
    const rows = (await this.db.execute(sql`
      select balance from wallets
      where owner_type = ${owner.ownerType}::wallet_owner_type
        and owner_id = ${owner.ownerId}::uuid
    `)) as unknown as Array<{ balance: string }>;

    return rows.length === 0 ? 0 : rupeeStringToPaise(rows[0]!.balance);
  }

  /**
   * Compare one wallet's cached balance against SUM(ledger). Read-only on
   * purpose — **never auto-repair**. `SET balance = sum(ledger)` would erase
   * the evidence of the bug that produced the drift, leaving two problems.
   */
  async reconcile(walletId: string): Promise<{
    balancePaise: number;
    ledgerPaise: number;
    driftPaise: number;
  }> {
    const [row] = (await this.db.execute(sql`
      select w.balance,
             coalesce((select sum(amount) from wallet_transactions t where t.wallet_id = w.id), 0) as ledger
      from wallets w where w.id = ${walletId}::uuid
    `)) as unknown as [{ balance: string; ledger: string }];

    const balancePaise = rupeeStringToPaise(row.balance);
    const ledgerPaise = rupeeStringToPaise(row.ledger);
    return { balancePaise, ledgerPaise, driftPaise: balancePaise - ledgerPaise };
  }

  /** The three §14 invariants. All zero on a healthy database. */
  invariants(): Promise<LedgerInvariants> {
    return ledgerInvariants(this.db);
  }

  /** The rows behind a non-zero `walletDrift`, for the nightly job's log. */
  driftedWallets(limit?: number): Promise<DriftedWallet[]> {
    return driftedWallets(this.db, limit);
  }

  /**
   * Fail fast, before the database is touched. The CHECK constraint and the
   * unique key are the backstops — they are not the place to produce a
   * readable error message.
   */
  private validate(leg: LedgerLeg): void {
    if (!Number.isSafeInteger(leg.amountPaise)) {
      throw new Error(`Ledger leg amount must be integer paise, got ${leg.amountPaise}`);
    }
    if (leg.amountPaise === 0) {
      throw new Error(`Ledger leg amount must be non-zero (${leg.idempotencyKey})`);
    }
    if (!leg.idempotencyKey.trim()) {
      throw new Error('Ledger leg is missing an idempotency key');
    }

    // A sign that disagrees with the type is a units or direction bug, and it
    // would balance the books while telling the wrong story in every report.
    const mustBePositive = leg.type.endsWith('_credit');
    const mustBeNegative = leg.type.endsWith('_debit');
    if (mustBePositive && leg.amountPaise < 0) {
      throw new Error(`${leg.type} must be a positive amount (${leg.idempotencyKey})`);
    }
    if (mustBeNegative && leg.amountPaise > 0) {
      throw new Error(`${leg.type} must be a negative amount (${leg.idempotencyKey})`);
    }
  }
}
