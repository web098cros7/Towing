import React from 'react';
import { View } from 'react-native';
import { MiTimelineRow } from '@/design';
import { addressOrNull, areaOf, clockLabel, type BookingTrackingDisplay } from './trackingDisplay';
import { useEstimatedArrival } from './useEstimatedArrival';

/** Figma 25 copy, verbatim. */
const PICKED_UP = 'Picked up';
const IN_TRANSIT = 'In transit';
/** Static prefix of row 2's subtitle, with its one trailing space. */
const ON_THE_WAY_TO = 'On the way to ';
const DROP_AT = 'Drop at';
/** A roadside job's rows (Figma draws 25 for a tow only). */
const DRIVER_ARRIVED = 'Driver arrived';
const SERVICE_STARTED = 'Service started';

/** An ISO instant as the design's clock ("10:20 AM"); `null` when absent or unreadable. */
function clockOf(iso: string | null | undefined): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? null : clockLabel(ms);
}

/**
 * Figma 25 · Trip timeline `236:409`: three Timeline Row instances, gap 0,
 * padding 3.6 / 4.8 / 8 / 10.6 (so the rows are 335.6 wide), clips. Every
 * subtitle is on, and a slot with no data keeps its drawn width with a
 * placeholder bar; nothing is dropped.
 *
 * - Row 1 `236:410`, State=Done, 67 tall: "Picked up", the pickup address (132)
 *   and the time the tow started, the server's `startedAt` (61).
 * - Row 2 `236:421`, State=Current, 67 tall: "In transit", "On the way to " +
 *   the drop's area (the whole line 167), and the time the loaded truck left the
 *   pickup (61): the server's `inTransitAt`, a placeholder while the vehicle is
 *   still being loaded.
 * - Row 3 `236:433`, State=Upcoming, 48 tall, no connector: "Drop at", the drop
 *   address (144) and "Est. " + the arrival clock (89), 19's rule
 *   (`useEstimatedArrival`). Only while the server's ETA is the DROP leg's: the
 *   status is `in_progress` and the booking has a drop.
 *
 * The addresses come from the booking (`GET /bookings/:id`); the tracking
 * payload carries none.
 *
 * A roadside job (`roadsideService` given) has nothing to carry: two rows,
 * "Driver arrived" at the pickup address with `arrivedAt`, then "Service
 * started" with the service's name and `startedAt`. No drop row.
 */
export function TripTimeline({
  tracking,
  pickupAddress,
  dropAddress,
  roadsideService,
}: {
  tracking: BookingTrackingDisplay | undefined;
  /** The booking's `originLabel`. */
  pickupAddress: string | null | undefined;
  /** The booking's `destinationLabel`. */
  dropAddress: string | null | undefined;
  /**
   * Set for a roadside job: the service's name ("Battery Jump Start"), or null
   * when the app has no name for it. Undefined for a tow.
   */
  roadsideService?: string | null;
}) {
  const pickup = addressOrNull(pickupAddress);
  const drop = addressOrNull(dropAddress);
  const area = areaOf(drop);
  const estimate = useEstimatedArrival(tracking);
  const dropLeg = tracking?.status === 'in_progress' && tracking.drop !== null;

  if (roadsideService !== undefined) {
    return (
      <View
        style={{
          paddingTop: 3.6,
          paddingRight: 4.8,
          paddingBottom: 8,
          paddingLeft: 10.6,
          overflow: 'hidden',
        }}
      >
        <MiTimelineRow
          state="done"
          title={DRIVER_ARRIVED}
          subtitle={pickup}
          subtitleSlotWidth={132}
          time={clockOf(tracking?.arrivedAt)}
          timeSlotWidth={61}
          height={67}
        />
        <MiTimelineRow
          state="current"
          title={SERVICE_STARTED}
          subtitle={roadsideService}
          subtitleSlotWidth={132}
          time={clockOf(tracking?.startedAt)}
          timeSlotWidth={61}
          last
          height={48}
        />
      </View>
    );
  }

  return (
    <View
      style={{
        paddingTop: 3.6,
        paddingRight: 4.8,
        paddingBottom: 8,
        paddingLeft: 10.6,
        overflow: 'hidden',
      }}
    >
      <MiTimelineRow
        state="done"
        title={PICKED_UP}
        subtitle={pickup}
        subtitleSlotWidth={132}
        time={clockOf(tracking?.startedAt)}
        timeSlotWidth={61}
        height={67}
      />
      <MiTimelineRow
        state="current"
        title={IN_TRANSIT}
        subtitle={area ? `${ON_THE_WAY_TO}${area}` : null}
        subtitleSlotWidth={167}
        time={clockOf(tracking?.inTransitAt)}
        timeSlotWidth={61}
        height={67}
      />
      <MiTimelineRow
        state="upcoming"
        title={DROP_AT}
        subtitle={drop}
        subtitleSlotWidth={144}
        time={dropLeg ? estimate : null}
        timeSlotWidth={89}
        last
        height={48}
      />
    </View>
  );
}
