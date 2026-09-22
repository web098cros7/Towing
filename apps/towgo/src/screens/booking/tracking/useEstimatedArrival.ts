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
 */
export function useEstimatedArrival(tracking: BookingTracking | undefined): string | null {
  const etaSeconds = tracking?.etaSeconds ?? null;
  const at = tracking?.at;
  const [arrivalMs, setArrivalMs] = useState<number | null>(() =>
    etaSeconds === null ? null : sinceMs(at) + etaSeconds * 1000,
  );
  /** The `at` and ETA last read, to tell a poll from a socket patch. */
  const seen = useRef({ at, etaSeconds });
  useEffect(() => {
    const previous = seen.current;
    seen.current = { at, etaSeconds };
    if (etaSeconds === null) return;
    if (at !== previous.at) setArrivalMs(sinceMs(at) + etaSeconds * 1000);
    else if (etaSeconds !== previous.etaSeconds) setArrivalMs(Date.now() + etaSeconds * 1000);
  }, [at, etaSeconds]);

  return arrivalMs === null
    ? null
    : `${ESTIMATE_PREFIX}${clockLabel(Math.round(arrivalMs / MINUTE_MS) * MINUTE_MS)}`;
}
