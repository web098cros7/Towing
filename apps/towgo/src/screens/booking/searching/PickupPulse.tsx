import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { RoutePin } from '@/features/booking/components/book-a-tow/RoutePin';

const RING = 150;
const RINGS = 3;
const PERIOD_MS = 2400;
const PULSE_COLOR = '#1E9E5A';

/**
 * The pickup while a driver is being found (owner decision, 24 Sep 2026; Figma
 * 16 draws the map bare): the green "Pickup point" pin, with rings pulsing out
 * from its foot, staggered, as ride apps show a search in progress. The box is
 * the ring's size and the pin's foot sits at its centre, so the overlay anchors
 * at the centre.
 */
export function PickupPulse({ label, animate = true }: { label: string; animate?: boolean }) {
  const phases = useRef(Array.from({ length: RINGS }, () => new Animated.Value(0))).current;

  useEffect(() => {
    if (!animate) return;
    const loops = phases.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((PERIOD_MS / RINGS) * i),
          Animated.timing(value, {
            toValue: 1,
            duration: PERIOD_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [phases, animate]);

  return (
    <View style={{ width: RING, height: RING * 2, alignItems: 'center' }}>
      {/* The rings, centred on the pin's foot (the box's vertical centre). */}
      {(animate ? phases : []).map((value, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            top: RING / 2,
            width: RING,
            height: RING,
            borderRadius: RING / 2,
            backgroundColor: PULSE_COLOR,
            opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [
              { scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.1, 1] }) },
            ],
          }}
        />
      ))}
      {/* The pin stands on the centre: its bottom edge at the box's middle. */}
      <View style={{ position: 'absolute', bottom: RING, alignItems: 'center' }}>
        <RoutePin kind="pickup" label={label} />
      </View>
    </View>
  );
}
