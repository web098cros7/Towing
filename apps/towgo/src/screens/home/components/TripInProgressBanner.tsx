import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive, useReducedMotion } from '@towing/ui';
import { mitowColors, MiLineIcon, MiText } from '@/design';
import { useActiveBooking } from '@/features/bookings/api/bookings.queries';
import { type Booking } from '@/features/bookings/types';
import { useTracking } from '@/features/tracking/api/tracking.queries';
import type { RootStackParamList } from '@/navigation/types';
import { useArrivalClock } from '@/screens/booking/tracking/useEstimatedArrival';
import { bannerCopy } from './tripBannerCopy';
import { TripMapThumb } from './TripMapThumb';

/** Both states are 55 tall. */
const CARD_H = 55;
/** 25b Trip tab (collapsed) `560:21186`: 75 wide at x 0.5, right corners 14. */
const TAB_W = 75;
const TAB_LEFT = 0.5;
const TAB_RADIUS = 14;
/** 25c Trip banner (expanded) `557:23471`: 22.5 in from each side, radius 12.3. */
const BANNER_INSET = 22.5;
const BANNER_RADIUS = 12.3;
/** ILL-15: 49.2, radius 10.5; 6 from the left on the tab, 4 on the banner. */
const THUMB = 49.2;
const THUMB_RADIUS = 10.5;
/** Banner text `557:23473` at x 70.3, ending 55.5 before the 38.7 arrow at 8.3 from the right. */
const TEXT_LEFT = 70.3;
const TEXT_RIGHT = 8.3 + 38.7 + 55.5;
const ARROW = 38.7;
const ARROW_RIGHT = 8.3;

/** The trip stages the tab is shown for: "driver coming or towing" (Figma note on `560:21186`). */
const SHOWN_FOR: ReadonlySet<Booking['status']> = new Set([
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
]);

/**
 * The trip overlay on Home, Figma 25b / 25c. While a driver is coming or the
 * car is being towed, Home shows a small tab at the left edge above the tab bar
 * (25b `560:21186`): the ILL-15 animation and a chevron. Tapping it expands it
 * into the full banner (25c `557:23471`): "Drop by 10:50 AM" / "Heading to
 * Indiranagar" and a dark arrow; tapping that opens the trip's live view.
 * Every return to Home starts collapsed again (Figma note). Home only.
 */
export function TripInProgressBanner({
  screenWidth,
  bottom,
}: {
  screenWidth: number;
  bottom: number;
}) {
  const { booking } = useActiveBooking();
  if (!booking || !SHOWN_FOR.has(booking.status)) return null;
  // Keyed so a new trip starts with a fresh arrival estimate.
  return (
    <TripOverlay key={booking.id} booking={booking} screenWidth={screenWidth} bottom={bottom} />
  );
}

function TripOverlay({
  booking,
  screenWidth,
  bottom,
}: {
  booking: Booking;
  screenWidth: number;
  bottom: number;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  // The tracking poll is what notices the trip ending while Home is open; the
  // bookings list is not polled.
  const { data: tracking } = useTracking(booking.id);
  const arrival = useArrivalClock(tracking);

  const [expanded, setExpanded] = useState(false);
  const progress = useSharedValue(0);

  // Collapsed again on every return to Home: reset while leaving, so it never
  // visibly folds up as Home comes back.
  useFocusEffect(
    useCallback(
      () => () => {
        setExpanded(false);
        progress.value = 0;
      },
      [progress],
    ),
  );

  const bannerW = Math.max(TAB_W, screenWidth - BANNER_INSET * 2);

  const card = useAnimatedStyle(() => {
    const p = progress.value;
    const left = interpolate(p, [0, 1], [0, BANNER_RADIUS]);
    const right = interpolate(p, [0, 1], [TAB_RADIUS, BANNER_RADIUS]);
    return {
      left: interpolate(p, [0, 1], [TAB_LEFT, BANNER_INSET]),
      width: interpolate(p, [0, 1], [TAB_W, bannerW]),
      borderTopLeftRadius: left,
      borderBottomLeftRadius: left,
      borderTopRightRadius: right,
      borderBottomRightRadius: right,
    };
  });
  const clip = useAnimatedStyle(() => {
    const p = progress.value;
    const left = interpolate(p, [0, 1], [0, BANNER_RADIUS]);
    const right = interpolate(p, [0, 1], [TAB_RADIUS, BANNER_RADIUS]);
    return {
      borderTopLeftRadius: left,
      borderBottomLeftRadius: left,
      borderTopRightRadius: right,
      borderBottomRightRadius: right,
    };
  });
  // The wash is drawn once at the banner's width and squeezed to the card's, so
  // the tab shows the whole yellow → white run as 25b draws it.
  const wash = useAnimatedStyle(() => ({
    transform: [{ scaleX: interpolate(progress.value, [0, 1], [TAB_W / bannerW, 1]) }],
  }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [6, 4]) }],
  }));
  const chevron = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4], [1, 0], 'clamp'),
  }));
  const details = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.5, 1], [0, 1], 'clamp'),
  }));

  const status = tracking?.status ?? booking.status;
  if (!SHOWN_FOR.has(status)) return null;
  const { title, subtitle } = bannerCopy(booking, tracking, status, arrival);

  const onPress = () => {
    if (expanded) {
      navigation.navigate('Tracking', { bookingId: booking.id });
      return;
    }
    setExpanded(true);
    progress.value = reduceMotion
      ? 1
      : withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
  };

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          bottom,
          height: CARD_H,
          backgroundColor: mitowColors.surfacePage,
          boxShadow:
            '0px 9.7px 18.3px 0px rgba(16, 24, 40, 0.49), 0px 0.9px 2.6px 0px rgba(16, 24, 40, 0.06)',
        },
        card,
      ]}
    >
      <Pressable
        onPress={onPress}
        pressScale={theme.motion.pressScale.row}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? `${title}. ${subtitle}. Open trip` : `Trip in progress. ${title}`
        }
        accessibilityHint={expanded ? undefined : 'Shows your trip'}
        style={{ flex: 1 }}
      >
        <Animated.View style={[{ flex: 1, overflow: 'hidden' }, clip]}>
          <Animated.View
            pointerEvents="none"
            style={[
              { position: 'absolute', left: 0, top: 0, width: bannerW, height: CARD_H },
              { transformOrigin: 'left' },
              wash,
            ]}
          >
            <Svg width={bannerW} height={CARD_H}>
              <Defs>
                <LinearGradient
                  id="tripBannerWash"
                  x1="0"
                  y1="0"
                  x2={bannerW}
                  y2="0"
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop offset="0" stopColor="#FFDF88" />
                  <Stop offset="1" stopColor="#FFFFFF" />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={bannerW} height={CARD_H} fill="url(#tripBannerWash)" />
            </Svg>
          </Animated.View>

          {/* ILL-15 · Trip map 560:21187 / 557:23780. */}
          <Animated.View
            style={[{ position: 'absolute', left: 0, top: (CARD_H - THUMB) / 2 }, thumb]}
          >
            <TripMapThumb size={THUMB} radius={THUMB_RADIUS} playing={focused} />
          </Animated.View>

          {/* Line 1 561:24795: the tab's ">" (Figma's vector, turned upright), 8.5 × 31.8 at (60, 12). */}
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', left: 60 - 1.25, top: 12 - 1.25 }, chevron]}
          >
            <Svg width={11.17} height={34.26} viewBox="0 0 11.17 34.26" fill="none">
              <Path
                d="M1.25 1.25L9.75 16.75L1.25 33"
                stroke="#000000"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </Svg>
          </Animated.View>

          {/* Banner text 557:23473 and Open trip 557:23476, laid out at the banner's width. */}
          <Animated.View
            pointerEvents="none"
            style={[
              { position: 'absolute', left: 0, top: 0, width: bannerW, height: CARD_H },
              details,
            ]}
          >
            <View
              style={{
                position: 'absolute',
                left: TEXT_LEFT,
                right: TEXT_RIGHT,
                top: 0,
                bottom: 0,
                justifyContent: 'center',
                gap: 1.8,
              }}
            >
              <MiText
                variant="strong15"
                numberOfLines={1}
                style={{ fontSize: 14.9, lineHeight: 19.3, letterSpacing: -0.3 }}
              >
                {title}
              </MiText>
              <MiText
                variant="bodyS14"
                numberOfLines={1}
                style={{ fontSize: 12.3, lineHeight: 16.7, color: 'rgba(0, 0, 0, 0.85)' }}
              >
                {subtitle}
              </MiText>
            </View>
            <View
              style={{
                position: 'absolute',
                right: ARROW_RIGHT,
                top: (CARD_H - ARROW) / 2,
                width: ARROW,
                height: ARROW,
                borderRadius: ARROW / 2,
                backgroundColor: mitowColors.surfaceInverse,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MiLineIcon name="arrow-right" size={19.3} color={mitowColors.textOnDark} />
            </View>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
