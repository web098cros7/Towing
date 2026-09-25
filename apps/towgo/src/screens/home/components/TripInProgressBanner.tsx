import React, { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors, MiLineIcon, MiPlaceholder, MiText } from '@/design';
import { useActiveBooking } from '@/features/bookings/api/bookings.queries';
import { isActiveBooking, type Booking } from '@/features/bookings/types';
import { useTracking } from '@/features/tracking/api/tracking.queries';
import type { RootStackParamList } from '@/navigation/types';
import { useArrivalClock } from '@/screens/booking/tracking/useEstimatedArrival';
import { bannerCopy } from './tripBannerCopy';

/** Banner `557:23471`: 350 × 55. */
const BANNER_H = 55;
const RADIUS = 12.3;

/**
 * Trip in progress banner (overlay) `557:23471`, Figma 25c · Home · Trip
 * (expanded): while the customer has a trip in flight, Home floats this card
 * over its sheet, 22.5 in from each side and 27.4 above the tab bar. A
 * brand-yellow → white wash, radius 12.3, the 49.2 ILL-15 trip-map thumbnail,
 * "Drop by 10:50 AM" / "Heading to Indiranagar", and a dark 38.7 round arrow.
 * Tapping anywhere opens the trip's live view.
 *
 * Shown on Home only (owner decision, 25 Sep 2026). The design draws the tow
 * leg; the other live stages word the same two lines for where the trip is.
 */
export function TripInProgressBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const { booking } = useActiveBooking();
  if (!booking) return null;
  // Keyed so a new trip starts with a fresh arrival estimate.
  return <Banner key={booking.id} booking={booking} style={style} />;
}

function Banner({ booking, style }: { booking: Booking; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const searching = booking.status === 'searching';
  // The tracking poll is what notices the trip ending while Home is open; the
  // bookings list is not polled.
  const { data: tracking } = useTracking(booking.id, !searching);
  const arrival = useArrivalClock(tracking);
  const [width, setWidth] = useState<number | null>(null);

  const status = tracking?.status ?? booking.status;
  if (!isActiveBooking({ status })) return null;
  const { title, subtitle } = bannerCopy(booking, tracking, status, arrival);

  const open = () => {
    // A trip still searching has no driver to track: its live view is 16 Searching.
    if (status === 'searching') navigation.navigate('Searching', { bookingId: booking.id });
    else navigation.navigate('Tracking', { bookingId: booking.id });
  };

  return (
    <Pressable
      onPress={open}
      pressScale={theme.motion.pressScale.row}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}. Open trip`}
      style={[
        {
          height: BANNER_H,
          borderRadius: RADIUS,
          backgroundColor: mitowColors.surfacePage,
          boxShadow:
            '0px 9.7px 18.3px 0px rgba(16, 24, 40, 0.49), 0px 0.9px 2.6px 0px rgba(16, 24, 40, 0.06)',
        },
        style,
      ]}
    >
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 4,
          paddingRight: 8.3,
          borderRadius: RADIUS,
          overflow: 'hidden',
        }}
        onLayout={(e) => {
          const next = e.nativeEvent.layout.width;
          setWidth((prev) => (prev === next ? prev : next));
        }}
      >
        {/* The wash, sized in points (a percentage-sized Svg drew only a band; see PickupAddress). */}
        {width ? (
          <Svg
            pointerEvents="none"
            width={width}
            height={BANNER_H}
            style={{ position: 'absolute', left: 0, top: 0 }}
          >
            <Defs>
              <LinearGradient
                id="tripBannerWash"
                x1="0"
                y1="0"
                x2={width}
                y2="0"
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0" stopColor="#FFDF88" />
                <Stop offset="1" stopColor="#FFFFFF" />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={BANNER_H} fill="url(#tripBannerWash)" />
          </Svg>
        ) : null}

        {/* ILL-15 · Trip map 557:23780: the design's own placeholder until Ehsan's image lands. */}
        <MiPlaceholder label="ILL-15" width={49.2} height={49.2} radius={10.5} />

        {/* Text 557:23473: 17.1 after the thumbnail, 55.5 before the arrow (at 350 wide). */}
        <View style={{ flex: 1, gap: 1.8, marginLeft: 17.1, marginRight: 55.5 }}>
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

        {/* Open trip 557:23476: 38.7 surface/inverse circle, icon/arrow-right 19.3. */}
        <View
          style={{
            width: 38.7,
            height: 38.7,
            borderRadius: 19.35,
            backgroundColor: mitowColors.surfaceInverse,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MiLineIcon name="arrow-right" size={19.3} color={mitowColors.textOnDark} />
        </View>
      </View>
    </Pressable>
  );
}
