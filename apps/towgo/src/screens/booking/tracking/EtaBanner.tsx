import React from 'react';
import { Image, View } from 'react-native';
import type { BookingTracking } from '@towing/api-contracts';
import { MiText, mitowColors, mitowRadii, towTruckArtSource } from '@/design';
import { useEtaMinutes } from '@/screens/bookings/booking-details/useBookingLive';
import { SlotPlaceholder } from './SlotPlaceholder';
import { formatEta } from '@/utils/format';

/** Figma 25 copy, verbatim (straight apostrophe U+0027, full stop). */
const ETA_SUBTITLE = "We'll keep you updated.";
/** The title's static parts are "Estimated arrival in " and " mins"; only the count is data. */
const etaTitle = (minutes: number) => `Estimated arrival in ${formatEta(minutes)}`;
/** The title's Figma text box (the ink is about 194 of it). */
const TITLE_BOX_WIDTH = 235;

/**
 * Figma 25 · ETA banner `319:7973`. A plain frame, not an Info Banner: 78 tall,
 * brand/yellow-soft, radius 14, no border or shadow, and no auto layout, so its
 * children keep their drawn offsets (not centred with flex):
 * - the Tow Truck art `319:7996` (the Vehicle Card's truck, 58.13 × 30.73) at
 *   (9.9, 22.9);
 * - the Text frame `319:7975`, 235 × 39 at (83.9, 19.9), clips: "Estimated
 *   arrival in 15 mins" (Strong 15.5) over "We'll keep you updated." (Body XS
 *   13.5 secondary), one clipped line each. The box keeps the drawn left, top
 *   and width but not the 39: the two lines are 38.5 at the default size, and a
 *   larger font scale grows the box instead of clipping the subtitle.
 *
 * The count is the ETA 18's heading and 20's status card show (`useEtaMinutes`:
 * the server's `etaSeconds`, ticked down every second, re-seeded on each server
 * value, floored at 1, always "mins"). It is drawn only while that ETA is the
 * DROP leg's: the status is `in_progress` and the booking has a drop. Otherwise,
 * and before any ETA, the title line keeps its 235 box with a placeholder bar.
 *
 * The chevron `319:7978` is hidden in Figma: not drawn, and the banner is not
 * pressable. It is one accessible element.
 */
export function EtaBanner({ tracking }: { tracking: BookingTracking | undefined }) {
  const minutes = useEtaMinutes(tracking);
  const dropLeg = tracking?.status === 'in_progress' && tracking.drop !== null;
  const title = dropLeg && minutes !== null ? etaTitle(minutes) : null;

  return (
    <View
      accessible
      accessibilityLabel={title ? `${title}. ${ETA_SUBTITLE}` : ETA_SUBTITLE}
      style={{
        height: 78,
        borderRadius: mitowRadii.cardSm,
        backgroundColor: mitowColors.brandYellowSoft,
      }}
    >
      <Image
        source={towTruckArtSource}
        resizeMode="stretch"
        style={{ position: 'absolute', left: 9.9, top: 22.9, width: 58.13, height: 30.73 }}
      />
      <View
        style={{
          position: 'absolute',
          left: 83.9,
          top: 19.9,
          width: TITLE_BOX_WIDTH,
          overflow: 'hidden',
        }}
      >
        {title ? (
          <MiText variant="strong155" numberOfLines={1} ellipsizeMode="clip">
            {title}
          </MiText>
        ) : (
          <SlotPlaceholder variant="strong155" width={TITLE_BOX_WIDTH} />
        )}
        <MiText variant="bodyXS135" color="secondary" numberOfLines={1} ellipsizeMode="clip">
          {ETA_SUBTITLE}
        </MiText>
      </View>
    </View>
  );
}
