import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { MiTimelineRow } from '@/design';
import { clockLabel, type BookingTrackingDisplay } from './trackingDisplay';

/** Figma 19 copy, verbatim. */
const ON_THE_WAY = 'Driver on the way';
const ARRIVING = 'Arriving at your location';
/** Static prefix of row 2's time: capital E, a full stop, one space. */
const ESTIMATE_PREFIX = 'Est. ';

const MINUTE_MS = 60_000;

/** A payload's `at` as epoch ms; now, if it has none or it does not parse. */
function sinceMs(at: string | undefined): number {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isNaN(ms) ? Date.now() : ms;
}

/**
 * Figma 19 · Arrival timeline `254:1482`: two Timeline Row instances, gap 0,
 * no padding, clips.
 *
 * - Row 1 `254:1483`, State=Current, 40 tall: "Driver on the way" and the time
 *   the driver set off ("10:12 AM"). The contract has no such instant yet; the
 *   mock supplies the app-local `enRouteAt`, and the live API leaves the time
 *   slot (59 wide) with its placeholder bar (data gap).
 * - Row 2 `254:1495`, State=Upcoming, 28 tall, no connector: "Arriving at your
 *   location" and "Est. " + the arrival clock ("Est. 10:17 AM"), from the
 *   server's ETA, rounded to the nearest minute. A later `null` ETA keeps the
 *   last known estimate; before any, the 86-wide slot holds its placeholder.
 *
 * Subtitles are off on both rows, as drawn.
 */
export function ArrivalTimeline({ tracking }: { tracking: BookingTrackingDisplay | undefined }) {
  const enRouteMs = tracking?.enRouteAt ? Date.parse(tracking.enRouteAt) : NaN;
  const enRouteLabel = Number.isNaN(enRouteMs) ? null : clockLabel(enRouteMs);

  /**
   * The arrival instant is fixed when an ETA is received, counted from the
   * instant it was true:
   * - a polled payload (a new `at`) counts from its own `at`, when the server
   *   computed it, so a payload reopened from the cache names the arrival it
   *   named then rather than one pushed back by the payload's age;
   * - a socket `eta:update` patches the ETA WITHOUT touching `at`, which may be
   *   up to a poll old, so that one counts from now.
   */
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

  const estimate =
    arrivalMs === null
      ? null
      : `${ESTIMATE_PREFIX}${clockLabel(Math.round(arrivalMs / MINUTE_MS) * MINUTE_MS)}`;

  return (
    <View style={{ overflow: 'hidden' }}>
      <MiTimelineRow
        state="current"
        title={ON_THE_WAY}
        time={enRouteLabel}
        timeSlotWidth={59}
        height={40}
      />
      <MiTimelineRow
        state="upcoming"
        title={ARRIVING}
        time={estimate}
        timeSlotWidth={86}
        last
        height={28}
      />
    </View>
  );
}
