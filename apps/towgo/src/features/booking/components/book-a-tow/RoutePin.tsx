import React from 'react';
import { View } from 'react-native';
import { TowTruckIcon, type TowVehicleClass } from '@/components/TowTruckIcon';
import { mitowColors, MiText } from '@/design';

/** Pickup green and drop red, as ride apps mark the two ends of a trip. */
const PIN_COLOR = { pickup: '#1E9E5A', drop: '#E0463B' } as const;
const PIN = 22;
const STEM = 12;

/**
 * A trip end on the booking map (owner decision, 24 Sep 2026; Figma 14 draws no
 * pins): the address in a white chip over a coloured pin on a short stem. Its
 * anchor is the stem's foot, `{ x: 0.5, y: 1 }`, so the stem touches the point.
 */
export function RoutePin({ kind, label }: { kind: 'pickup' | 'drop'; label: string }) {
  const color = PIN_COLOR[kind];
  return (
    <View style={{ alignItems: 'center' }}>
      {label ? (
        <View
          style={{
            maxWidth: 190,
            marginBottom: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 10,
            backgroundColor: mitowColors.surfacePage,
            borderWidth: 1,
            borderColor: mitowColors.borderSubtle,
          }}
        >
          <MiText variant="bodyS14" numberOfLines={1}>
            {label}
          </MiText>
        </View>
      ) : null}
      <View
        style={{
          width: PIN,
          height: PIN,
          borderRadius: PIN / 2,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: mitowColors.surfacePage,
          }}
        />
      </View>
      <View style={{ width: 2, height: STEM, backgroundColor: mitowColors.textPrimary }} />
    </View>
  );
}

/** A nearby tow truck on the booking map: its own kind, facing the way it is heading. */
export function NearbyTruck({
  vehicleClass,
  headingDeg,
}: {
  vehicleClass: TowVehicleClass | null;
  headingDeg: number | null;
}) {
  return <TowTruckIcon vehicleClass={vehicleClass} headingDeg={headingDeg} size={44} />;
}
