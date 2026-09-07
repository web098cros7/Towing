import type { Band } from '@towing/api-contracts';

/** Which window the earnings screen is showing. */
export type EarningsPeriod = 'week' | 'month' | 'lastMonth' | 'custom';

/**
 * §9.2.4's earnings.
 *
 * ⚠ EVERYTHING IS INTEGER PAISE, and the `Paise` suffix on every field is the
 * point rather than pedantry. Until Phase 19 these were plain rupee numbers
 * fed by a hardcoded mock, while the real API has always spoken paise — so
 * every live call site divided by 100 inline and every mocked one did not. One
 * missed conversion in that arrangement is a 100× error rendered on a driver's
 * earnings screen, and §9.2.4's "reconciles to the paisa" acceptance criterion
 * was unpassable while it persisted.
 */
export type EarningsSummary = {
  totalPaise: number;
  /** Change vs the previous comparable window, e.g. +12.5. */
  deltaPercent: number;
  jobsCompleted: number;
  avgPerJobPaise: number;
  bonusPaise: number;
};

/** One point on the earnings trend chart. */
export type EarningsPoint = {
  /**
   * The IST day, as an ISO date.
   *
   * NOT A PRE-FORMATTED LABEL. The mock used strings like `'12 May'`, and a
   * server that hands those out has already decided the locale and the timezone
   * for every client — the exact correction Phase 15 made on the customer side.
   * The chart formats it.
   */
  day: string;
  valuePaise: number;
};

/**
 * What moved the balance.
 *
 * `job` and `bonus` were the only two until Phase 19. The wallet feed is the
 * raw ledger, so it also carries payout debits, §3.5 cancellation compensation
 * and §14.5 reversals — all of which are things a driver whose balance changed
 * deserves to see the row for.
 */
export type TransactionKind = 'job' | 'bonus' | 'payout' | 'adjustment' | 'refund';

export type Transaction = {
  id: string;
  title: string;
  /** ISO instant. Formatted in the row, not by the server — see `EarningsPoint`. */
  settledAt: string;
  /** SIGNED. A payout debit and a reversal are both negative. */
  amountPaise: number;
  kind: TransactionKind;
  /** e.g. "Completed" / "Bonus Credited". */
  statusLabel: string;
};

/**
 * §9.2.4's per-trip breakdown: gross → commission (band + %) → net.
 *
 * §3.3's "driver transparency (Rapido-style trust)" clause asks for exactly
 * these five numbers on every completed trip — "No surprises = supply
 * retention". A net figure with no band beside it is not a breakdown.
 */
export type EarningsTrip = {
  bookingId: string;
  jobCode: string;
  settledAt: string;
  grossPaise: number;
  commissionBand: Band | null;
  commissionPct: number | null;
  commissionPaise: number;
  /** What actually reached this driver — never the fleet's half. */
  netPaise: number;
  fleetSharePaise: number;
};

/** §9.2.4's balance block. */
export type EarningsWallet = {
  balancePaise: number;
  /** Already net of money locked in open payouts. */
  availablePaise: number;
  minPayoutPaise: number;
  maxPayoutPaise: number;
  payoutAccountLinked: boolean;
};

export type EarningsData = {
  summary: EarningsSummary;
  wallet: EarningsWallet;
  trend: EarningsPoint[];
  transactions: Transaction[];
};

/** One week of the §12.2 digest's underlying numbers. */
export type EarningsWeek = {
  weekStart: string;
  jobs: number;
  grossPaise: number;
  commissionPaise: number;
  netPaise: number;
};

export type PayoutApprovalState =
  | 'auto_approved'
  | 'pending_approval'
  | 'approved'
  | 'rejected';

export type PayoutStatus = 'requested' | 'processing' | 'paid' | 'failed';

export type Payout = {
  id: string;
  amountPaise: number;
  status: PayoutStatus;
  /**
   * LOAD-BEARING IN THE UI. Without it a driver above §14.4's threshold watches
   * `requested` sit there indefinitely with no explanation and files a support
   * ticket — the row has to be able to say "awaiting Finance approval".
   */
  approvalState: PayoutApprovalState;
  rejectionReason: string | null;
  requestedAt: string;
  paidAt: string | null;
  failureReason: string | null;
};

export type PayoutAccount = {
  status: 'unlinked' | 'pending' | 'active' | 'rejected' | 'suspended';
  beneficiaryName: string | null;
  /** The ONLY account-number field that ever crosses the wire. */
  accountNumberLast4: string | null;
  ifsc: string | null;
  bankName: string | null;
  failureReason: string | null;
  linkedAt: string | null;
};
