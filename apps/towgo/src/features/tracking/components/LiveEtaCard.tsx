import React from 'react';
import { View } from 'react-native';
import type { BookingTracking } from '@towing/api-contracts';
import { MiText } from '@/design';
import { useEtaMinutes } from '@/features/tracking/hooks/useEtaMinutes';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';
import { trackingDesignFor } from '@/screens/booking/tracking/trackingDisplay';
import { formatEta } from '@/utils/format';

/**
 * Figma 18 · Driver En Route heading (`226:319`): "Arriving in 5 mins" (Title 23)
 * over "Your driver is on the way to your location" (Body M 15, secondary).
 * Frame: left padding 3.7, gap 2.9.
 *
 * The title's static parts are "Arriving in " and " mins"; only the count is
 * data. It is the server's `etaSeconds`, ticked down locally between updates so
 * it never looks frozen and re-seeded whenever the server sends a new value. A
 * later `null` keeps the last known count counting down. The design draws only
 * the plural and no "arriving now" state, so the count floors at 1 and the word
 * stays "mins". Before any ETA is known (the first read, or a driver with no fix
 * yet) the count's line keeps its slot with a placeholder bar; no other title
 * is ever shown.
 *
 * 19 Driver Arriving, 23 Driver Arrived and 25 Trip in Progress draw their own
 * static headings (in the Tracking screen). The only other caller is the legacy
 * sheet, kept for the statuses no rebuilt screen draws (a re-dispatch,
 * disputed): it gets the pre-redesign "Your trip".
 */

/** Figma 18's subtitle, verbatim. */
const EN_ROUTE_SUBTITLE = 'Your driver is on the way to your location';

/** Figma title box width ("Arriving in 5 mins", 187 × 28). */
const TITLE_BOX_WIDTH = 187;

/** The pre-redesign heading, for the statuses no rebuilt screen draws. */
const LEGACY_TITLE = 'Your trip';

export function LiveEtaCard({ tracking }: { tracking: BookingTracking | undefined }) {
  const minutes = useEtaMinutes(tracking);

  if (trackingDesignFor(tracking?.status) === 'enRoute18') {
    const title = minutes === null ? null : `Arriving in ${formatEta(minutes)}`;
    return (
      <View
        style={{ paddingLeft: 3.7, gap: 2.9, overflow: 'hidden' }}
        accessible
        accessibilityLabel={title ? `${title}. ${EN_ROUTE_SUBTITLE}` : EN_ROUTE_SUBTITLE}
      >
        {title ? (
          <MiText variant="title23" numberOfLines={1} ellipsizeMode="clip">
            {title}
          </MiText>
        ) : (
          <SlotPlaceholder variant="title23" width={TITLE_BOX_WIDTH} />
        )}
        <MiText variant="bodyM15" color="secondary" numberOfLines={1} ellipsizeMode="clip">
          {EN_ROUTE_SUBTITLE}
        </MiText>
      </View>
    );
  }

  // --- Legacy statuses (re-dispatch, disputed): no rebuilt screen draws them --

  return (
    <View
      style={{ paddingLeft: 3.7, gap: 2.9, overflow: 'hidden' }}
      accessible
      accessibilityLabel={LEGACY_TITLE}
    >
      <MiText variant="title23" numberOfLines={1} ellipsizeMode="clip">
        {LEGACY_TITLE}
      </MiText>
    </View>
  );
}
