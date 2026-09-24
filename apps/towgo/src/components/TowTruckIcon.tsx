import React from 'react';
import { Image, View } from 'react-native';

export type TowVehicleClass = 'flatbed' | 'wheel_lift';

/**
 * The two tow trucks seen from above, from the owner's Figma icons (Wheel-lift
 * `512:22231`, Flatbed `515:25426`), exported with the cab turned to face NORTH,
 * so a heading in degrees clockwise from north is the rotation to apply.
 */
const ART: Record<TowVehicleClass, number> = {
  flatbed: require('@/assets/map/truck-flatbed.png'),
  wheel_lift: require('@/assets/map/truck-wheel-lift.png'),
};
/** Width over length of each export (220 × 517 and 212 × 444). */
const ASPECT: Record<TowVehicleClass, number> = { flatbed: 220 / 517, wheel_lift: 212 / 444 };
/** The Figma trucks' true lengths (1723 and 1480): a wheel-lift draws shorter than a flatbed. */
const RELATIVE_LENGTH: Record<TowVehicleClass, number> = { flatbed: 1, wheel_lift: 1480 / 1723 };

/**
 * A tow truck on a map, facing `headingDeg` (clockwise from north; unknown faces
 * north). Drawn in a `size` × `size` square with the truck centred, so it
 * turns about its own centre without leaving the square. An unknown truck
 * type draws a wheel-lift.
 *
 * The rotation is relative to the SCREEN, so it matches the road on a map kept
 * north-up, which is how every map in the app is drawn.
 */
export function TowTruckIcon({
  vehicleClass,
  headingDeg,
  size = 48,
}: {
  vehicleClass: TowVehicleClass | null | undefined;
  headingDeg: number | null | undefined;
  size?: number;
}) {
  const kind = vehicleClass ?? 'wheel_lift';
  const length = size * RELATIVE_LENGTH[kind];
  const width = length * ASPECT[kind];
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={ART[kind]}
        style={{ width, height: length, transform: [{ rotate: `${headingDeg ?? 0}deg` }] }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
