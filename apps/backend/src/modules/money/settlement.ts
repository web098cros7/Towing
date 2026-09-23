import {
  commissionPaise,
  commissionPaiseAtPct,
  rupeeStringToPaise,
  splitPool,
  type Band,
} from '@towing/api-contracts';
import { sharePctOf, type DriverPayTerms } from './driver-pay-terms';

/**
 * §14.3 booking settlement, as pure arithmetic: gross → commission → pool →
 * the ledger legs that get posted.
 *
 * **Why the split happens here and not at payout time.** §3.4 and §9.3.7 both
 * say "split at payout layer" while §14.3 says the fleet split is "two ledger
 * credits in one transaction". `src/db/seed/seed.ts` — which the phase plan
 * names as the executable specification — implements the latter, and 755
 * seeded ledger rows plus the third seed invariant depend on it.
 *
 * The two readings reconcile: the split is computed in the *money* layer
 * (here) rather than in pricing, and a payout draws only the fleet's own
 * already-split wallet balance. **A payout never re-splits anything.** Moving
 * the arithmetic to payout time would mean a fleet's wallet held the driver's
 * money until withdrawal, which is both wrong on the books and unpayable to a
 * driver who leaves the fleet.
 *
 * `commission_debit` is deliberately never produced. The platform has no
 * wallet, so commission has no counterparty leg — it lives as
 * `bookings.commission_amount` and by the pool's absence. See the reserved
 * marker on `walletTxnTypeEnum`.
 */

export interface SettlementInput {
  totalPaise: number;
  band: Band;
  /**
   * The percentage LOCKED on the booking at confirm. When null/absent the
   * band's launch default `BAND_PCT` applies — only old fixtures hit that.
   */
  commissionPct?: number | null;
  /** Null for an independent driver — the whole pool is one `fare_credit`. */
  driverSharePct: number | null;
}

export type SettlementLegType = 'driver_share_credit' | 'fleet_share_credit' | 'fare_credit';

export interface Settlement {
  grossPaise: number;
  commissionPaise: number;
  poolPaise: number;
  /** Zero when the driver is independent. */
  fleetSharePaise: number;
  driverSharePaise: number;
  legs: ReadonlyArray<{ owner: 'driver' | 'fleet'; type: SettlementLegType; amountPaise: number }>;
}

export function computeSettlement(input: SettlementInput): Settlement {
  const { totalPaise, band, driverSharePct, commissionPct } = input;

  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    throw new Error(`Settlement needs a non-negative integer paise total, got ${totalPaise}`);
  }

  // The LOCKED percentage wins when present; the band's launch default is the
  // fallback for rows predating the lock (old fixtures only).
  const commission =
    commissionPct !== null && commissionPct !== undefined
      ? commissionPaiseAtPct(totalPaise, commissionPct)
      : commissionPaise(totalPaise, band);
  // §7: "driver net = total − commission (so the two always sum exactly)".
  const pool = totalPaise - commission;

  if (driverSharePct === null) {
    return {
      grossPaise: totalPaise,
      commissionPaise: commission,
      poolPaise: pool,
      fleetSharePaise: 0,
      driverSharePaise: pool,
      legs:
        pool > 0
          ? [{ owner: 'driver', type: 'fare_credit', amountPaise: pool }]
          : [],
    };
  }

  if (driverSharePct < 0 || driverSharePct > 100) {
    throw new Error(`driverSharePct must be 0..100, got ${driverSharePct}`);
  }

  const { driverPaise, fleetPaise } = splitPool(pool, driverSharePct);

  // A zero leg is dropped, not written: `ck_wallet_transactions_amount_nonzero`
  // rejects it, and a 100%-driver-share fleet legitimately produces one.
  const legs: Array<Settlement['legs'][number]> = [];
  if (driverPaise > 0) {
    legs.push({ owner: 'driver', type: 'driver_share_credit', amountPaise: driverPaise });
  }
  if (fleetPaise > 0) {
    legs.push({ owner: 'fleet', type: 'fleet_share_credit', amountPaise: fleetPaise });
  }

  return {
    grossPaise: totalPaise,
    commissionPaise: commission,
    poolPaise: pool,
    fleetSharePaise: fleetPaise,
    driverSharePaise: driverPaise,
    legs,
  };
}

/**
 * What the driver is shown on the offer card and the current-job screen BEFORE
 * payment — and it equals the pool settlement will credit, because it is the
 * same arithmetic on the same inputs.
 *
 * `grossPaise` is the TAXABLE amount (total − tax): GST is nobody's money, so
 * the commission and the pool are computed on the taxable base, exactly as
 * `computeSettlement` does at capture time. Commission uses the percentage
 * LOCKED on the booking when present, falling back to the band's launch
 * default, and zero when neither is available.
 */
export function projectEarnings(input: {
  totalRupees: string;
  taxRupees: string | null;
  band: Band | null;
  commissionPct: string | number | null;
  /** 0042: how this driver is paid, so the card leads with THEIR number. */
  payTerms: DriverPayTerms;
}): {
  grossPaise: number;
  band: Band | null;
  commissionPct: number | null;
  commissionPaise: number;
  netPaise: number;
  payModel: DriverPayTerms['model'];
  driverSharePaise: number;
  fleetSharePaise: number;
} {
  const totalPaise = rupeeStringToPaise(input.totalRupees);
  const taxPaise = input.taxRupees === null ? 0 : rupeeStringToPaise(input.taxRupees);
  const grossPaise = totalPaise - taxPaise;

  const commissionPct =
    input.commissionPct === null || input.commissionPct === undefined
      ? null
      : Number(input.commissionPct);

  const commission =
    commissionPct !== null
      ? commissionPaiseAtPct(grossPaise, commissionPct)
      : input.band !== null
        ? commissionPaise(grossPaise, input.band)
        : 0;

  const netPaise = grossPaise - commission;
  // The same split settlement will make (`computeSettlement` → `splitPool`),
  // on the same share, so the offer and the payout agree to the paisa.
  const sharePct = sharePctOf(input.payTerms);
  const split =
    sharePct === null ? { driverPaise: netPaise, fleetPaise: 0 } : splitPool(netPaise, sharePct);

  return {
    grossPaise,
    band: input.band,
    commissionPct,
    commissionPaise: commission,
    netPaise,
    payModel: input.payTerms.model,
    driverSharePaise: split.driverPaise,
    fleetSharePaise: split.fleetPaise,
  };
}
