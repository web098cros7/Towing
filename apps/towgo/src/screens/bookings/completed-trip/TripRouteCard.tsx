import React from 'react';
import { View } from 'react-native';
import {
  MiColorIcon,
  MiText,
  MiTimelineRow,
  mitowColors,
  mitowRadii,
  mitowShadows,
} from '@/design';
import type { BookingDetail } from '@/features/bookings/types';
import type { BookingTrackingDisplay } from '@/screens/booking/tracking/trackingDisplay';
import {
  completedClock,
  startedClock,
  stopTitle,
  tripDateLabel,
  tripDurationLabel,
  tripStamps,
  tripWindowLabel,
  type TripStamps,
} from './completedTripDisplay';

/**
 * 35's Trip route card `245:907`: a 351-wide white card, 1.2 border/subtle, radius 16,
 * MiTow/Elevation/Card, padding 14, gap 12. Three blocks:
 *
 * 1. `Stops` `245:908` — two Timeline Rows at 58 (Pickup, with the connector) and 42 (Drop, no
 *    connector). The states are the set's `pickup` and `drop` variants, drawn as a green dot and
 *    a red dot; the titles are the booking's own address labels, so this card and 20's Locations
 *    card print the same words; the subtitles are the same labels' full text, and the times are
 *    the two instants the tow ran between.
 * 2. A 1-tall border/subtle divider, full width.
 * 3. `Trip meta` `245:932` — the calendar icon at 26 with the date over the window, a 1 × 36
 *    vertical divider, then the clock icon at 26 with "Total Time" over the duration.
 *
 * ⚠ THE SUBTITLE SLOT. Figma draws the pickup title "MG Road, Bengaluru" with the subtitle
 * "MG Road, Bengaluru, Karnataka" beneath it — two DIFFERENT strings, the second one the address
 * with its area and state. The booking carries one label per stop (`originLabel`), and the
 * contract has no second, longer form, so the drawn subtitle cannot be filled from real data.
 * Rather than repeat the title (inventing a subtitle) or drop the drawn line (losing a designed
 * element), the subtitle slot keeps its drawn width with a placeholder bar. Reported.
 *
 * The drawn subtitle box is 335 wide in the component but 323 in this instance, so the instance
 * width is what the bar uses.
 */

/** Figma instance values. */
const CARD_PADDING = 14;
const CARD_BORDER = 1.2;
const PICKUP_HEIGHT = 58;
const DROP_HEIGHT = 42;
const STOP_SUBTITLE_SLOT = 323;
/**
 * The two stop TITLES' drawn boxes in this instance: both stop names are 179 wide (the title
 * column is 323 minus the rail's 39 and the time's 105). Used only while a title is missing, so
 * a booking whose address the server did not send keeps the row's height instead of collapsing
 * its top line.
 */
const STOP_TITLE_SLOT = 179;
const STOP_TIME_SLOT = 55;
const META_ICON = 26;

export function TripRouteCard({
  booking,
  tracking,
}: {
  booking: BookingDetail;
  tracking: BookingTrackingDisplay | undefined;
}) {
  const stamps = tripStamps(tracking);

  return (
    <View
      style={{
        backgroundColor: mitowColors.surfacePage,
        borderWidth: CARD_BORDER,
        borderColor: mitowColors.borderSubtle,
        borderRadius: mitowRadii.card,
        // The drawn padding is measured from the OUTER edge and RN's border takes layout space,
        // so the stroke comes out of it (20's Locations card does the same).
        padding: CARD_PADDING - CARD_BORDER,
        gap: 12,
        ...mitowShadows.card,
      }}
    >
      <View>
        <MiTimelineRow
          state="pickup"
          title={stopTitle(booking.originLabel)}
          titleSlotWidth={STOP_TITLE_SLOT}
          subtitleSlotWidth={STOP_SUBTITLE_SLOT}
          time={startedClock(stamps)}
          timeSlotWidth={STOP_TIME_SLOT}
          height={PICKUP_HEIGHT}
        />
        <MiTimelineRow
          state="drop"
          title={stopTitle(booking.destinationLabel)}
          titleSlotWidth={STOP_TITLE_SLOT}
          subtitleSlotWidth={STOP_SUBTITLE_SLOT}
          time={completedClock(stamps)}
          timeSlotWidth={STOP_TIME_SLOT}
          height={DROP_HEIGHT}
          showConnector={false}
        />
      </View>

      <Divider />

      <TripMeta stamps={stamps} />
    </View>
  );
}

/** Divider `245:931`: 1 tall, border/subtle, full card width. */
function Divider() {
  return <View style={{ height: 1, backgroundColor: mitowColors.borderSubtle }} />;
}

/**
 * `Trip meta` `245:932`: two 40-tall groups either side of a 1 × 36 divider, gap 12.
 *
 * The Date half (a surface/muted bar when the instant is unknown; the absence of one is not a
 * date), then Duration. Both halves draw their icon and their two lines in every case, so the
 * card's height never depends on what the server knows.
 */
function TripMeta({ stamps }: { stamps: TripStamps }) {
  const date = tripDateLabel(stamps);
  const window = tripWindowLabel(stamps);
  const duration = tripDurationLabel(stamps);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {/* Date `245:941`: fills whatever is left, so the Duration group keeps its natural width. */}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <MiColorIcon name="calendar" size={META_ICON} />
        <View style={{ flex: 1, gap: 1 }}>
          {date ? (
            <MiText variant="bodyM15" numberOfLines={1}>
              {date}
            </MiText>
          ) : (
            <SlotLine variant="bodyM15" width={DATE_SLOT_WIDTH} />
          )}
          {window ? (
            <MiText variant="bodyS14" color="secondary" numberOfLines={1}>
              {window}
            </MiText>
          ) : (
            <SlotLine variant="bodyS14" width={WINDOW_SLOT_WIDTH} />
          )}
        </View>
      </View>

      <View style={{ width: 1, height: 36, backgroundColor: mitowColors.borderSubtle }} />

      {/* Duration `245:948`: hugs, so the divider sits where the design puts it. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <MiColorIcon name="clock" size={META_ICON} />
        <View style={{ gap: 1 }}>
          {/* "Total Time" is a LABEL, not data: always present, Body S 14 secondary. */}
          <MiText variant="bodyS14" color="secondary">
            Total Time
          </MiText>
          {duration ? (
            <MiText variant="bodyM15">{duration}</MiText>
          ) : (
            <SlotLine variant="bodyM15" width={DURATION_SLOT_WIDTH} />
          )}
        </View>
      </View>
    </View>
  );
}

/** Figma text box widths of the three meta values, for their placeholder bars. */
const DATE_SLOT_WIDTH = 87;
const WINDOW_SLOT_WIDTH = 134;
const DURATION_SLOT_WIDTH = 55;

/**
 * Holds a meta slot open at its drawn width while the value is unknown: a line-height space in
 * the real style, with a surface/muted bar over it. `SlotPlaceholder`'s look, kept local
 * because that module lives under `screens/booking/tracking` and belongs to 18.
 */
function SlotLine({ variant, width }: { variant: 'bodyM15' | 'bodyS14'; width: number }) {
  return (
    <View style={{ width, maxWidth: '100%' }}>
      <MiText variant={variant} numberOfLines={1}>
        {' '}
      </MiText>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '18%',
          bottom: '18%',
          borderRadius: 4,
          backgroundColor: mitowColors.surfaceMuted,
        }}
      />
    </View>
  );
}
