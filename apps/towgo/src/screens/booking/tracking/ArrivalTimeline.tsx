import React from 'react';
import { View } from 'react-native';
import { MiTimelineRow } from '@/design';
import { clockLabel, type BookingTrackingDisplay } from './trackingDisplay';
import { useEstimatedArrival } from './useEstimatedArrival';

/** Figma 19 copy, verbatim. */
const ON_THE_WAY = 'Driver on the way';
const ARRIVING = 'Arriving at your location';

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
 *   server's ETA (`useEstimatedArrival`, shared with 25's "Drop at"). A later
 *   `null` ETA keeps the last known estimate; before any, the 86-wide slot holds
 *   its placeholder.
 *
 * Subtitles are off on both rows, as drawn.
 */
export function ArrivalTimeline({ tracking }: { tracking: BookingTrackingDisplay | undefined }) {
  const enRouteMs = tracking?.enRouteAt ? Date.parse(tracking.enRouteAt) : NaN;
  const enRouteLabel = Number.isNaN(enRouteMs) ? null : clockLabel(enRouteMs);
  const estimate = useEstimatedArrival(tracking);

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
