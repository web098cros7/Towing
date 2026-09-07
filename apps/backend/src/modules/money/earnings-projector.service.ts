import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { NotificationService } from '../../common/notifications/notification.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { LedgerService } from '../../db/ledger/ledger.service';
import { REDIS } from '../../redis/redis.constants';
import type Redis from 'ioredis';
import { projectCell, projectionDrift } from './earnings-projector';
import { reconcilePayoutAlerts } from './payout-alerts';

/** What `GET /v1/health/ledger` serves and the nightly job writes to Redis. */
export interface ReconcileReport {
  checkedAt: string;
  walletDrift: number;
  bookingDrift: number;
  ledgerDrift: number;
  reversalDrift: number;
  couponDrift: number;
  projectionDrift: number;
  maxDeltaPaise: number;
  payoutAlertsReconciled: number;
}

const LAST_RECONCILE_KEY = 'ledger:reconcile:last';

/**
 * Owns the two scheduled money jobs:
 *
 *  · `earnings.project` — one cell of the read projection, enqueued by
 *    `LedgerService` after every settlement commit.
 *  · `earnings.reconcile` — the §14.1 nightly ("`wallets.balance` … reconciled
 *    against the ledger") with a drift alarm.
 *
 * Single ownership across N tasks comes free from the BullMQ scheduler's Redis
 * dedup, exactly as it does for the compliance sweep. `@nestjs/schedule` would
 * run this N times.
 */
@Injectable()
export class EarningsProjectorService implements OnModuleInit {
  private readonly logger = new Logger(EarningsProjectorService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly ledger: LedgerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.process('earnings.project', async (payload) => {
      await projectCell(this.db, payload);
    });

    this.queue.process('earnings.reconcile', async (payload) => {
      await this.reconcile(payload.reason, payload.days);
    });

    await this.queue.schedule(
      'earnings.reconcile',
      { reason: 'cron' },
      this.env.LEDGER_RECONCILE_CRON,
    );
  }

  /**
   * The nightly audit. Throws on drift so BullMQ records a failed job, which
   * raises `deadLettered` on `GET /v1/health/queues` and fires the depth alarm
   * that already exists — the cheapest real alarm available, built out of
   * shipped infrastructure rather than a new one.
   *
   * **Never auto-repairs.** `SET balance = sum(ledger)` would erase the evidence
   * of the bug that produced the drift, leaving two problems instead of one.
   * Repair is a deliberate, logged, human action.
   */
  async reconcile(reason: 'cron' | 'manual', days?: number): Promise<ReconcileReport> {
    const started = Date.now();
    const invariants = await this.ledger.invariants();
    const drifted = await this.ledger.driftedWallets();

    for (const wallet of drifted) {
      this.logger.error(
        `LEDGER DRIFT wallet=${wallet.walletId} owner=${wallet.ownerType}:${wallet.ownerId} ` +
          `balance=${wallet.balancePaise}p ledger=${wallet.ledgerPaise}p delta=${wallet.deltaPaise}p`,
      );
    }

    // Self-healing: a stale cell is re-enqueued rather than merely counted.
    const stale = await projectionDrift(this.db, { sinceDays: days ?? 7 });
    for (const cell of stale) {
      this.logger.warn(
        `projection drift ${cell.key.fleetId}/${cell.key.day}/${cell.key.driverId}: ` +
          `projected ${cell.projectedGross} vs ledger ${cell.ledgerGross}`,
      );
      await this.queue.enqueue('earnings.project', cell.key, {
        jobId: `earn:${cell.key.fleetId}:${cell.key.day}:${cell.key.driverId}:heal`,
      });
    }

    // Closes the loop the Phase 6 hourly sweep used to close. `markFailed` and
    // `markPaid` maintain these alerts at the point of transition; this catches
    // the case where a payout status changed by some other route entirely.
    const payoutAlertsReconciled = await reconcilePayoutAlerts(this.db);

    const report: ReconcileReport = {
      checkedAt: new Date().toISOString(),
      walletDrift: invariants.walletDrift,
      bookingDrift: invariants.bookingDrift,
      ledgerDrift: invariants.ledgerDrift,
      reversalDrift: invariants.reversalDrift,
      couponDrift: invariants.couponDrift,
      projectionDrift: stale.length,
      maxDeltaPaise: drifted.reduce((max, w) => Math.max(max, Math.abs(w.deltaPaise)), 0),
      payoutAlertsReconciled,
    };

    await this.redis.set(LAST_RECONCILE_KEY, JSON.stringify(report), 'EX', 172_800);

    const totalDrift =
      invariants.walletDrift +
      invariants.bookingDrift +
      invariants.ledgerDrift +
      invariants.reversalDrift +
      invariants.couponDrift;

    this.logger.log(
      `ledger reconcile (${reason}) in ${Date.now() - started}ms — ` +
        `wallet ${invariants.walletDrift}, booking ${invariants.bookingDrift}, ` +
        `ledger ${invariants.ledgerDrift}, reversal ${invariants.reversalDrift}, ` +
        `coupon ${invariants.couponDrift}, projection ${stale.length}, ` +
        `payout alerts ${payoutAlertsReconciled}`,
    );

    if (report.maxDeltaPaise > this.env.LEDGER_DRIFT_TOLERANCE_PAISE && totalDrift > 0) {
      try {
        // An OPERATIONAL alarm, not a §12.2 product row — its recipient is an
        // ops mailbox rather than a subject in the database, which is why the
        // trigger synthesises a recipient and writes no inbox row. Not to be
        // confused with §12.2's "Earnings credited", which is Phase 19.
        await this.notifications.emit('ops.ledger_drift', {
          day: report.checkedAt.slice(0, 10),
          driftPaise: report.maxDeltaPaise,
          opsEmail: this.env.LEDGER_OPS_EMAIL,
        });
      } catch (error) {
        this.logger.warn(`drift notification failed: ${String(error)}`);
      }

      throw new Error(
        `Ledger reconciliation found drift: wallet=${invariants.walletDrift} ` +
          `booking=${invariants.bookingDrift} ledger=${invariants.ledgerDrift} ` +
          `maxDelta=${report.maxDeltaPaise}p`,
      );
    }

    return report;
  }

  /** The last stored report, for `GET /v1/health/ledger`. */
  async lastReport(): Promise<ReconcileReport | null> {
    const raw = await this.redis.get(LAST_RECONCILE_KEY);
    return raw ? (JSON.parse(raw) as ReconcileReport) : null;
  }
}
