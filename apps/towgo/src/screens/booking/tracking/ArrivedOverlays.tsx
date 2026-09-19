import React from 'react';
import { View } from 'react-native';
import { MiMapCallout, MiMapChip } from '@/design';

/**
 * The map overlays of Figma 23 · Driver Arrived and 24 · Collection Code.
 *
 * Both frames draw a map Placeholder with these floating over it and nothing
 * under them. On the live map they are anchored to coordinates (owner decision):
 * 23's callout on the driver, 23's chip on the pickup, 24's chip on the driver.
 * Each is ONE marker view, so the anchor is computed on its own box (FOUNDATION
 * §7.5); the transparent padding keeps the Floating shadow inside the snapshot.
 */

/** Figma 23 Arrival callout `236:393`, verbatim. */
export const ARRIVED_CALLOUT_TEXT = 'Driver has arrived';
/** Figma 23 Your location chip `236:399`, verbatim. */
export const YOUR_LOCATION_TEXT = 'Your location';

/**
 * Arrival callout `236:393`: Map Callout Tail=Bottom, 156 wide, bubble padding
 * 12.5 / 8 held at 44 tall, tail row 10 overlapping by 1: 156 × 53. The tail's
 * tip is at (68, 52.6), so that point sits on the driver.
 */
const CALLOUT_WIDTH = 156;
const CALLOUT_HEIGHT = 53;
export const ARRIVED_CALLOUT_ANCHOR = { x: 68 / CALLOUT_WIDTH, y: 52.6 / CALLOUT_HEIGHT };

export function ArrivedCallout() {
  return (
    <MiMapCallout
      text={ARRIVED_CALLOUT_TEXT}
      tail="bottom"
      width={CALLOUT_WIDTH}
      paddingVertical={12.5}
      bubbleHeight={44}
    />
  );
}

/** Room round a chip for its Floating shadow (0/6 blur 16) inside the marker bitmap. */
const SHADOW_PAD = 12;

/**
 * Your location chip `236:399` (Map Chip, 108 × 32 at (165.9, 300)).
 *
 * Figma draws it 103.7 below the callout's tail tip (232.4, 196.3) and 66.5 to
 * the left of it. At arrival the driver stands on the pickup, so the chip keeps
 * exactly that offset from the pickup: with the driver there, callout and chip
 * sit as drawn instead of on top of each other (Data gap: anchoring).
 *
 * The box starts at the pickup (its top edge) and runs to the chip plus shadow
 * room; it is wider than the drawn chip so a larger system font never clips the
 * hugging label in the bitmap. The anchor is the pickup: (66.5 + 12) from the
 * left, on the top edge.
 */
const CHIP_LEFT_OF_POINT = 165.9 - 232.4;
const CHIP_BELOW_POINT = 300 - 196.3;
const LOCATION_BOX = { width: 220, height: CHIP_BELOW_POINT + 32 + 2 * SHADOW_PAD + 8 };
export const YOUR_LOCATION_ANCHOR = {
  x: (SHADOW_PAD - CHIP_LEFT_OF_POINT) / LOCATION_BOX.width,
  y: 0,
};

export function YourLocationChip() {
  return (
    <View style={{ width: LOCATION_BOX.width, height: LOCATION_BOX.height }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: CHIP_BELOW_POINT - SHADOW_PAD,
          padding: SHADOW_PAD,
        }}
      >
        <MiMapChip label={YOUR_LOCATION_TEXT} />
      </View>
    </View>
  );
}

/**
 * 24's Driver chip `299:4124`: Map Chip "{first name} is here" (117 × 32 for
 * "Rakesh is here"), centred on the driver. The chip hugs its label, so the box
 * centres it in a fixed-width row wide enough for a long name, and the anchor is
 * the box centre, which is the chip centre.
 */
const DRIVER_BOX = { width: 280, height: 32 + 2 * SHADOW_PAD + 8 };
export const DRIVER_HERE_ANCHOR = { x: 0.5, y: 0.5 };

export function DriverHereChip({ label }: { label: string }) {
  return (
    <View
      style={{
        width: DRIVER_BOX.width,
        height: DRIVER_BOX.height,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MiMapChip label={label} style={{ alignSelf: 'center' }} />
    </View>
  );
}
