import React from 'react';
import { View } from 'react-native';
import type { BookingTracking, JobStatus } from '@towing/api-contracts';
import { MiColorIcon, MiText, mitowColors } from '@/design';
import { useEtaMinutes } from '@/features/tracking/hooks/useEtaMinutes';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';

/** Figma 22's status label, verbatim, for `assigned` / `en_route`. */
const EN_ROUTE_LABEL = 'Driver on the way';

/**
 * The drawn state: the driver is assigned or on the way. Also the first read,
 * before any status is known, so the strip keeps its drawn form while loading.
 */
function isOnTheWay(status: JobStatus | undefined): boolean {
  return status === undefined || status === 'assigned' || status === 'en_route';
}

/** The measured run width of "Arriving in 5 mins" (screen x 197.3–309). */
const ETA_RUN_WIDTH = 112;
/** The space between "·" and "Arriving" (192.7 → 197.3), for the placeholder row. */
const SEPARATOR_SPACE = 4.6;

/**
 * NOT DRAWN (22 Data gap 6): Figma draws the strip only for "Driver on the way ·
 * Arriving in N mins". Chat is also reachable from 23 Driver Arrived, 24 Collection
 * Code and 20 Booking Details, so every other status gets a short label in the same
 * form. `arrived` reuses 23's drawn title; `in_progress` reuses the app's existing
 * tracking copy. All of it awaits the owner's copy.
 */
const OTHER_LABELS: Record<Exclude<JobStatus, 'assigned' | 'en_route'>, string> = {
  searching: 'Finding your driver',
  arrived: 'Driver has arrived',
  in_progress: 'Towing your vehicle',
  completed: 'Trip completed',
  paid: 'Trip completed',
  cancelled: 'Trip cancelled',
  no_drivers_found: 'No driver found',
  disputed: 'Trip under review',
  refunded: 'Trip refunded',
};

/*
 * The count this strip shows is the shared `useEtaMinutes`. A private copy used
 * to live here — the only one of the three that noticed a leg change at all,
 * though it re-seeded from the outgoing leg's payload rather than clearing.
 */

/**
 * Trip status `292:2641`: 351 wide, height HUG, brand/yellow-soft, radius 12, padding
 * 10 / 14 / 10 / 12, gap 10, items centred. icon/color/tow-truck 30, then the text in
 * Strong 14 (width FILL; a longer text wraps and the strip grows, never truncates).
 * Non-interactive: no chevron, no link.
 *
 * En route: "Driver on the way · Arriving in 5 mins". Before the first ETA the label
 * and separator stay and the count's run keeps its 112 width with a placeholder bar.
 */
export function TripStatusStrip({ tracking }: { tracking: BookingTracking | undefined }) {
  const minutes = useEtaMinutes(tracking);
  const status = tracking?.status;

  let text: string | null;
  if (isOnTheWay(status)) {
    text = minutes === null ? null : `${EN_ROUTE_LABEL} · Arriving in ${minutes} mins`;
  } else if (status === 'in_progress' && minutes !== null) {
    // Not drawn: the drop leg's ETA, in the drawn "<label> · <count>" form.
    text = `${OTHER_LABELS.in_progress} · Reaching drop in ${minutes} mins`;
  } else {
    text = status && status !== 'assigned' && status !== 'en_route' ? OTHER_LABELS[status] : null;
  }

  return (
    <View
      accessible
      accessibilityLabel={text ?? EN_ROUTE_LABEL}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingTop: 10,
        paddingRight: 14,
        paddingBottom: 10,
        paddingLeft: 12,
        borderRadius: 12,
        backgroundColor: mitowColors.brandYellowSoft,
      }}
    >
      <MiColorIcon name="tow-truck" size={30} />
      {text ? (
        <MiText variant="strong14" style={{ flex: 1 }}>
          {text}
        </MiText>
      ) : (
        <View
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: SEPARATOR_SPACE }}
        >
          <MiText variant="strong14" numberOfLines={1}>
            {`${EN_ROUTE_LABEL} ·`}
          </MiText>
          <View style={{ flexShrink: 1 }}>
            <SlotPlaceholder variant="strong14" width={ETA_RUN_WIDTH} />
          </View>
        </View>
      )}
    </View>
  );
}
