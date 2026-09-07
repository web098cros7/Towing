import type {
  DriverEarningsSummaryDto,
  DriverPayoutDto,
  DriverPayoutAccountDto,
  DriverTransactionsResponse,
  DriverTripsResponse,
  DriverWeeklyResponse,
  PayoutsListResponse,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { EarningsDataSource } from './earningsDataSource';
import type {
  EarningsData,
  EarningsPeriod,
  EarningsTrip,
  EarningsWeek,
  Payout,
  PayoutAccount,
  Transaction,
  TransactionKind,
} from '../types';

/**
 * §9.2.4 against the real server.
 *
 * EVERY AMOUNT ARRIVES AS INTEGER PAISE and is carried through unconverted —
 * that is what makes the acceptance criterion ("the driver's displayed earnings
 * reconcile to the paisa against a direct ledger query") checkable at all. The
 * only arithmetic here is the summary's `avgPerJob`, and it rounds once.
 */
export const earningsRestSource: EarningsDataSource = {
  async getEarnings(period: EarningsPeriod): Promise<EarningsData> {
    const { from, to } = windowFor(period);

    const [summary, feed] = await Promise.all([
      apiFetch<DriverEarningsSummaryDto>(`driver/earnings?from=${from}&to=${to}`),
      apiFetch<DriverTransactionsResponse>('driver/wallet/transactions?limit=30'),
    ]);

    return {
      summary: {
        totalPaise: summary.totals.netPaise,
        // The server does not compute a period-over-period delta and inventing
        // one client-side would be a number nobody could reconcile. Zero until
        // there is a real one.
        deltaPercent: 0,
        jobsCompleted: summary.totals.jobs,
        avgPerJobPaise:
          summary.totals.jobs > 0 ? Math.round(summary.totals.netPaise / summary.totals.jobs) : 0,
        // `bonus` has no ledger leg type of its own — the reward engine (§3.6)
        // is a §29 roadmap item — so it is honestly zero rather than a guess.
        bonusPaise: 0,
      },
      wallet: {
        balancePaise: summary.wallet.balancePaise,
        availablePaise: summary.wallet.availablePaise,
        minPayoutPaise: summary.wallet.minPayoutPaise,
        maxPayoutPaise: summary.wallet.maxPayoutPaise,
        payoutAccountLinked: summary.wallet.payoutAccountLinked,
      },
      trend: summary.trend.map((point) => ({ day: point.day, valuePaise: point.netPaise })),
      transactions: feed.items.map(toTransaction),
    };
  },

  async getTrips(cursor?: string): Promise<{ items: EarningsTrip[]; nextCursor: string | null }> {
    const query = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
    const response = await apiFetch<DriverTripsResponse>(`driver/earnings/trips${query}`);

    return {
      items: response.items.map((item) => ({
        bookingId: item.bookingId,
        jobCode: item.jobCode,
        settledAt: item.settledAt,
        grossPaise: item.grossPaise,
        commissionBand: item.commissionBand,
        commissionPct: item.commissionPct,
        commissionPaise: item.commissionPaise,
        // The DRIVER's half, never the pool and never the fleet's — a fleet
        // driver seeing `poolPaise` here would be shown money that is not
        // theirs.
        netPaise: item.driverSharePaise,
        fleetSharePaise: item.fleetSharePaise,
      })),
      nextCursor: response.nextCursor,
    };
  },

  async getWeekly(): Promise<EarningsWeek[]> {
    const response = await apiFetch<DriverWeeklyResponse>('driver/earnings/weekly');
    return response.weeks.map((week) => ({
      weekStart: week.weekStart,
      jobs: week.jobs,
      grossPaise: week.grossPaise,
      commissionPaise: week.commissionPaise,
      netPaise: week.netPaise,
    }));
  },

  async listPayouts(): Promise<Payout[]> {
    const response = await apiFetch<PayoutsListResponse>('driver/payouts?page=1&limit=20');
    return response.items.map(toPayout);
  },

  /**
   * §14.4's request.
   *
   * THE KEY IS PASSED AS AN EXPLICIT HEADER, not via `idempotent: true`.
   * `mintIdempotencyKey` generates one per `apiFetch` CALL, so a driver's second
   * tap would carry a different key and become a second payout. The dialog
   * holds one key for the whole intent — the same discipline the web console's
   * `RequestPayoutDialog` has used since Phase 7.
   */
  async requestPayout(amountPaise: number, idempotencyKey: string): Promise<Payout> {
    const payout = await apiFetch<DriverPayoutDto>('driver/payouts', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ amountPaise }),
    });
    return toPayout(payout);
  },

  async getPayoutAccount(): Promise<PayoutAccount> {
    return apiFetch<DriverPayoutAccountDto>('driver/payout-account');
  },

  /**
   * The full account number goes to the server, which forwards it to Razorpay
   * Route and persists only the last four digits and a fingerprint. It is never
   * stored on the device and never comes back.
   */
  async linkPayoutAccount(input: {
    beneficiaryName: string;
    accountNumber: string;
    ifsc: string;
  }): Promise<PayoutAccount> {
    return apiFetch<DriverPayoutAccountDto>('driver/payout-account', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};

function toPayout(dto: DriverPayoutDto): Payout {
  return {
    id: dto.id,
    amountPaise: dto.amountPaise,
    status: dto.status,
    approvalState: dto.approvalState,
    rejectionReason: dto.rejectionReason,
    requestedAt: dto.requestedAt,
    paidAt: dto.paidAt,
    failureReason: dto.failureReason,
  };
}

/**
 * A raw ledger leg, as a person reads it.
 *
 * The server sends the LEDGER TYPE, which is the vocabulary of §14.1 rather
 * than of a driver. Mapping it here rather than server-side keeps the wire
 * honest — a client that wanted the raw type still has it — while the screen
 * gets something it can put an icon beside.
 */
function toTransaction(dto: DriverTransactionsResponse['items'][number]): Transaction {
  return {
    id: dto.id,
    title: labelFor(dto.type, dto.reason),
    settledAt: dto.createdAt,
    // SIGNED, carried through untouched.
    amountPaise: dto.amountPaise,
    kind: kindFor(dto.type),
    statusLabel: statusFor(dto.type),
  };
}

function kindFor(type: string): TransactionKind {
  switch (type) {
    case 'payout_debit':
      return 'payout';
    case 'refund_debit':
    case 'refund_credit':
      return 'refund';
    case 'adjustment':
      return 'adjustment';
    default:
      // `driver_share_credit` and `fare_credit` — a completed trip.
      return 'job';
  }
}

function labelFor(type: string, reason: string | null): string {
  // The ledger's own `reason` is written for a person (§14.3 requires the band
  // and % in it), so prefer it and fall back only when it is absent.
  if (reason) return reason;
  return type === 'payout_debit' ? 'Payout to bank' : 'Trip earnings';
}

function statusFor(type: string): string {
  switch (type) {
    case 'payout_debit':
      return 'Withdrawn';
    case 'refund_debit':
      return 'Reversed';
    case 'adjustment':
      return 'Adjusted';
    default:
      return 'Credited';
  }
}

/**
 * The IST window for a period.
 *
 * IST, not UTC, and for the reason the backend's own helper documents: the
 * server filters on `(settled_at at time zone 'Asia/Kolkata')::date`, so a
 * boundary computed in UTC disagrees with it by a day between midnight and
 * 05:30 IST — and a driver checking their earnings after a night shift would
 * see the night missing.
 */
function windowFor(period: EarningsPeriod): { from: string; to: string } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istDate = (at: number) => new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10);

  const now = Date.now();
  const days = period === 'week' ? 7 : 30;

  if (period === 'lastMonth') {
    return { from: istDate(now - 60 * 86_400_000), to: istDate(now - 30 * 86_400_000) };
  }

  return { from: istDate(now - days * 86_400_000), to: istDate(now) };
}
