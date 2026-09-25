import React, { useEffect } from 'react';
import { Image, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@towing/ui';

/**
 * ILL-15 · Trip in progress map thumbnail: Ehsan's animation (a tow truck
 * carrying a car along the route, 25 Sep 2026), played from ONE sprite sheet.
 *
 * WHY A SPRITE, NOT THE LOTTIE: the Lottie he exported is 40 full 720 × 720
 * PNG frames embedded in JSON (25 MB) and would need a native Lottie module,
 * so a new dev build. The sprite holds the same clip's 48 frames (4 s at 12 fps)
 * at 150 px, 8 across × 6 down, in a 161 KB JPEG; the thumbnail slides it one
 * cell per frame on the UI thread. Rebuild it from the MP4 with:
 *   ffmpeg -i clip.mp4 -vf "fps=12,scale=150:150:flags=lanczos,tile=8x6" -frames:v 1 -q:v 6 ill15-trip-map-sprite.jpg
 */
const SPRITE = require('@/assets/illustrations/ill15-trip-map-sprite.jpg');
const COLS = 8;
const ROWS = 6;
const FRAMES = COLS * ROWS;
const LOOP_MS = 4000;

export function TripMapThumb({
  size,
  radius,
  playing,
}: {
  size: number;
  radius: number;
  /** Off while Home is out of sight, so nothing animates behind other screens. */
  playing: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!playing || reduceMotion) {
      cancelAnimation(t);
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: LOOP_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [playing, reduceMotion, t]);

  const sheet = useAnimatedStyle(() => {
    const frame = Math.min(FRAMES - 1, Math.floor(t.value * FRAMES));
    return {
      transform: [
        { translateX: -(frame % COLS) * size },
        { translateY: -Math.floor(frame / COLS) * size },
      ],
    };
  });

  return (
    <View
      style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[{ width: size * COLS, height: size * ROWS }, sheet]}>
        <Image
          source={SPRITE}
          fadeDuration={0}
          style={{ width: size * COLS, height: size * ROWS }}
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
    </View>
  );
}
