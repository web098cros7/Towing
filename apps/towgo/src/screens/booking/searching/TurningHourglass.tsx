import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { MiColorIcon } from '@/design';

/**
 * 16's hourglass, turned over every couple of seconds while the search runs,
 * so the banner visibly works (owner decision, 24 Sep 2026: "Hang tight" should
 * feel alive). A half turn with a pause, as a real one is turned.
 */
export function TurningHourglass({ size = 49 }: { size?: number }) {
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1400),
        Animated.timing(turn, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(turn, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <MiColorIcon name="hourglass" size={size} />
    </Animated.View>
  );
}
