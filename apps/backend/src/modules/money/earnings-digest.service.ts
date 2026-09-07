import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { rupeeStringToPaise } from '@towing/api-contracts';
import { NotificationService } from '../../common/notifications/notification.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ENV, type Env } from '../../config/env';
import { DriverEarningsRepo } from './driver-earnings.repo';

/**
 * §12.2's *Weekly earnings summary*.
 *
 * The `weeklySummary` preference key shipped in Phase 13 SPECIFICALLY so this
 * opt-out existed before the first send ever went out — `alwaysOn: false` on
 * the trigger is what honours it.
 *
 * SCHEDULED ON `QueuePort`, like every other recurring job here: Redis keys the
 * timer, so N Fargate tasks converge on one send rather than N. A driver
 * receiving four copies of their week is a worse bug than receiving none.
 */
@Injectable()
export class EarningsDigestService implements OnModuleInit {
  private readonly logger = new Logger(EarningsDigestService.name);

  /** Look-back for "who earned last week". One week plus a day of slack. */
  private static readonly WINDOW_DAYS = 8;

  constructor(
    private readonly repo: DriverEarningsRepo,
    private readonly notifications: NotificationService,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.process('earnings.weekly-digest', async (payload) => {
      await this.send(payload.reason);
    });

    await this.queue.schedule(
      'earnings.weekly-digest',
      { reason: 'cron' },
      this.env.EARNINGS_WEEKLY_CRON,
    );
  }

  /**
   * One digest per driver who earned in the window.
   *
   * A driver who earned NOTHING gets nothing. "You earned ₹0 across 0 trips" is
   * not a summary, it is a reminder that they had a bad week, and §12.2 asks
   * for a summary.
   */
  async send(reason: 'cron' | 'manual'): Promise<{ drivers: number; sent: number }> {
    const started = Date.now();
    const drivers = await this.repo.driversWithEarningsSince(EarningsDigestService.WINDOW_DAYS);

    let sent = 0;

    for (const driverId of drivers) {
      // Per driver, so one bad row cannot cost everybody else their digest.
      try {
        const [week] = await this.repo.weekly(driverId, 1);
        if (!week || week.jobs === 0) continue;

        const netPaise = rupeeStringToPaise(week.net);
        if (netPaise <= 0) continue;

        await this.notifications.emit('earnings.weekly', {
          driverId,
          // PRE-FORMATTED. Templates never do money arithmetic — the house rule
          // for every §12.2 payload.
          amount: `₹${(netPaise / 100).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`,
          jobs: String(week.jobs),
          weekLabel: week.weekStart,
        });
        sent += 1;
      } catch (error) {
        this.logger.warn(`weekly digest failed for driver ${driverId}: ${String(error)}`);
      }
    }

    this.logger.log(
      `weekly earnings digest (${reason}) in ${Date.now() - started}ms — ` +
        `${drivers.length} drivers earned, ${sent} digests emitted`,
    );

    return { drivers: drivers.length, sent };
  }
}
