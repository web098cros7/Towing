import React from 'react';
import { View } from 'react-native';
import { towTypes } from '../data/towTypes.data';
import { useBookingStore } from '../store/bookingStore';
import { TowTypeCard } from './TowTypeCard';

/**
 * Figma 14 Vehicles row `259:1543`: exactly three equal tiles (Car, SUV, Bike),
 * gap 10, full content width, all 131 tall. Not scrollable. Single-select
 * against `bookingStore.towTypeId`.
 *
 * The row stretches its tiles, so the three bottoms always line up: at the
 * design's type scale every tile is exactly 131, which is what the drawn
 * top-aligned row shows.
 */
export function TowTypeCarousel() {
  const towTypeId = useBookingStore((s) => s.towTypeId);
  const setTowType = useBookingStore((s) => s.setTowType);

  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', alignItems: 'stretch', gap: 10 }}
    >
      {towTypes.map((towType) => (
        <TowTypeCard
          key={towType.id}
          towType={towType}
          selected={towType.id === towTypeId}
          onPress={() => setTowType(towType.id)}
          style={{ flex: 1 }}
        />
      ))}
    </View>
  );
}
