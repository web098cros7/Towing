import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useReducedMotion } from '@towing/ui';
import { mitowColors } from '../tokens/colors';

/**
 * The redesign's branded loading ring (Figma "Loader", 32×32): a full track with
 * a three-quarter yellow arc rotating over it.
 *
 * Driven by RN `Animated` rather than Reanimated because it is a plain, endless
 * transform loop with no gesture and no interruption — `useNativeDriver` hands it
 * to the UI thread, so it keeps spinning smoothly even while JS is busy
 * hydrating the session, which is precisely what the Splash screen is doing.
 *
 * Reduce-motion has to be handled explicitly here. Reanimated's `withTiming` /
 * `withSpring` honour the OS setting by themselves, but an `Animated.loop` does
 * not — hence `useReducedMotion()` from `@towing/ui`, which is the listener-based
 * hook that re-renders on change (Reanimated's same-named hook is a snapshot
 * taken at app start).
 */
export type MiSpinnerProps = {
  size?: number;
};

export function MiSpinner({ size = 32 }: MiSpinnerProps) {
  const reduceMotion = useReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, spin]);

  const ring = (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle
        cx={16}
        cy={16}
        r={14.5}
        stroke={mitowColors.borderSubtle}
        strokeWidth={3}
        fill="none"
      />
      <Path
        d="M16 0C19.8096 -1.66525e-07 23.4943 1.35933 26.3912 3.8335C29.288 6.30767 31.2071 9.7343 31.803 13.497C32.399 17.2598 31.6328 21.1117 29.6422 24.36C27.6517 27.6082 24.5675 30.0397 20.9443 31.2169L20.0172 28.3637C22.9611 27.4072 25.467 25.4317 27.0843 22.7925C28.7016 20.1533 29.3242 17.0236 28.8399 13.9664C28.3557 10.9091 26.7965 8.12499 24.4428 6.11472C22.0891 4.10446 19.0953 3 16 3L16 0Z"
        fill={mitowColors.brandYellow}
      />
    </Svg>
  );

  if (reduceMotion) {
    return (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading">
        {ring}
      </View>
    );
  }

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={{
        transform: [
          { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        ],
      }}
    >
      {ring}
    </Animated.View>
  );
}
