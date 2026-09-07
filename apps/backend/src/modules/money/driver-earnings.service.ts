import { Injectable } from '@nestjs/common';
import { rupeeStringToPaise } from '@towing/api-contracts';
import type {
  DriverEarningsSummaryDto,
  DriverTransactionsResponse,
  DriverTripsResponse,
  DriverWeeklyResponse,
  JobSplitDto,
} from '@towing/api-contracts';
import { ENV, type Env } from '../../config/env';
import { Inject } from '@nestjs/common';
import { DriverEarningsRepo } from './driver-earnings.repo';
import { PayoutAccountsRepo } from './payout-accounts.repo';

/**
 * §9.2.4's earnings, shaped for the driver app.
 *
 * Every number that crosses the wire is INTEGER PAISE, converted here from the
 * NUMERIC rupee strings the database holds. The driver app's `formatINR` took
 * rupees until Phase 19 and every call site divided by 100 inline; making the
 * wire unambiguous is what let that be fixed once rather than at fifteen call
 * sites, and §9.2.4's "reconciles to the paisa" was unpassable until it was.
 */
@Injectable()
export class DriverEarningsService {
  /** A month, matching the fleet console's default window. */
  private static readonly DEFAULT_WINDOW_DAYS = 30;

  constructor(
    private readonly repo: DriverEarningsRepo,
    private readonly accounts: PayoutAccountsRepo,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async summary(
    driverId: string,
    query: { from?: string; to?: string },
  ): Promise<DriverEarningsSummaryDto> {
    const { from, to } = window(query, DriverEarningsService.DEFAULT_WINDOW_DAYS);

    const [totals, trend, position, account] = await Promise.all([
      this.repo.totals(driverId, from, to),
      this.repo.dailyTrend(driverId, from, to),
      this.repo.walletPosition(driverId),
      this.accounts.byOwner({ ownerType: 'driver', ownerId: driverId }),
    ]);

    const balancePaise = rupeeStringToPaise(position.balance);
    const lockedPaise = rupeeStringToPaise(position.locked);

    return {
      period: { from, to },
      wallet: {
        balancePaise,
        // Already net of money held in open payouts, so the app never does that
        // arithmetic and can never disagree with the server's own check.
        availablePaise: balancePaise - lockedPaise,
        // Server-driven so the app's disabled state is not a second hardcoded
        // copy of the limits that can drift.
        minPayoutPaise: this.env.PAYOUT_MIN_PAISE,
        maxPayoutPaise: this.env.PAYOUT_MAX_PAISE,
        payoutAccountLinked: account?.status === 'active',
      },
      totals: {
        jobs: totals.jobs,
        grossPaise: rupeeStringToPaise(totals.gross),
        commissionPaise: rupeeStringToPaise(totals.commission),
        netPaise: rupeeStringToPaise(totals.net),
      },
      trend: trend.map((point) => ({
        day: point.day,
        jobs: point.jobs,
        netPaise: rupeeStringToPaise(point.net),
      })),
    };
  }

  async trips(
    driverId: string,
    query: { from?: string; to?: string; cursor?: string; limit: number },
  ): Promise<DriverTripsResponse> {
    const cursor = decodeCursor(query.cursor);
    // One extra row decides `nextCursor` without a second count query — the
    // cursor convention this codebase already uses everywhere.
    const rows = await this.repo.perTripFeed(driverId, query, cursor, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];

    const items: JobSplitDto[] = page.map((row) => {
      const grossPaise = rupeeStringToPaise(row.total);
      const commissionPaise = rupeeStringToPaise(row.commissionAmount);
      const driverSharePaise = rupeeStringToPaise(row.driverShare);
      const fleetSharePaise = rupeeStringToPaise(row.fleetShare);

      return {
        bookingId: row.bookingId,
        jobCode: `TW-${row.bookingId.slice(0, 8).toUpperCase()}`,
        settledAt: row.settledAt.toISOString(),
        driverId,
        driverName: null,
        grossPaise,
        commissionBand: row.commissionBand,
        commissionPct: row.commissionPct === null ? null : Number(row.commissionPct),
        commissionPaise,
        poolPaise: driverSharePaise + fleetSharePaise,
        driverSharePaise,
        fleetSharePaise,
      };
    });

    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.bookingId })
          : null,
    };
  }

  async weekly(driverId: string, weeks = 8): Promise<DriverWeeklyResponse> {
    const rows = await this.repo.weekly(driverId, weeks);
    return {
      weeks: rows.map((row) => ({
        weekStart: row.weekStart,
        jobs: row.jobs,
        grossPaise: rupeeStringToPaise(row.gross),
        commissionPaise: rupeeStringToPaise(row.commission),
        netPaise: rupeeStringToPaise(row.net),
      })),
    };
  }

  async transactions(
    driverId: string,
    query: { cursor?: string; limit: number },
  ): Promise<DriverTransactionsResponse> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.repo.transactions(driverId, cursor, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        id: row.id,
        // SIGNED. Payout debits, cancellation compensation and §14.5 reversals
        // all live in this feed, so the driver app renders negatives here — the
        // reason `formatINR` needed its sign bug fixed in the same phase.
        amountPaise: rupeeStringToPaise(row.amount),
        type: row.type,
        reason: row.reason,
        bookingId: row.refId,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
}

/**
 * The default window, IN IST.
 *
 * ⚠ THIS WAS A REAL BUG AND IT COST A DAY OF EARNINGS FOR FIVE AND A HALF
 * HOURS OUT OF EVERY TWENTY-FOUR. The repo filters on
 * `(settled_at at time zone 'Asia/Kolkata')::date`, but the default window was
 * computed from `new Date().toISOString()`, which is UTC. Between 00:00 and
 * 05:30 IST those two disagree by a day: a trip settled at 01:00 IST has IST
 * date `D`, while the window ran to `D-1`, so a driver checking their earnings
 * after midnight saw the night's work simply missing.
 *
 * Found by an e2e spec that happened to run at 02:33 IST. It would not have
 * been found by one that ran in the afternoon, which is the argument for
 * computing the boundary in the same timezone the query filters in rather than
 * hoping the two agree.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDate(at: number): string {
  return new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function window(
  query: { from?: string; to?: string },
  days: number,
): { from: string; to: string } {
  const now = Date.now();
  const to = query.to ?? istDate(now);
  const from = query.from ?? istDate(now - days * 86_400_000);
  return { from, to };
}

function encodeCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(`${value.createdAt.toISOString()}|${value.id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!iso || !id) return undefined;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? undefined : { createdAt, id };
  } catch {
    // A malformed cursor is a first page, not a 400. It can only come from a
    // truncated deep link or an old client, and neither deserves an error.
    return undefined;
  }
}
