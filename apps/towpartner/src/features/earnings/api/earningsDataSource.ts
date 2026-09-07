import { env } from '@/lib/env';
import { earningsMockSource } from './earningsMockSource';
import { earningsRestSource } from './earningsRestSource';
import type {
  EarningsData,
  EarningsPeriod,
  EarningsTrip,
  EarningsWeek,
  Payout,
  PayoutAccount,
} from '../types';

/**
 * §9.2.4's money surface.
 *
 * ⚠ THIS FILE WAS PINNED TO THE MOCK until Phase 19 — `export const
 * earningsDataSource = earningsMockSource`, with no `env.useMocks` branch and
 * no REST half at all. It was the last such pin in the driver app (`offers`,
 * `kyc` and `account/privacy` all switch), which mattered because it meant the
 * earnings screen could not show real money however the app was configured.
 * The web console had the same pin until Track A Phase 7 removed it, for the
 * same reason and with the same note.
 */
export interface EarningsDataSource {
  getEarnings(period: EarningsPeriod): Promise<EarningsData>;
  /** §9.2.4's per-trip gross → commission → net feed. */
  getTrips(cursor?: string): Promise<{ items: EarningsTrip[]; nextCursor: string | null }>;
  getWeekly(): Promise<EarningsWeek[]>;
  listPayouts(): Promise<Payout[]>;
  /**
   * §14.4's request.
   *
   * THE KEY IS A PARAMETER, never minted inside. `apiFetch`'s `idempotent: true`
   * mints one per CALL, so a second tap would be a second key and a second
   * payout; the dialog holds one key for the whole intent and passes it here —
   * the arrangement the web console's `RequestPayoutDialog` has used since
   * Phase 7.
   */
  requestPayout(amountPaise: number, idempotencyKey: string): Promise<Payout>;
  getPayoutAccount(): Promise<PayoutAccount>;
  linkPayoutAccount(input: {
    beneficiaryName: string;
    accountNumber: string;
    ifsc: string;
  }): Promise<PayoutAccount>;
}

export const earningsDataSource: EarningsDataSource = env.useMocks
  ? earningsMockSource
  : earningsRestSource;
