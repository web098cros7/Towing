import React from 'react';
import { View } from 'react-native';
import { usePressablePrimitive, MapPreview, type MapMarker } from '@towing/ui';
import { MiMapChip, MiText, mitowColors } from '@/design';
import type { BookingDetail } from '@/features/bookings/types';

/**
 * 35 · Completed Trip Details' Route map `245:899` — a 351 × 160 frame, radius 16, with the
 * "View on Map" chip `245:902` pinned 12 from its bottom right.
 *
 * Figma draws a PLACEHOLDER here (dashed border/handle, surface/muted, the word "Map"); the
 * owner's standing ruling on every placeholder map in this redesign (19, 25) is to draw the real
 * thing, so this renders a real `MapPreview`. Two consequences worth stating:
 *
 * - The frame is sized by the design, not by the content: `height: 160` and `borderRadius: 16`
 *   on a clipping view. `MapPreview` is non-interactive (`interactive={false}`), because a
 *   scrollable details screen must not swallow its own scroll when a finger lands on the map.
 * - The chip is ABSOLUTE, not laid out inside the map, so it keeps its drawn 12 from the bottom
 *   right at any width.
 *
 * THE MARKERS ARE THE TRACKING MAP'S OWN: `tone: 'pickup'` and `tone: 'drop'` are the two route
 * endpoints `features/tracking/components/TrackingMap.tsx` draws (its `LegacyMap`), and the
 * camera frames them with `fitToMarkers` + a uniform padding. Nothing else is drawn — no truck,
 * no route line — because the trip is over and the design draws neither.
 *
 * WITHOUT BOTH POINTS the design's own placeholder is drawn instead: the dashed surface/muted
 * box with "Map" in it. That is the one case where Figma's drawing IS the right answer, and it
 * is also what the app shows when the map key is missing (MapPreview falls back to its own
 * placeholder), so the two paths look the same.
 */

/** The drawn frame and chip offsets. */
const MAP_HEIGHT = 160;
const RADIUS = 16;
const CHIP_INSET = 12;
/** `I245:902;234:295`: the chip's label box, 81 wide inside a 133-wide chip. */
const CHIP_LABEL_WIDTH = 81;

/** The placeholder's own values, verbatim from Figma: 1.5 border/handle dashed, radius 16. */
const PLACEHOLDER_BORDER = 1.5;

export type RouteMapProps = {
  booking: BookingDetail;
  /** Opens the phone's maps app with directions. Omitted, the chip is inert (not drawn). */
  onOpenMap?: () => void;
};

export function RouteMap({ booking, onOpenMap }: RouteMapProps) {
  const Pressable = usePressablePrimitive();

  const pickup = booking.pickupPoint ?? null;
  const drop = booking.dropPoint ?? null;
  const framed = pickup !== null && drop !== null;

  const markers: MapMarker[] = framed
    ? [
        {
          key: 'pickup',
          coordinate: { latitude: pickup.lat, longitude: pickup.lng },
          tone: 'pickup',
        },
        { key: 'drop', coordinate: { latitude: drop.lat, longitude: drop.lng }, tone: 'drop' },
      ]
    : [];

  return (
    <View
      style={{
        width: '100%',
        height: MAP_HEIGHT,
        borderRadius: RADIUS,
        overflow: 'hidden',
      }}
    >
      {framed ? (
        <MapPreview
          style={{ flex: 1 }}
          markers={markers}
          fitToMarkers
          // Non-interactive: the whole map is a decoration on a scrolling screen, and the only
          // affordance is the chip.
          interactive={false}
          showRecenter={false}
          // No watermark text. The placeholder implementation draws `label` in 45 pt across the
          // middle ("MAP" by default), which is a debugging watermark, not 35's design — and on
          // the live API with no map key this IS the implementation that runs. Empty means the
          // real map shows through when there is one, and a plain tinted surface when there is
          // not, which is closer to the design than a giant "MAP" would be.
          label=""
        />
      ) : (
        <MapPlaceholder />
      )}

      <Pressable
        onPress={onOpenMap}
        disabled={!onOpenMap}
        pressScale={0.96}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="View on Map"
        style={{ position: 'absolute', right: CHIP_INSET, bottom: CHIP_INSET }}
      >
        {/*
          The label's box is drawn at 81 (`I245:902;234:295`) inside a 133-wide chip
          (13 + 81 + 6 + 20 + 13). The Map Chip master auto-widths its label, which would make
          this chip about 115 wide — 18 narrower than the design, enough to move its left edge —
          so the drawn box is given as a minimum.
        */}
        <MiMapChip label="View on Map" showIcon labelMinWidth={CHIP_LABEL_WIDTH} />
      </Pressable>
    </View>
  );
}

/** `Map (placeholder)` `245:900`, exactly as drawn: dashed border/handle, surface/muted, "Map". */
function MapPlaceholder() {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: RADIUS,
        borderWidth: PLACEHOLDER_BORDER,
        borderStyle: 'dashed',
        borderColor: mitowColors.borderHandle,
        backgroundColor: mitowColors.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MiText variant="title20" color="placeholder">
        Map
      </MiText>
    </View>
  );
}
