import { useEffect, useState } from 'react';
import type { DriverJob } from '@towing/api-contracts';

/**
 * §7.4's waiting charge, ticking live — "completion finalizes fare, adds waiting
 * charges" (§9.2.3), shown BEFORE completion so the driver knows what they are
 * accruing rather than discovering it at the end.
 *
 * RECOMPUTED FROM AN ABSOLUTE SERVER INSTANT ON EVERY TICK, never counted up
 * from a local start. This is `useOfferCountdown`'s rule, and it matters more
 * here than it did there: an offer countdown that drifted cost a driver a couple
 * of seconds of a twenty-second window, and this number is BILLED. The figure on
 * the driver's screen has to be the figure `JobExecutionService.complete`
 * charges, and the only way to guarantee that is for both to be `now - arrivedAt`
 * against the same rules.
 *
 * THE RULES COME FROM THE JOB, NOT FROM A CONSTANT. `job.waiting` carries the
 * free window and the per-minute rate as LOCKED on the booking at confirm (§3.4,
 * migration 0015) — so an admin editing the rate card mid-trip changes neither
 * this display nor the final bill, and the app never holds its own copy of a
 * price.
 *
 * ONE SECOND, not 250 ms like the offer ring. The value changes once a minute;
 * a faster tick would spend battery redrawing an identical number for a screen
 * that stays open for the length of a tow.
 */

export interface WaitingCharge {
  /** Whole minutes on site. */
  waitedMinutes: number;
  /** Minutes past the free window. Zero inside it. */
  billableMinutes: number;
  /** What has accrued so far, in paise. */
  accruedPaise: number;
  /** Whether the free window has been used up — the moment the number starts moving. */
  charging: boolean;
  /** Minutes of free time remaining, for the "free for another N minutes" line. */
  freeRemainingMinutes: number;
}

export function useWaitingCharge(job: DriverJob | null | undefined): WaitingCharge | null {
  const arrivedAt = job?.arrivedAt ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!arrivedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [arrivedAt]);

  if (!job || !arrivedAt) return null;

  /**
   * The waiting window CLOSES at `startedAt`, not at `now`, once the trip has
   * begun. After the OTP the driver is towing, not waiting — leaving the meter
   * running would bill the customer for the journey twice, and it is exactly
   * what the finalizer computes (`startedAt - arrivedAt`).
   */
  const until = job.startedAt ? Date.parse(job.startedAt) : now;
  const waitedMinutes = Math.max(0, Math.floor((until - Date.parse(arrivedAt)) / 60_000));
  const billableMinutes = Math.max(0, waitedMinutes - job.waiting.freeMinutes);

  return {
    waitedMinutes,
    billableMinutes,
    accruedPaise: billableMinutes * job.waiting.perMinutePaise,
    charging: billableMinutes > 0,
    freeRemainingMinutes: Math.max(0, job.waiting.freeMinutes - waitedMinutes),
  };
}
