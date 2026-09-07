import type {
  EarningsData,
  EarningsPeriod,
  EarningsTrip,
  EarningsWeek,
  Payout,
  PayoutAccount,
} from '../types';

/**
 * §9.2.4 fixtures.
 *
 * ⚠ EVERY AMOUNT IS INTEGER PAISE. These were rupee numbers until Phase 19,
 * which was the second half of the 100× hazard: the live path divided by 100 at
 * every call site and this one did not, so the two could not be swapped without
 * every screen being wrong. Now the mock and the API speak the same units and
 * `earningsDataSource` can switch on `env.useMocks` like every other feature.
 *
 * The numbers are internally consistent on purpose — gross − commission = net
 * on every trip, and the trip list sums to the summary — because a fixture that
 * does not reconcile teaches a reviewer to ignore reconciliation.
 */

const weekTransactions: EarningsData['transactions'] = [
  {
    id: 't1',
    title: 'Maruti Swift',
    settledAt: '2026-05-18T05:00:00.000Z',
    amountPaise: 85_000,
    kind: 'job',
    statusLabel: 'Completed',
  },
  {
    id: 't2',
    title: 'Hyundai i20',
    settledAt: '2026-05-17T03:45:00.000Z',
    amountPaise: 120_000,
    kind: 'job',
    statusLabel: 'Completed',
  },
  {
    id: 't3',
    title: 'Honda City',
    settledAt: '2026-05-16T05:00:00.000Z',
    amountPaise: 75_000,
    kind: 'job',
    statusLabel: 'Completed',
  },
  {
    id: 't4',
    title: 'Weekly Bonus',
    settledAt: '2026-05-15T12:00:00.000Z',
    amountPaise: 48_000,
    kind: 'bonus',
    statusLabel: 'Bonus Credited',
  },
  {
    // NEGATIVE, deliberately: a payout debit is the first signed row this
    // screen ever renders, and it is what would have exposed `₹-,500`.
    id: 't5',
    title: 'Payout to HDFC ••••4021',
    settledAt: '2026-05-14T09:30:00.000Z',
    amountPaise: -200_000,
    kind: 'payout',
    statusLabel: 'Paid',
  },
  {
    // §3.5's compensation — an `adjustment`, never an earning leg.
    id: 't6',
    title: 'Cancellation compensation',
    settledAt: '2026-05-13T07:15:00.000Z',
    amountPaise: 49_950,
    kind: 'adjustment',
    statusLabel: 'Credited',
  },
];

const wallet: EarningsData['wallet'] = {
  balancePaise: 1_284_000,
  availablePaise: 1_284_000,
  minPayoutPaise: 50_000,
  maxPayoutPaise: 10_000_000,
  payoutAccountLinked: true,
};

/** §3.3's Band A is 10 %, so net = gross − 10 %. Every row here obeys that. */
export const tripsMock: EarningsTrip[] = [
  {
    bookingId: '11111111-1111-4111-8111-111111111111',
    jobCode: 'TW-11111111',
    settledAt: '2026-05-18T05:00:00.000Z',
    grossPaise: 94_450,
    commissionBand: 'A',
    commissionPct: 10,
    commissionPaise: 9_445,
    netPaise: 85_005,
    fleetSharePaise: 0,
  },
  {
    bookingId: '22222222-2222-4222-8222-222222222222',
    jobCode: 'TW-22222222',
    settledAt: '2026-05-17T03:45:00.000Z',
    grossPaise: 133_334,
    commissionBand: 'A',
    commissionPct: 10,
    commissionPaise: 13_333,
    netPaise: 120_001,
    fleetSharePaise: 0,
  },
  {
    // Band B (8 %) so the screen is exercised with more than one band — §3.3's
    // explainer promises "Local 10% · Highway 8% · Long-distance 5%".
    bookingId: '33333333-3333-4333-8333-333333333333',
    jobCode: 'TW-33333333',
    settledAt: '2026-05-16T05:00:00.000Z',
    grossPaise: 81_522,
    commissionBand: 'B',
    commissionPct: 8,
    commissionPaise: 6_522,
    netPaise: 75_000,
    fleetSharePaise: 0,
  },
];

export const weeklyMock: EarningsWeek[] = [
  { weekStart: '2026-05-11', jobs: 12, grossPaise: 1_120_000, commissionPaise: 112_000, netPaise: 1_008_000 },
  { weekStart: '2026-05-04', jobs: 9, grossPaise: 890_000, commissionPaise: 89_000, netPaise: 801_000 },
  { weekStart: '2026-04-27', jobs: 14, grossPaise: 1_310_000, commissionPaise: 131_000, netPaise: 1_179_000 },
];

export const payoutsMock: Payout[] = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    amountPaise: 200_000,
    status: 'paid',
    approvalState: 'auto_approved',
    rejectionReason: null,
    requestedAt: '2026-05-14T09:00:00.000Z',
    paidAt: '2026-05-14T09:30:00.000Z',
    failureReason: null,
  },
  {
    // §14.4's queue, so the "awaiting Finance approval" state is reachable in
    // mock mode rather than only against a live server above the threshold.
    id: '55555555-5555-4555-8555-555555555555',
    amountPaise: 1_500_000,
    status: 'requested',
    approvalState: 'pending_approval',
    rejectionReason: null,
    requestedAt: '2026-05-19T04:00:00.000Z',
    paidAt: null,
    failureReason: null,
  },
];

export const payoutAccountMock: PayoutAccount = {
  status: 'active',
  beneficiaryName: 'R. Kumar',
  accountNumberLast4: '4021',
  ifsc: 'HDFC0000123',
  bankName: 'HDFC Bank',
  failureReason: null,
  linkedAt: '2026-04-02T06:00:00.000Z',
};

export const earningsByPeriod: Record<EarningsPeriod, EarningsData> = {
  week: {
    summary: {
      totalPaise: 1_284_000,
      deltaPercent: 12.5,
      jobsCompleted: 16,
      avgPerJobPaise: 80_250,
      bonusPaise: 48_000,
    },
    wallet,
    trend: [
      { day: '2026-05-12', valuePaise: 125_000 },
      { day: '2026-05-13', valuePaise: 168_000 },
      { day: '2026-05-14', valuePaise: 102_000 },
      { day: '2026-05-15', valuePaise: 185_000 },
      { day: '2026-05-16', valuePaise: 268_000 },
      { day: '2026-05-17', valuePaise: 248_000 },
      { day: '2026-05-18', valuePaise: 268_000 },
    ],
    transactions: weekTransactions,
  },
  month: {
    summary: {
      totalPaise: 2_734_000,
      deltaPercent: 8.2,
      jobsCompleted: 34,
      avgPerJobPaise: 80_400,
      bonusPaise: 180_000,
    },
    wallet,
    trend: [
      { day: '2026-05-04', valuePaise: 582_000 },
      { day: '2026-05-11', valuePaise: 641_000 },
      { day: '2026-05-18', valuePaise: 863_000 },
      { day: '2026-05-25', valuePaise: 648_000 },
    ],
    transactions: weekTransactions,
  },
  lastMonth: {
    summary: {
      totalPaise: 2_528_000,
      deltaPercent: -3.4,
      jobsCompleted: 31,
      avgPerJobPaise: 81_500,
      bonusPaise: 150_000,
    },
    wallet,
    trend: [
      { day: '2026-04-06', valuePaise: 612_000 },
      { day: '2026-04-13', valuePaise: 704_000 },
      { day: '2026-04-20', valuePaise: 621_000 },
      { day: '2026-04-27', valuePaise: 591_000 },
    ],
    transactions: weekTransactions,
  },
  custom: {
    summary: {
      totalPaise: 648_000,
      deltaPercent: 12.5,
      jobsCompleted: 8,
      avgPerJobPaise: 81_000,
      bonusPaise: 48_000,
    },
    wallet,
    trend: [
      { day: '2026-05-12', valuePaise: 125_000 },
      { day: '2026-05-13', valuePaise: 168_000 },
      { day: '2026-05-14', valuePaise: 102_000 },
      { day: '2026-05-15', valuePaise: 185_000 },
      { day: '2026-05-16', valuePaise: 268_000 },
      { day: '2026-05-17', valuePaise: 248_000 },
      { day: '2026-05-18', valuePaise: 268_000 },
    ],
    transactions: weekTransactions,
  },
};
