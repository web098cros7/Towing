import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NotificationService } from '../../common/notifications/notification.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { ENV, type Env } from '../../config/env';
import { DB, type Database } from '../../db/db.module';
import { purgeWaveLogs, writeDay } from './analytics-rollup';

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

function istDayKey(at: Date): string {
  return new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Owns W17's two scheduled jobs:
 *
 *  · `analytics.rollup` — recompute the just-closed IST day ABSOLUTELY, then
 *    purge `dispatch_wave_logs` past 30 days. Cron `ANALYTICS_ROLLUP_CRON`
 *    (default 00:15 IST: the day is closed at midnight and the job must run
 *    after it; `earnings.reconcile`'s 01:00 IST is the same reasoning, an
 *    hour later so the two heavy sweeps do not overlap).
 *  · `analytics.report-email` — the weekly digest to the ops mailbox, Monday
 *    08:00 IST. Deduped per week at the trigger, so a redelivery cannot send
 *    the week twice.
 *
 * Single ownership across N tasks is the BullMQ scheduler's Redis dedup —
 * the same property every other cron in this repo leans on.
 */
@Injectable()
export class AnalyticsRollupService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsRollupService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.process('analytics.rollup', async (payload) => {
      await this.roll(payload.reason, payload.day);
    });

    this.queue.process('analytics.report-email', async (payload) => {
      await this.weeklyReport(payload.week);
    });

    await this.queue.schedule(
      'analytics.rollup',
      { reason: 'cron' },
      this.env.ANALYTICS_ROLLUP_CRON,
    );
    await this.queue.schedule(
      'analytics.report-email',
      { reason: 'cron' },
      this.env.ANALYTICS_REPORT_CRON,
    );
  }

  /** The day a run targets when none is given: yesterday in IST. */
  targetDay(day?: string): string {
    return day ?? istDayKey(new Date(Date.now() - DAY_MS));
  }

  async roll(reason: 'cron' | 'manual', day?: string): Promise<string> {
    const target = this.targetDay(day);
    await writeDay(this.db, target);
    const purged = await purgeWaveLogs(this.db);
    this.logger.log(
      `analytics rollup ${target} (${reason}): recomputed; purged ${purged} wave log(s) > 30d`,
    );
    return target;
  }

  /**
   * The weekly digest. Reads the rollups for the trailing 7 days — the cron
   * runs after Sunday's rollup, so the week is closed. Missing days are
   * reported as such rather than back-filled here: a digest that quietly
   * recomputed the week would hide a failed nightly job, which is the one
   * thing the recipients need to know about.
   */
  async weeklyReport(week?: string): Promise<{ week: string; days: number }> {
    const end = this.targetDay(week);
    const start = addDays(end, -6);

    const rows = (await this.db.execute(sql`
      select day::text as day, bookings_created, bookings_matched, bookings_paid,
             bookings_cancelled, no_drivers_found,
             gmv_paise::float8 as gmv_paise, commission_paise::float8 as commission_paise,
             refunds_paise::float8 as refunds_paise, fill_rate_bps
        from analytics_daily
       where day >= ${start}::date and day <= ${end}::date
       order by day asc
    `)) as unknown as Array<{
      day: string;
      bookings_created: number;
      bookings_matched: number;
      bookings_paid: number;
      bookings_cancelled: number;
      no_drivers_found: number;
      gmv_paise: number;
      commission_paise: number;
      refunds_paise: number;
      fill_rate_bps: number;
    }>;

    const rupees = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;
    const lines = rows.map(
      (row) =>
        `${row.day}: created ${row.bookings_created}, matched ${row.bookings_matched}, ` +
        `paid ${row.bookings_paid}, cancelled ${row.bookings_cancelled}, ` +
        `no-drivers ${row.no_drivers_found}, GMV ${rupees(Number(row.gmv_paise))}, ` +
        `commission ${rupees(Number(row.commission_paise))}, ` +
        `refunds ${rupees(Number(row.refunds_paise))}, fill ${(row.fill_rate_bps / 100).toFixed(1)}%`,
    );

    const totals = rows.reduce(
      (acc, row) => ({
        gmv: acc.gmv + Number(row.gmv_paise),
        commission: acc.commission + Number(row.commission_paise),
        paid: acc.paid + row.bookings_paid,
        created: acc.created + row.bookings_created,
      }),
      { gmv: 0, commission: 0, paid: 0, created: 0 },
    );

    const headline =
      `Week ${start} to ${end}: ${totals.created} bookings, ${totals.paid} paid, ` +
      `GMV ${rupees(totals.gmv)}, commission ${rupees(totals.commission)}`;

    const summary = [headline, ...(lines.length > 0 ? lines : ['No rollup rows for this week.'])].join(
      '\n',
    );

    await this.notifications.emit('analytics.report', {
      week: `${start} to ${end}`,
      reportEmail: this.env.ANALYTICS_REPORT_EMAIL,
      summary,
    });

    this.logger.log(`analytics weekly report sent for ${start}..${end} (${rows.length} day rows)`);
    return { week: `${start} to ${end}`, days: rows.length };
  }
}
