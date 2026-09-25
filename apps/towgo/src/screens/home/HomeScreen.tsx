import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, {
  Circle,
  Defs,
  FeGaussianBlur,
  Filter,
  G,
  LinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import {
  mitowColors,
  mitowShadows,
  MiButton,
  MiHelpChip,
  MiInfoBanner,
  MiLineIcon,
  MiMapButton,
  MiServiceTile,
  MiSheetPanel,
  MiText,
  type MiColorIconName,
} from '@/design';
import { useLocationStore } from '@/features/location/locationStore';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import { track } from '@/lib/analytics/analytics';
import { env } from '@/lib/env';
import type { RootStackParamList } from '@/navigation/types';
import { splitAddress } from '@/utils/address';
import { HomeMap, type HomeMapHandle } from './components/HomeMap';
import { PICKUP_MARKER_ABOVE_POINT } from './components/HomeMapMarkers';
import { TripInProgressBanner } from './components/TripInProgressBanner';

/**
 * Figma 08 · Home (`225:69`), with screen 07's map (`287:2017`) on a real
 * Google map (product owner decision). Built from spec 07-08-home.md.
 *
 * Geometry is the 393 × 852 frame. The status bar there is 50 tall, so top
 * chrome y positions are `insets.top + (y − 50)`. The sheet is anchored to the
 * bottom of the screen area; the navigator's tab bar (Home variant: no border,
 * white) continues it as one white surface, so the sheet's bottom padding is
 * the drawn 12.1 between the banner and the tab bar.
 *
 * The push-priming sheet (07) is mounted by RootNavigator over this screen.
 *
 * ⚠ "Fast Towing," is asserted by Maestro flows to detect Home.
 */

/** Design frame. */
const FRAME_W = 393;
const STATUS_BAR_H = 50;
/** Home sheet 226:177 top on the frame; map 287:2017 runs 30 below it. */
const SHEET_TOP_Y = 370;
const SHEET_OVERLAP = 30;
/** Home sheet 226:177 height above the tab bar: tab bar sits at sheet y 397.9. */
const SHEET_H_DRAWN = 397.9;

/** Where 07 draws the customer's dot and the route's end at the truck. */
const DESIGN_USER = { x: 108.3, y: 329.3 };
/** Hero 228:265's top on the frame: the top of the map's clear area now that the hero is gone. */
const HERO_TOP_Y = 130.4;
/** The "Pickup Point" pill's top above the pickup (Figma 08's marker `528:19663`). */
const CHIP_ABOVE_DOT = PICKUP_MARKER_ABOVE_POINT;
/** The dot never sits closer to the sheet than this (the map's framing room below it). */
const DOT_MIN_ABOVE_SHEET = 12;
const DESIGN_PARTNER = { x: 276.0, y: 243.5 };

/** 5.5 Services row: fill width 349.7, four 68 tiles at fixed gap 24.45 (4.35 left over on the right). */
const SERVICES_ROW_W = 349.7;
const SERVICES_ROW_SLACK = 4.35;

type ServiceTile = {
  slug: string;
  label: string;
  icon: MiColorIconName;
  iconSize: number;
};

/** 5.5a–d, labels verbatim with their hard breaks. */
const SERVICE_TILES: ServiceTile[] = [
  { slug: 'car_tow', label: 'Tow a Car', icon: 'tow-truck', iconSize: 56 },
  { slug: 'battery', label: 'Battery\nJump Start', icon: 'battery', iconSize: 50 },
  { slug: 'flat_tyre', label: 'Flat Tyre\nSupport', icon: 'tyre', iconSize: 50 },
  { slug: 'fuel', label: 'Out of\nFuel', icon: 'jerry-can', iconSize: 50 },
];

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const pickup = useLocationStore((s) => s.pickup);
  const resolveCurrentLocation = useLocationStore((s) => s.resolveCurrentLocation);

  // Home opens on the customer's own position (owner decision, 24 Sep 2026):
  // the permission prompt on first open, then the map moves to the fix. Live
  // mode only; mock mode keeps the drawn example ("MG Road, Bengaluru").
  // Refused permission leaves the default where it is.
  useEffect(() => {
    if (!env.useMocks) void resolveCurrentLocation();
  }, [resolveCurrentLocation]);
  const setServiceSlug = useBookingStore((s) => s.setServiceSlug);

  // Home shows the customer's location only (owner decision, 24 Sep 2026): no
  // truck, route line or "Towing partner" callout, as Rapido's home map.
  const partner = undefined;

  const [screenW, setScreenW] = useState(FRAME_W);
  const [sheetH, setSheetH] = useState(SHEET_H_DRAWN);
  const [containerH, setContainerH] = useState(SHEET_TOP_Y + SHEET_H_DRAWN);

  const map = useRef<HomeMapHandle>(null);

  const chromeTop = insets.top - STATUS_BAR_H;
  const sheetTop = containerH - sheetH;
  const mapHeight = Math.max(0, sheetTop + SHEET_OVERLAP);

  /*
   * Where the map puts 07's two points on this device, keeping each tied to the
   * chrome it sits beside in the design (identical to the frame on a 393 × 852
   * screen with a 50 pt status bar):
   * - the customer's dot stays 40.7 above the sheet, like Recenter, and 108.3
   *   from the left, like Menu and Hero; on a screen too short for that, it
   *   moves down (to no closer than 12 above the sheet) so the "Your location"
   *   chip keeps its drawn 28.3 below the Hero instead of sliding under it;
   * - the truck stays where the top chrome puts it (so the callout keeps its
   *   45.3 below the Help chip) and 117 from the right, like Help and Recenter,
   *   but never at a flatter angle from the dot than the design's 85.8 : 167.7
   *   (on a short screen it rises instead of sliding left under the Hero).
   */
  // The customer's position sits in the middle of the map's visible area (owner
  // decision, 24 Sep 2026: with no hero or truck, it is centred, as Rapido's), a
  // little below the vertical centre so the "Pickup Point" chip above it is too.
  const visibleTop = chromeTop + HERO_TOP_Y;
  const customerAt = {
    x: screenW / 2,
    y: Math.min(sheetTop - DOT_MIN_ABOVE_SHEET, (visibleTop + sheetTop) / 2 + CHIP_ABOVE_DOT / 2),
  };
  const partnerX = screenW - (FRAME_W - DESIGN_PARTNER.x);
  const designRise =
    ((partnerX - customerAt.x) * (DESIGN_USER.y - DESIGN_PARTNER.y)) /
    (DESIGN_PARTNER.x - DESIGN_USER.x);
  const partnerAt = {
    x: partnerX,
    y: Math.min(chromeTop + DESIGN_PARTNER.y, customerAt.y - designRise),
  };
  const mapRoom = { west: customerAt.x - 21, south: Math.max(0, sheetTop - 12 - customerAt.y) };

  const openBooking = useCallback(() => navigation.navigate('BookLocation'), [navigation]);

  const useMyLocation = useCallback(() => {
    // Resolves the device fix as pickup (permission prompt included) while
    // step 10 opens; the location store feeds that screen's Pickup field.
    void resolveCurrentLocation();
    navigation.navigate('BookLocation');
  }, [navigation, resolveCurrentLocation]);

  const recenter = useCallback(() => {
    void resolveCurrentLocation();
    map.current?.frame(true);
  }, [resolveCurrentLocation]);

  const openService = useCallback(
    (slug: string) => {
      setServiceSlug(slug);
      track('service_selected', { slug });
      navigation.navigate('BookLocation');
    },
    [navigation, setServiceSlug],
  );

  const onContainerLayout = (e: LayoutChangeEvent) => {
    setContainerH(e.nativeEvent.layout.height);
    setScreenW(e.nativeEvent.layout.width);
  };
  const onSheetLayout = (e: LayoutChangeEvent) => setSheetH(e.nativeEvent.layout.height);

  return (
    <View
      style={{ flex: 1, backgroundColor: mitowColors.surfacePage }}
      onLayout={onContainerLayout}
    >
      <StatusBar style="dark" />

      {/* Map 287:2017: from the top of the screen, the sheet covers its bottom 30. */}
      <HomeMap
        ref={map}
        style={{ position: 'absolute', top: 0, left: 0 }}
        width={screenW}
        height={mapHeight}
        coveredBottom={SHEET_OVERLAP}
        customer={pickup.coords}
        partner={partner}
        customerAt={customerAt}
        partnerAt={partnerAt}
        room={mapRoom}
      />

      {/* 1. Menu 228:255: bare icon/menu 25 at (21.3, 58.5). No destination yet. */}
      <MenuButton style={{ position: 'absolute', left: 21.3, top: chromeTop + 58.5 }} />

      {/* 2. Help chip 228:257 at (283.7, 48.5), right inset 14.3. */}
      <MiHelpChip
        onPress={() => navigation.navigate('Support')}
        // Root 58: the tab navigator has no `Support` route, so this bubbles
        // past the tabs to the root stack.
        style={{ position: 'absolute', right: 14.3, top: chromeTop + 48.5 }}
      />

      {/* Hero 228:265 ("Fast Towing, Anytime") removed (owner decision, 24 Sep 2026): the map
          stays clear, as Rapido's home map. */}

      {/* 4. Recenter 228:268: 55 circle, 12.5 above the sheet, right inset 18.2. */}
      <MiMapButton
        icon="navigation"
        size={55}
        iconSize={24}
        accessibilityLabel="Recenter map"
        onPress={recenter}
        style={{ position: 'absolute', right: 18.2, bottom: sheetH + 12.5 }}
      />

      {/* 5. Home bottom sheet 226:177 (the tab bar below continues it). */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} onLayout={onSheetLayout}>
        <MiSheetPanel
          showHandle={false}
          paddingTop={10.3}
          paddingLeft={22.4}
          paddingRight={20.9}
          paddingBottom={12.1}
          addSafeArea={false}
          gap={12}
        >
          {/* 5.1 Handle 226:178: grabber 49.5 × 5. */}
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 49.5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: mitowColors.borderHandle,
              }}
            />
          </View>

          {/* 5.2 Heading 226:180. */}
          <MiText variant="title20">Where do you need a tow?</MiText>

          {/* 5.3 Pickup address 528:20363. */}
          <PickupAddress onPress={useMyLocation} />

          {/* 5.4 Book a Tow 226:187: 50 tall, padding 21 / 16. */}
          <MiButton
            label="Book a Tow"
            trailingIcon="arrow-right"
            height={50}
            paddingLeft={21}
            paddingRight={16}
            onPress={openBooking}
          />

          {/*
            5.5 Services row 226:191: padding 4.6 / 3.3. At the design's 349.7
            width the tiles sit at the fixed gap 24.45 with 4.35 left over on the
            right; wider sheets keep that (the row stops at 349.7, left aligned),
            narrower ones close the gaps so no tile passes the sheet's padding.
          */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              maxWidth: SERVICES_ROW_W,
              paddingRight: SERVICES_ROW_SLACK,
              paddingTop: 4.6,
              paddingBottom: 3.3,
            }}
          >
            {SERVICE_TILES.map((tile) => (
              <MiServiceTile
                key={tile.slug}
                width={68}
                icon={tile.icon}
                iconSize={tile.iconSize}
                label={tile.label}
                onPress={() => openService(tile.slug)}
              />
            ))}
          </View>

          {/* 5.6 24/7 banner 226:261 → 09 Roadside Assistance. */}
          <MiInfoBanner
            icon="verified"
            iconSize={49}
            title="24/7 Roadside Assistance"
            subtitle="We're here so you can keep moving"
            showChevron
            onPress={() => navigation.navigate('RoadsideAssistance')}
          />
        </MiSheetPanel>
      </View>

      {/* 25c Trip in progress banner 557:23471: 22.5 in, 27.4 above the tab bar. */}
      <TripInProgressBanner
        style={{ position: 'absolute', left: 22.5, right: 22.5, bottom: 27.4 }}
      />
    </View>
  );
}

/**
 * Menu 228:255: the glyph only (no container). Figma draws no menu screen, so it opens the
 * Profile tab — the account hub every menu item would lead to (reported).
 */
function MenuButton({ style }: { style: React.ComponentProps<typeof View>['style'] }) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable
      onPress={() => navigation.navigate('Tabs', { screen: 'Profile' })}
      pressScale={theme.motion.pressScale.chip}
      haptic="light"
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Menu"
      style={style}
    >
      <MiLineIcon name="menu" size={25} />
    </Pressable>
  );
}

/**
 * 5.3 Pickup address `528:20363`: a white pill with a 20% brand-yellow → grey
 * wash, radius 26, padding 16 / 18 / 14, gap 12, MiTow/Elevation/Floating. A
 * 16 green ring dot, then the pickup's address on one line with its first part
 * bold ("**12**, MG Road, …"). Tapping it opens Enter Location on the device fix.
 */
function PickupAddress({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const status = useLocationStore((s) => s.status);
  const label = useLocationStore((s) => s.pickup.label);

  // Live mode starts on the store's example pickup until the fix lands, so
  // the address shows only once the device has answered.
  const resolved = env.useMocks || status === 'ready';
  const address = resolved ? splitAddress(label) : null;
  const placeholder = status === 'locating' ? 'Finding your location…' : 'Use my current location';
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.row}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={address ? `Pickup: ${label}` : placeholder}
      style={{
        borderRadius: 26,
        backgroundColor: mitowColors.surfacePage,
        ...mitowShadows.floating,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingLeft: 16,
          paddingRight: 18,
          paddingVertical: 14,
          borderRadius: 26,
          overflow: 'hidden',
        }}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSize((prev) =>
            prev && prev.width === width && prev.height === height ? prev : { width, height },
          );
        }}
      >
        {/* The wash, sized to the pill in points: a percentage-sized Svg drew it as a band
            across the top only (device, 25 Sep 2026). */}
        {size ? (
          <Svg
            pointerEvents="none"
            width={size.width}
            height={size.height}
            style={{ position: 'absolute', left: 0, top: 0 }}
          >
            <Defs>
              <LinearGradient
                id="pickupWash"
                x1="0"
                y1="0"
                x2={size.width}
                y2="0"
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0" stopColor="#FEE176" stopOpacity={0.2} />
                <Stop offset="1" stopColor="#F3F6F8" stopOpacity={0.2} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#pickupWash)" />
          </Svg>
        ) : null}
        {/* Pickup dot 528:20364: a white disc (r 8) in a 4 status/success ring (r 6), under
            Figma's layer blur 4 (Gaussian σ 2). Drawn in a 24 box, 4 past the 16 slot each side. */}
        <View style={{ width: 16, height: 16 }}>
          <Svg width={24} height={24} viewBox="0 0 24 24" style={{ margin: -4 }}>
            <Defs>
              <Filter
                id="pickupDotBlur"
                x="0"
                y="0"
                width="24"
                height="24"
                filterUnits="userSpaceOnUse"
              >
                <FeGaussianBlur stdDeviation={2} />
              </Filter>
            </Defs>
            <G filter="url(#pickupDotBlur)">
              <Circle cx={12} cy={12} r={8} fill="#FFFFFF" />
              <Circle
                cx={12}
                cy={12}
                r={6}
                stroke={mitowColors.success}
                strokeWidth={4}
                fill="none"
              />
            </G>
          </Svg>
        </View>
        <MiText variant="bodyL155" numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1 }}>
          {address ? (
            <>
              <MiText variant="bodyL155" style={{ fontWeight: '700' }}>
                {address.primary}
              </MiText>
              {address.secondary ? `, ${address.secondary}` : ''}
            </>
          ) : (
            placeholder
          )}
        </MiText>
      </View>
    </Pressable>
  );
}
