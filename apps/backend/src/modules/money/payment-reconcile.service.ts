import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ENV, type Env } from '../../config/env';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from './payment-gateway.port';
import { PaymentsRepo } from './payments.repo';
import { PaymentsService } from './payments.service';

/**
 * §19.3's payment status sweep — "a missed webhook is reconciled by scheduled
 * polling (e.g., payment status sweep every 5 min)", almost verbatim.
 *
 * A BULLMQ REPEATABLE, NOT A CRON, and the `QueuePort` docstring named this
 * exact job as the reason: implemented as a `setInterval` or `@Cron` it would
 * run N times concurrently across N Fargate tasks against the same uncaptured
 * payment — the double-credit failure mode Phase 17 refuses to accept for
 * offers. `schedule()` keys the timer in Redis via `upsertJobScheduler`, so
 * every task converges on one.
 *
 * The sweep is also the reason §19.2's "COMPLETED (unpaid)" is a survivable
 * state rather than a stuck one: a customer whose webhook was lost and whose
 * app died mid-capture is settled within five minutes without anybody noticing.
 */
@Injectable()
export class PaymentReconcileService implements OnModuleInit {
  private readonly logger = new Logger(PaymentReconcileService.name);

  /**
   * How long a payment must have sat untouched before the sweep asks about it.
   * Short, but non-zero: without it the sweep races an intent another process
   * created a moment ago and is still working on.
   */
  private static readonly GRACE_MINUTES = 2;

  constructor(
    private readonly repo: PaymentsRepo,
    private readonly payments: PaymentsService,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.process('payments.reconcile', async (payload) => {
      await this.reconcile(payload.reason);
    });

    // The dev gateway's delayed settle, only ever enqueued when
    // `PAYMENT_DEV_SETTLE_MS > 0` — the default of 0 captures inline.
    this.queue.process('payments.dev-settle', async (payload) => {
      const row = await this.repo.byId(payload.paymentId);
      if (!row || row.status === 'captured') return;
      const handle = await this.gateway.fetchPayment({
        gatewayRef: payload.gatewayRef,
        orderRef: row.gatewayOrderRef,
      });
      if (handle.status === 'captured') {
        await this.payments.settleCapturedPayment(row.bookingId, handle);
      }
    });

    await this.queue.schedule(
      'payments.reconcile',
      { reason: 'cron' },
      this.env.PAYMENT_RECONCILE_CRON,
    );
  }

  /**
   * One sweep pass.
   *
   * Called directly by the tests, which run with `QUEUE_ENABLED=false` and so
   * never see the scheduled job fire — the same arrangement
   * `payout-reconcile.e2e.spec.ts` uses.
   */
  async reconcile(reason: 'cron' | 'manual'): Promise<{
    checked: number;
    settled: number;
    failed: number;
  }> {
    const started = Date.now();
    const stale = await this.repo.staleUncaptured(PaymentReconcileService.GRACE_MINUTES, 200);

    let settled = 0;
    let failed = 0;

    for (const payment of stale) {
      // Per-payment, so one vendor blip cannot fail the whole tick and leave
      // every payment after it in the list unswept until the next one.
      try {
        const handle = await this.gateway.fetchPayment({
          gatewayRef: payment.gatewayRef,
          orderRef: payment.gatewayOrderRef,
        });

        if (handle.status === 'captured') {
          await this.payments.settleCapturedPayment(payment.bookingId, handle);
          settled += 1;
          continue;
        }

        if (handle.status === 'failed') {
          await this.payments.markFailed(
            payment.id,
            handle.failureReason ?? 'The gateway reported this payment as failed',
          );
          failed += 1;
          continue;
        }

        // Still pending, and old enough that it never will be. §19.2: THE
        // BOOKING STAYS `completed`. A customer whose payment never went
        // through has an unpaid booking, not a cancelled one, and ops can
        // intervene — the spec's own words.
        const ageMinutes = (Date.now() - payment.updatedAt.getTime()) / 60_000;
        if (ageMinutes >= this.env.PAYMENT_STUCK_MINUTES) {
          await this.payments.markFailed(payment.id, 'The gateway never confirmed this payment');
          failed += 1;
        }
      } catch (error) {
        this.logger.warn(`payment ${payment.id} reconcile failed: ${String(error)}`);
      }
    }

    this.logger.log(
      `payment reconcile (${reason}) in ${Date.now() - started}ms — ` +
        `checked ${stale.length}, settled ${settled}, failed ${failed}`,
    );

    return { checked: stale.length, settled, failed };
  }
}
