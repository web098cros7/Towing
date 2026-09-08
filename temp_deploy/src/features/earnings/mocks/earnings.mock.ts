import { jobsMock } from '@/features/jobs/mocks/jobs.mock';
import type { EarningsSummary, JobSplit, Payout } from '../types';

const FLEET_SHARE_PCT = 20;
const DAY = 86_400_000;

/**
 * Splits derived from the completed jobs mock so every screen shows the same
 * math: pool = gross − commission, then the §14.3 two-way split. The rounding
 * matches `splitPool` — the fleet leg rounds and the driver leg absorbs the
 * remainder — so the mock and the real backend agree to the paisa.
 */
export const splitsMock: JobSplit[] = jobsMock
  .filter((j) => j.status === 'paid' || j.status === 'completed')
  .map((j) => {
    const fleetSharePaise = Math.round((j.poolPaise * FLEET_SHARE_PCT) / 100);
    return {
      bookingId: j.id,
      jobCode: j.code,
      settledAt: j.createdAt,
      driverId: null,
      driverName: j.driverName ?? '—',
      grossPaise: j.grossPaise,
      // Paid jobs always carry a locked band; the fallback only satisfies the
      // narrower type.
      commissionBand: j.commissionBand ?? 'A',
      commissionPct: j.commissionPct ?? 10,
      commissionPaise: j.commissionPaise,
      poolPaise: j.poolPaise,
      driverSharePaise: j.poolPaise - fleetSharePaise,
      fleetSharePaise,
    };
  });

const trend = Array.from({ length: 14 }, (_, i) => {
  const gross = 180_000 + ((i * 37) % 11) * 42_000;
  return {
    date: new Date(Date.now() - (13 - i) * DAY).toISOString().slice(0, 10),
    grossPaise: gross,
    fleetSharePaise: Math.round((gross * FLEET_SHARE_PCT) / 100),
  };
});

const totals = {
  jobs: splitsMock.length,
  grossPaise: splitsMock.reduce((sum, s) => sum + s.grossPaise, 0),
  commissionPaise: splitsMock.reduce((sum, s) => sum + s.commissionPaise, 0),
  poolPaise: splitsMock.reduce((sum, s) => sum + s.poolPaise, 0),
  driverSharePaise: splitsMock.reduce((sum, s) => sum + s.driverSharePaise, 0),
  fleetSharePaise: splitsMock.reduce((sum, s) => sum + s.fleetSharePaise, 0),
};

const today = new Date().toISOString().slice(0, 10);

export const earningsMock: EarningsSummary = {
  period: { from: `${today.slice(0, 7)}-01`, to: today },
  wallet: {
    balancePaise: 12_431_500,
    availablePaise: 12_431_500,
    // Mirrors the server defaults so the disabled state reads the same in
    // mocks-on and mocks-off.
    minPayoutPaise: 100_000,
    maxPayoutPaise: 50_000_000,
    payoutAccountLinked: true,
  },
  totals,
  trend,
};

export const earningsEmptyMock: EarningsSummary = {
  period: { from: `${today.slice(0, 7)}-01`, to: today },
  wallet: {
    balancePaise: 0,
    availablePaise: 0,
    minPayoutPaise: 100_000,
    maxPayoutPaise: 50_000_000,
    payoutAccountLinked: false,
  },
  totals: {
    jobs: 0,
    grossPaise: 0,
    commissionPaise: 0,
    poolPaise: 0,
    driverSharePaise: 0,
    fleetSharePaise: 0,
  },
  trend: [],
};

export const payoutsMock: Payout[] = [
  {
    /**
     * §14.4's Finance gate, which fleet payouts joined in Phase 19 — they
     * bypassed approval entirely from Track A Phase 7 until then. Without a row
     * in this state the console's "awaiting approval" branch would be
     * unreachable without a live server and an above-threshold request.
     */
    id: 'po-4',
    amountPaise: 18_500_000,
    status: 'requested',
    approvalState: 'pending_approval',
    rejectionReason: null,
    requestedAt: new Date(Date.now() - 0.2 * DAY).toISOString(),
    paidAt: null,
    providerRef: null,
    failureReason: null,
  },
  {
    id: 'po-3',
    amountPaise: 4_230_000,
    // `requested`, not `pending` — the Phase 2 mock predated the contract.
    status: 'failed',
    approvalState: 'auto_approved',
    rejectionReason: null,
    requestedAt: new Date(Date.now() - 1.2 * DAY).toISOString(),
    paidAt: null,
    providerRef: null,
    failureReason: 'Beneficiary bank rejected the account details',
  },
  {
    id: 'po-2',
    amountPaise: 6_100_000,
    status: 'paid',
    approvalState: 'auto_approved',
    rejectionReason: null,
    requestedAt: new Date(Date.now() - 8 * DAY).toISOString(),
    paidAt: new Date(Date.now() - 7.7 * DAY).toISOString(),
    providerRef: 'pout_mock_2',
    failureReason: null,
  },
  {
    id: 'po-1',
    amountPaise: 5_725_000,
    status: 'paid',
    approvalState: 'auto_approved',
    rejectionReason: null,
    requestedAt: new Date(Date.now() - 15 * DAY).toISOString(),
    paidAt: new Date(Date.now() - 14.8 * DAY).toISOString(),
    providerRef: 'pout_mock_1',
    failureReason: null,
  },
];
