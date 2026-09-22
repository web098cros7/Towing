import React from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Circle, Defs, Path, Polyline, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '@towing/theme';
import { mitowColors, mitowRadii, mitowType } from '@/design';

/**
 * IMG-04 · Tow truck (top-down), pre-cropped from the Figma source render and
 * feathered by the design's Soft mask (opaque to 0.74 of the radius, then fading),
 * baked at the Truck group's 66 × 68 (@1x/@2x/@3x).
 */
const truckTopDown = require('./assets/truck-topdown.png');

/**
 * The Map Callout (Tail=Bottom Left `223:35`) riding on the truck: its copy,
 * verbatim with the hard line break, and the instance width.
 */
export type TruckCalloutSpec = { text: string; width: number };

/** Figma 18's Truck status callout `229:263`, 121.8 wide. */
export const EN_ROUTE_TRUCK_CALLOUT: TruckCalloutSpec = {
  text: 'Your tow truck\nis on the way',
  width: 121.8,
};

/**
 * Figma 19's Arrival callout `254:1541`, 111 wide. 19 draws it over a map
 * placeholder with nothing under its tail; it rides on the truck with 18's
 * offset (owner decision), so it points at the truck as 18's callout does.
 */
export const ARRIVING_TRUCK_CALLOUT: TruckCalloutSpec = {
  text: 'On the way to\nyour location',
  width: 111,
};

/**
 * Figma 25's Drop callout `236:485`, 126 wide. Like 19's, it is drawn over a
 * map placeholder with nothing under its tail, and rides on the truck with 18's
 * offset (the owner's 19 ruling, applied to 25).
 */
export const IN_TRANSIT_TRUCK_CALLOUT: TruckCalloutSpec = {
  text: 'On the way to\ndrop location',
  width: 126,
};

/**
 * One composite map overlay for Figma 18's driver: Truck glow `229:255`, the
 * route's first stretch, Truck `229:260` and the Truck status callout `229:263`
 * (Tail=Bottom Left, 121.8 wide), back to front exactly as the Map frame stacks
 * them.
 *
 * The box is the union of glow, truck and callout as drawn: screen (47, 131.2)
 * to (233.5, 256), so 186.5 × 124.8 on 18, with the truck centre at (45, 82.8)
 * inside it. The map anchors that point on the driver's coordinate, so the
 * callout follows the truck. The callout's left edge sits 19.7 right of the
 * truck centre and its top 82.8 above it (64.7, 0 in the box) on 18, 19 and
 * 25 alike; only its width, and so the box's, changes (19: 175.7 × 124.8; 25:
 * 190.7 × 124.8).
 */
export const TRUCK_CENTRE = { x: 45, y: 82.8 };
const CALLOUT_LEFT = 64.7;
const BOX_HEIGHT = 124.8;

export function truckMarkerGeometry(callout: TruckCalloutSpec): {
  box: { width: number; height: number };
  anchor: { x: number; y: number };
} {
  const width = CALLOUT_LEFT + callout.width;
  return {
    box: { width, height: BOX_HEIGHT },
    anchor: { x: TRUCK_CENTRE.x / width, y: TRUCK_CENTRE.y / BOX_HEIGHT },
  };
}

/** How far the callout reaches right of the truck centre (18: 141.5, 19: 130.7, 25: 145.7). */
export function calloutReach(callout: TruckCalloutSpec): number {
  return CALLOUT_LEFT - TRUCK_CENTRE.x + callout.width;
}

/** Route `229:257`: text/primary, 4.4, round caps and joins. */
export const ROUTE_STROKE = { color: mitowColors.textPrimary, width: 4.4 };
/** The route starts at screen (117, 240), 36 pt from the truck centre (92, 214). */
export const ROUTE_START_PT = 36;
/** The in-marker copy of the route runs just past the glow's edge (radius 43 about (90, 213)). */
export const ROUTE_STUB_END_PT = 46;

export function TruckMarker({
  routeStub,
  callout,
}: {
  routeStub: { x: number; y: number }[];
  callout: TruckCalloutSpec;
}) {
  const { box } = truckMarkerGeometry(callout);
  const stubPoints = routeStub
    .map((p) => `${TRUCK_CENTRE.x + p.x},${TRUCK_CENTRE.y + p.y}`)
    .join(' ');

  return (
    <View style={{ width: box.width, height: box.height }}>
      {/* Truck glow: 86 circle, radial #FCEEC4 → #FCF1CE 92 % at 0.72 → 0 % at the edge. */}
      <Svg width={86} height={86} style={{ position: 'absolute', left: 0, top: 38.8 }}>
        <Defs>
          <RadialGradient id="truckGlow" cx="43" cy="43" r="43" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FCEEC4" stopOpacity={1} />
            <Stop offset="0.72" stopColor="#FCF1CE" stopOpacity={0.92} />
            <Stop offset="1" stopColor="#FCF1CE" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="43" cy="43" r="43" fill="url(#truckGlow)" />
      </Svg>

      {/* Route: above the glow, below the truck image, as the Map frame stacks it. */}
      {routeStub.length >= 2 ? (
        <Svg
          width={box.width}
          height={box.height}
          style={{ position: 'absolute', left: 0, top: 0 }}
        >
          <Polyline
            points={stubPoints}
            fill="none"
            stroke={ROUTE_STROKE.color}
            strokeWidth={ROUTE_STROKE.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}

      <Image
        source={truckTopDown}
        style={{ position: 'absolute', left: 12, top: 48.8, width: 66, height: 68 }}
      />

      <TruckCallout callout={callout} />
    </View>
  );
}

/**
 * Map Callout `223:41`, variant Tail=Bottom Left: 18's instance `229:263` (bubble
 * 121.8 × 53, text box 105.8 × 37), 19's `254:1541` (bubble 111 × 53, text box
 * 95 × 37) or 25's `236:485` (bubble 126 × 53, text box 110 × 37). Padding 8, radius 10, surface/inverse, exactly the two centred lines,
 * tail row 10.5 overlapping the bubble by 1, tail 16 × 10.5 at left 8.
 *
 * Drawn here rather than with `MiMapCallout` because the marker is a fixed-size
 * bitmap: `MiText` scales type by the theme ratio and the system font scale, and
 * a third wrapped line would grow the bubble over the truck and be clipped by the
 * snapshot. Map artwork keeps the design's exact 13.5 / 18.5 type at every scale.
 */
function TruckCallout({ callout }: { callout: TruckCalloutSpec }) {
  const theme = useTheme();
  const type = mitowType.bodyXS135;

  return (
    <View
      style={{
        position: 'absolute',
        left: CALLOUT_LEFT,
        top: 0,
        width: callout.width,
        height: 62.5,
      }}
    >
      <View
        style={{
          width: callout.width,
          height: 53,
          padding: 8,
          borderRadius: mitowRadii.callout,
          backgroundColor: mitowColors.surfaceInverse,
        }}
      >
        <Text
          allowFontScaling={false}
          numberOfLines={2}
          style={{
            width: callout.width - 16,
            height: 37,
            fontFamily: theme.fonts[type.weight],
            fontSize: type.fontSize,
            lineHeight: type.lineHeight,
            letterSpacing: type.letterSpacing,
            color: mitowColors.textOnDark,
            textAlign: 'center',
          }}
        >
          {callout.text}
        </Text>
      </View>
      <View style={{ position: 'absolute', left: 8, top: 52 }}>
        <Svg width={16} height={10.5} viewBox="0 0 16 10.5">
          <Path d="M0 0H16L3 10C2.2 10.6 1 10.1 1 9.1L0 0Z" fill={mitowColors.surfaceInverse} />
        </Svg>
      </View>
    </View>
  );
}
