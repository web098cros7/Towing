import { env } from '@/lib/env';
import type { EarningsDataSource } from './earningsDataSource';
import type {
  EarningsData,
  EarningsPeriod,
  EarningsTrip,
  EarningsWeek,
  Payout,
  PayoutAccount,
} from '../types';
import {
  earningsByPeriod,
  payoutAccountMock,
  payoutsMock,
  tripsMock,
  weeklyMock,
} from '../mocks/earnings.mock';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mock earnings with realistic latency. `EXPO_PUBLIC_MOCK_EARNINGS_STATE`
 * forces `error` or `empty` so §10.9's states can be exercised without a
 * backend — which matters more here than almost anywhere, because no build of
 * this app has ever run on a device and the mock is the only way anyone has
 * seen these screens at all.
 *
 * PAYOUT STATE IS MODULE-LEVEL AND MUTABLE, deliberately: requesting a payout
 * in mock mode has to move the balance and add a row, or the flow cannot be
 * demonstrated end to end. It resets on reload, which is the honest scope of a
 * mock.
 */
let payouts: Payout[] = [...payoutsMock];
let account: PayoutAccount = { ...payoutAccountMock };

export const earningsMockSource: EarningsDataSource = {
  async getEarnings(period: EarningsPeriod): Promise<EarningsData> {
    await delay(600);
    if (env.mockEarningsState === 'error') throw new Error('Failed to load earnings');

    const data = earningsByPeriod[period];
    if (env.mockEarningsState === 'empty') {
      return {
        ...data,
        summary: { ...data.summary, totalPaise: 0, jobsCompleted: 0, avgPerJobPaise: 0, bonusPaise: 0 },
        wallet: { ...data.wallet, balancePaise: 0, availablePaise: 0 },
        trend: [],
        transactions: [],
      };
    }

    // The wallet reflects any payout taken this session, so the balance a
    // driver sees after requesting one is not stale.
    const locked = payouts
      .filter((payout) => payout.status === 'requested' || payout.status === 'processing')
      .reduce((sum, payout) => sum + payout.amountPaise, 0);

    return {
      ...data,
      wallet: { ...data.wallet, availablePaise: data.wallet.balancePaise - locked },
    };
  },

  async getTrips(cursor?: string): Promise<{ items: EarningsTrip[]; nextCursor: string | null }> {
    await delay(400);
    if (env.mockEarningsState === 'error') throw new Error('Failed to load trips');
    if (env.mockEarningsState === 'empty' || cursor) return { items: [], nextCursor: null };
    return { items: tripsMock, nextCursor: null };
  },

  async getWeekly(): Promise<EarningsWeek[]> {
    await delay(400);
    if (env.mockEarningsState === 'error') throw new Error('Failed to load weekly earnings');
    return env.mockEarningsState === 'empty' ? [] : weeklyMock;
  },

  async listPayouts(): Promise<Payout[]> {
    await delay(300);
    if (env.mockEarningsState === 'error') throw new Error('Failed to load payouts');
    return env.mockEarningsState === 'empty' ? [] : payouts;
  },

  async requestPayout(amountPaise: number): Promise<Payout> {
    await delay(700);

    // §14.4's threshold, mirrored so the "awaiting Finance approval" branch is
    // reachable without a server. ₹1,00,000 is the launch default.
    const created: Payout = {
      id: `mock-payout-${payouts.length + 1}`,
      amountPaise,
      status: 'requested',
      approvalState: amountPaise > 10_000_000 ? 'pending_approval' : 'auto_approved',
      rejectionReason: null,
      requestedAt: new Date().toISOString(),
      paidAt: null,
      failureReason: null,
    };

    payouts = [created, ...payouts];
    return created;
  },

  async getPayoutAccount(): Promise<PayoutAccount> {
    await delay(300);
    return account;
  },

  async linkPayoutAccount(input: {
    beneficiaryName: string;
    accountNumber: string;
    ifsc: string;
  }): Promise<PayoutAccount> {
    await delay(800);
    if (env.mockEarningsState === 'error') throw new Error('Could not reach the payout provider');

    account = {
      status: 'active',
      beneficiaryName: input.beneficiaryName,
      // Only the last four, exactly as the server does — a mock that kept the
      // whole number would teach the wrong shape.
      accountNumberLast4: input.accountNumber.slice(-4),
      ifsc: input.ifsc,
      bankName: 'Mock Bank',
      failureReason: null,
      linkedAt: new Date().toISOString(),
    };

    return account;
  },
};
