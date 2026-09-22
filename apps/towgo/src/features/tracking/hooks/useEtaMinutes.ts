import { useEffect, useRef, useState } from 'react';
import type { BookingTracking } from '@towing/api-contracts';

/**
 * The minute count behind "Arriving in 5 mins" (18's heading, 20's status card,
 * 21's body) and "Estimated arrival in 15 mins" (25's banner). ONE count for all
 * of them, so no two screens ever name a different number for the same trip.
 *
 * The server's `etaSeconds`, ticked down every second between polls and
 * re-seeded on every new server value; a later `null` keeps the last known
 * count. The design draws only the plural and no "arriving now", so the count
 * floors at 1 and stays "mins". `null` until an ETA is known, which the callers
 * draw as a placeholder bar rather than a number.
 *
 * THE LEG RESET IS THE POINT. `etaSeconds` is the ACTIVE leg's: the pickup
 * while the driver is coming, the drop once the tow starts. Those are two
 * different journeys, and the switch between them does not happen atomically in
 * this app — a `booking:status` frame can flip the status a beat before a
 * payload carrying the new leg's ETA arrives. Without this reset, the moment a
 * tow starts, 25's banner turns on and prints the count for the leg that just
 * ENDED: "Estimated arrival in 3 mins" for a drop half an hour away.
 *
 * So a status change clears the count instead of re-seeding it. Re-seeding from
 * the payload in hand looks safer and is not: that payload is the one whose ETA
 * belongs to the old leg. A placeholder for the few seconds until the next poll
 * is honest; a confident wrong number is not.
 */
export function useEtaMinutes(tracking: BookingTracking | undefined): number | null {
  const etaSeconds = tracking?.etaSeconds ?? null;
  const status = tracking?.status;
  const [remaining, setRemaining] = useState<number | null>(etaSeconds);
  /** The status the current count was computed for. */
  const countedFor = useRef(status);

  useEffect(() => {
    if (countedFor.current !== status) {
      countedFor.current = status;
      setRemaining(null);
      return;
    }
    if (etaSeconds !== null) setRemaining(etaSeconds);
  }, [etaSeconds, tracking?.at, status]);

  const counting = remaining !== null;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => {
      setRemaining((previous) => (previous === null ? null : Math.max(0, previous - 1)));
    }, 1_000);
    return () => clearInterval(timer);
  }, [counting]);

  return remaining === null ? null : Math.max(1, Math.round(remaining / 60));
}
