import React from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { mitowColors, mitowShadows, MiMapCallout, MiText } from '@/design';

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
// Customer: Figma 08's Pickup marker `528:19663` — the green "Pickup Point" pill
// over a 2 × 12 stem and a 20 ring pin, the pin centred on the pickup.
// ---------------------------------------------------------------------------

/** Pill 37 + stem 12 + pin 20: the drawn marker is 129 × 69. */
const PILL_H = 37;
const STEM_H = 12;
const PIN = 20;
/** Room around the drawn marker for the pill's Floating shadow and font scaling. */
const PAD_X = 30;
const PAD_TOP = 12;
const PAD_BOTTOM = 6;
const USER_BOX: MarkerBox = {
  left: 0,
  top: 0,
  width: 129 + PAD_X * 2,
  height: PAD_TOP + PILL_H + STEM_H + PIN + PAD_BOTTOM,
};
/** The pin's centre is the pickup. */
const USER_POINT = { x: USER_BOX.width / 2, y: PAD_TOP + PILL_H + STEM_H + PIN / 2 };

/** How far the pill's top sits above the pickup point. */
export const PICKUP_MARKER_ABOVE_POINT = PILL_H + STEM_H + PIN / 2;

export const userMarkerAnchor = anchorIn(USER_BOX, USER_POINT);
export const userMarkerCenterOffset = centerOffsetIn(USER_BOX, USER_POINT);

export function UserLocationMarker({ onLayout }: { onLayout?: () => void }) {
  return (
    // `collapsable={false}`: this box only lays its children out, so Android's
    // view flattening would remove it, and the map's marker snapshot then
    // caught the green pill alone, cut off, with no text, stem or pin (device,
    // 25 Sep 2026). A marker's root must stay a real native view.
    <View
      collapsable={false}
      onLayout={onLayout}
      style={{
        width: USER_BOX.width,
        height: USER_BOX.height,
        paddingTop: PAD_TOP,
        alignItems: 'center',
      }}
    >
      {/* Pickup Point 528:19664: status/success, padding 18 / 8, radius 20, Floating. */}
      <View
        style={{
          height: PILL_H,
          justifyContent: 'center',
          paddingHorizontal: 18,
          borderRadius: 20,
          backgroundColor: mitowColors.success,
          ...mitowShadows.floating,
        }}
      >
        <MiText variant="strong16" color="onDark" numberOfLines={1}>
          Pickup Point
        </MiText>
      </View>
      {/* Stem 528:19666: 2 × 12, status/success. */}
      <View style={{ width: 2, height: STEM_H, backgroundColor: mitowColors.success }} />
      {/* Pin 528:19667: white disc, 5 status/success ring (r 7.5 stroke 5 in a 20 box). */}
      <Svg width={PIN} height={PIN} viewBox="0 0 20 20">
        <Circle
          cx={10}
          cy={10}
          r={7.5}
          fill={mitowColors.surfacePage}
          stroke={mitowColors.success}
          strokeWidth={5}
        />
      </Svg>
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
