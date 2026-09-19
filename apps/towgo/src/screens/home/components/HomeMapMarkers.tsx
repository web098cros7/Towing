import React from 'react';
import { Image, View } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';
import { mitowColors, MiLineIcon, MiMapCallout, MiMapChip } from '@/design';

/*
 * The things Figma 07 (`287:2017`) draws ON Home's map. The customer group and
 * the truck + callout are map markers (views anchored to a coordinate); every
 * child keeps its design position inside its box. The truck glow is NOT here:
 * the design draws it under the route line, and a map marker always draws above
 * lines, so `HomeMap` draws it as a ground overlay instead (`truckGlow`).
 *
 * Boxes carry transparent room around the drawn bounds: the chip's Floating
 * shadow would otherwise be clipped from the marker snapshot, and MiText scales
 * type slightly per device.
 */

export type MarkerBox = { left: number; top: number; width: number; height: number };

/** The anchor as fractions of the box, for Google `anchor`. */
function anchorIn(box: MarkerBox, point: { x: number; y: number }) {
  return { x: (point.x - box.left) / box.width, y: (point.y - box.top) / box.height };
}

/** The same anchor as Apple Maps' `centerOffset` (it centres the view on the coordinate by default). */
function centerOffsetIn(box: MarkerBox, point: { x: number; y: number }) {
  return { x: box.width / 2 - (point.x - box.left), y: box.height / 2 - (point.y - box.top) };
}

// ---------------------------------------------------------------------------
// Customer: halo M5 + dot M6 + pickup pin M7 + "Your location" chip M8
// ---------------------------------------------------------------------------

/** Screen origin of the composite box in the 393 x 852 frame. */
const USER_BOX: MarkerBox = { left: 89, top: 267.8, width: 171.5, height: 70 };
/** Location dot centre (108.3, 329.3), where the route starts. */
const USER_POINT = { x: 108.3, y: 329.3 };

export const userMarkerAnchor = anchorIn(USER_BOX, USER_POINT);
export const userMarkerCenterOffset = centerOffsetIn(USER_BOX, USER_POINT);

export function UserLocationMarker() {
  const at = (x: number, y: number) => ({
    position: 'absolute' as const,
    left: x - USER_BOX.left,
    top: y - USER_BOX.top,
  });

  return (
    <View style={{ width: USER_BOX.width, height: USER_BOX.height }}>
      {/* M5 Location halo: ellipse 12 x 7 at (102.3, 326), border/handle. */}
      <Svg width={12} height={7} style={at(102.3, 326)}>
        <Ellipse cx={6} cy={3.5} rx={6} ry={3.5} fill={mitowColors.borderHandle} />
      </Svg>
      {/* M6 Location dot: ellipse 7 x 5 at (104.8, 326.8), text/primary. */}
      <Svg width={7} height={5} style={at(104.8, 326.8)}>
        <Ellipse cx={3.5} cy={2.5} rx={3.5} ry={2.5} fill={mitowColors.textPrimary} />
      </Svg>
      {/* M7 Pickup pin: icon/map-pin 32 at (93, 294.8). */}
      <MiLineIcon name="map-pin" size={32} style={at(93, 294.8)} />
      {/* M8 "Your location" Map Chip at (126.5, 283.8), no icon. */}
      <MiMapChip label="Your location" style={at(126.5, 283.8)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Partner: truck M4 + "Towing partner" callout M9 (glow M2 is a ground overlay)
// ---------------------------------------------------------------------------

/** Where the route line meets the truck, (276.0, 243.5): the partner's coordinate. */
const TRUCK_POINT = { x: 276, y: 243.5 };
/** Callout bottom (tail tip row) on 07: 139.8 + 62. The callout grows upward from here. */
const CALLOUT_BOTTOM = 201.8;
const TRUCK_BOX: MarkerBox = { left: 269.5, top: 131.8, width: 110, height: 119.2 };

export const partnerMarkerAnchor = anchorIn(TRUCK_BOX, TRUCK_POINT);
export const partnerMarkerCenterOffset = centerOffsetIn(TRUCK_BOX, TRUCK_POINT);

/**
 * M2 Truck glow (ellipse 88 x 80, centre (300, 233)) relative to the truck
 * point: 24 dp east and 10.5 dp north of it.
 */
export const truckGlow = {
  east: 300 - TRUCK_POINT.x,
  north: TRUCK_POINT.y - 233,
  width: 88,
  height: 80,
  /** The radial gradient (#FDE3A0 100% @0, #FCEFC6 95% @0.45, #FCF3D8 60% @0.8, 0% @1) at 3x. */
  image: require('./assets/home-map-glow.png'),
};

/**
 * IMG-03 as the design shows it, at 3x (180 x 120 px for 60 x 40 pt): the fill's
 * exact crop of the source image (x 485.3, y 482.2, 77.6 x 51.2 px), resampled
 * with Lanczos, with the "Soft mask" (ellipse 66 x 46 centred on the image,
 * alpha 100% to stop 0.72, 0% at 1) baked into its alpha channel.
 */
const truckImage = require('./assets/home-map-truck.png');

/** Callout line two, e.g. "4 mins away". */
export function etaLabel(minutes: number): string {
  return `${minutes} ${minutes === 1 ? 'min' : 'mins'} away`;
}

export function PartnerTruckMarker({
  etaMinutes,
  onImageLoad,
}: {
  etaMinutes: number;
  /**
   * The truck image finished loading. A custom Marker's Android bitmap is only
   * re-snapshotted while `tracksViewChanges` is on, so a late image (Expo Go
   * serves it from Metro over the LAN) must restart the settling window.
   */
  onImageLoad?: () => void;
}) {
  const left = (x: number) => x - TRUCK_BOX.left;
  const top = (y: number) => y - TRUCK_BOX.top;

  return (
    <View style={{ width: TRUCK_BOX.width, height: TRUCK_BOX.height }}>
      {/* M4 Truck: image 60 x 40 at (271, 211). */}
      <Image
        source={truckImage}
        resizeMode="stretch"
        onLoad={onImageLoad}
        style={{ position: 'absolute', left: left(271), top: top(211), width: 60, height: 40 }}
        accessibilityIgnoresInvertColors
      />
      {/* M9 Partner ETA callout: Tail=Bottom, width 110, at (269.5, 139.8). */}
      <MiMapCallout
        text={`Towing partner\n${etaLabel(etaMinutes)}`}
        tail="bottom"
        width={110}
        style={{
          position: 'absolute',
          left: left(269.5),
          bottom: TRUCK_BOX.top + TRUCK_BOX.height - CALLOUT_BOTTOM,
        }}
      />
    </View>
  );
}
