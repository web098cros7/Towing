import { useEffect, useRef, useState } from 'react';
import type { BookingTracking } from '@towing/api-contracts';
import { clockLabel } from './trackingDisplay';

/** Static prefix of the estimate: capital E, a full stop, one space. */
const ESTIMATE_PREFIX = 'Est. ';

const MINUTE_MS = 60_000;

/** A payload's `at` as epoch ms; now, if it has none or it does not parse. */
function sinceMs(at: string | undefined): number {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isNaN(ms) ? Date.now() : ms;
}

/**
 * The "Est. 10:17 AM" of 19's "Arriving at your location" row and 25's "Drop
 * at" row: "Est. " + the clock time the server's ETA arrives at, rounded to the
 * nearest minute. The ETA is the ACTIVE leg's (the pickup on 19, the drop once
 * the tow has started), so the caller decides when it describes its row.
 *
 * The arrival instant is fixed when an ETA is received, counted from the
 * instant it was true:
 * - a polled payload (a new `at`) counts from its own `at`, when the server
 *   computed it, so a payload reopened from the cache names the arrival it
 *   named then rather than one pushed back by the payload's age;
 * - a socket `eta:update` patches the ETA WITHOUT touching `at`, which may be
 *   up to a poll old, so that one counts from now.
 *
 * A later `null` ETA keeps the last known estimate; before any, `null`, and the
 * row's slot holds its placeholder bar.
 *
 * A CHANGE OF LEG DROPS THE ESTIMATE rather than carrying it over, for the same
 * reason `useEtaMinutes` clears its count: the instant a tow starts, the
 * arrival time in hand is the one computed for the pickup, and 25's "Drop at"
 * would confidently name it. The row holds its placeholder until the server
 * sends an estimate for the journey now under way.
 */
export function useEstimatedArrival(tracking: BookingTracking | undefined): string | null {
  const clock = useArrivalClock(tracking);
  return clock === null ? null : `${ESTIMATE_PREFIX}${clock}`;
}

/**
 * The clock time alone ("10:50 AM"), for copy that words it differently: Home's
 * trip banner "Drop by 10:50 AM" (Figma `556:21010`). Same rules as above.
 */
export function useArrivalClock(tracking: BookingTracking | undefined): string | null {
  const etaSeconds = tracking?.etaSeconds ?? null;
  const at = tracking?.at;
  const status = tracking?.status;
  const [arrivalMs, setArrivalMs] = useState<number | null>(() =>
    etaSeconds === null ? null : sinceMs(at) + etaSeconds * 1000,
  );
  /** The `at` and ETA last read, to tell a poll from a socket patch. */
  const seen = useRef({ at, etaSeconds });
  /** The status the current estimate was computed for. */
  const estimatedFor = useRef(status);
  useEffect(() => {
    const previous = seen.current;
    seen.current = { at, etaSeconds };
    if (estimatedFor.current !== status) {
      estimatedFor.current = status;
      setArrivalMs(null);
      return;
    }
    if (etaSeconds === null) return;
    if (at !== previous.at) setArrivalMs(sinceMs(at) + etaSeconds * 1000);
    else if (etaSeconds !== previous.etaSeconds) setArrivalMs(Date.now() + etaSeconds * 1000);
  }, [at, etaSeconds, status]);

  return arrivalMs === null ? null : clockLabel(Math.round(arrivalMs / MINUTE_MS) * MINUTE_MS);
}
