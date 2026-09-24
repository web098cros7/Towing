import React, { useCallback, useRef, useState } from 'react';
import { Platform, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import {
  MapPreview,
  isNativeMapAvailable,
  type MapPreviewController,
  type MapRegion,
} from '@towing/ui';
import {
  mitowColors,
  mitowLayout,
  mitowType,
  MiButton,
  MiLineIcon,
  MiMapButton,
  MiMapCallout,
  MiSheetPanel,
  MiText,
} from '@/design';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import { useLocationStore } from '@/features/location/locationStore';
import type { RootStackParamList } from '@/navigation/types';
import type { LatLng } from '@/types/geo';
import { readDeviceFix } from './pick-on-map/deviceFix';
import { usePickOnMapPlace } from './pick-on-map/usePickOnMapPlace';
import { fullPlaceText } from '@/utils/address';

/** Figma 13 geometry (393 x 852 frame). */
const CARD_PAD_TOP = 20;
/** The map runs 31 under the card's top edge (map 660, card top 629). */
const MAP_UNDER_CARD = 31;
/** Map centre (330) to the centre pin frame's top (291). */
const PIN_ABOVE_CENTRE = 39;
const PIN_SIZE = 44;
/** Callout instance width 110 = text box 94 + padding 8 each side. */
const CALLOUT_TEXT_BOX = 94;
const CALLOUT_PADDING = 8;
const CALLOUT_TO_PIN = 4;
/** Pin frame x 175 and callout x 142 both centre on x 197, half a dp right of mid. */
const PIN_OFFSET_FROM_MID = 0.5;
/** Back left 16; Locate me right 16 and 16 above the card. */
const FLOAT_INSET = 16;
const ADDRESS_ICON = 26;
const ADDRESS_ICON_GAP = 12;
const ADDRESS_TEXT_GAP = 3;
/** The address is drawn on two lines, and the card is 223 tall with them. */
const ADDRESS_LINES = 2;
/** ~500 m across: the pin lands on a building, not a neighbourhood. */
const MAP_ZOOM_DELTA = 0.0045;
/** ~2 m. The first settle reports the opening camera back with float noise. */
const SAME_POINT_DEGREES = 2e-5;
/** MiText's `maxFontSizeMultiplier`. */
const MAX_FONT_SCALE = 1.2;

const roundHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * How much larger than its token MiText renders a style on this device: the
 * theme's width ratio (half-px rounded, as MiText rounds) times the OS font
 * scale up to MiText's cap. 1 on the 393 design frame at default font size.
 */
function renderedTypeScale(tokenSize: number, ratio: number, fontScale: number): number {
  const size = ratio === 1 ? tokenSize : roundHalf(tokenSize * ratio);
  return (size / tokenSize) * Math.min(fontScale, MAX_FONT_SCALE);
}

function samePoint(a: LatLng, b: LatLng): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < SAME_POINT_DEGREES &&
    Math.abs(a.longitude - b.longitude) < SAME_POINT_DEGREES
  );
}

/**
 * Figma 13 · Pick on Map (`289:2080`).
 *
 * The pin is fixed; the customer pans the map beneath it. The camera centre on
 * settle is the picked point, reverse-geocoded into the bottom card.
 */
export function MapPickerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'MapPicker'>>();
  const field = params?.field ?? 'pickup';
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const theme = useTheme();

  const setPickupAddress = useBookingStore((s) => s.setPickupAddress);
  const setDropAddress = useBookingStore((s) => s.setDropAddress);
  const setPickupCoords = useBookingStore((s) => s.setPickupCoords);
  const setDropCoords = useBookingStore((s) => s.setDropCoords);
  const storePickup = useBookingStore((s) => s.pickupCoords);
  const storeDrop = useBookingStore((s) => s.dropCoords);
  const storeLabel = useBookingStore((s) => (field === 'pickup' ? s.pickupAddress : s.dropAddress));
  const deviceLocation = useLocationStore((s) => s.pickup.coords);

  const fieldPoint = field === 'pickup' ? storePickup : storeDrop;

  // Opens on the point being edited, then the device, then the pickup.
  const [opening] = useState(() => {
    const point = fieldPoint ?? deviceLocation ?? storePickup;
    return {
      point: { latitude: point.latitude, longitude: point.longitude },
      // The stored label names the opening point only when it IS this field's point.
      label: fieldPoint ? storeLabel : '',
    };
  });
  const [initialRegion] = useState<MapRegion>(() => ({
    ...opening.point,
    latitudeDelta: MAP_ZOOM_DELTA,
    longitudeDelta: MAP_ZOOM_DELTA,
  }));

  const map = useRef<MapPreviewController>(null);
  const [centre, setCentre] = useState<LatLng>(opening.point);

  const card = usePickOnMapPlace(centre);
  // Until the first lookup answers, the opening point keeps the label it was
  // stored with. The title line is always drawn, so it never collapses.
  const title = card.title ?? (samePoint(centre, opening.point) ? opening.label : '');
  const address = card.address ?? '';

  const onRegionChangeComplete = useCallback((region: MapRegion) => {
    setCentre({ latitude: region.latitude, longitude: region.longitude });
  }, []);

  const onLocate = useCallback(async () => {
    const fix = await readDeviceFix();
    if (fix) map.current?.animateToCoordinate(fix);
  }, []);

  const onConfirm = useCallback(() => {
    // The coordinate always exists; with no title yet (lookup in flight or
    // failed) a formatted coordinate keeps the field honest.
    // The full address, as every picked place is stored (owner, 24 Sep 2026).
    const label = title
      ? fullPlaceText(title, address)
      : `${centre.latitude.toFixed(5)}, ${centre.longitude.toFixed(5)}`;

    if (field === 'pickup') {
      setPickupAddress(label);
      setPickupCoords(centre);
    } else {
      setDropAddress(label);
      setDropCoords(centre);
    }
    navigation.goBack();
  }, [
    title,
    address,
    centre,
    field,
    setPickupAddress,
    setDropAddress,
    setPickupCoords,
    setDropCoords,
    navigation,
  ]);

  // The map, pin, callout and Locate me are placed from the measured screen and
  // card, and drawn only once both are known, so nothing moves after it appears.
  const [screenHeight, setScreenHeight] = useState<number | null>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    setScreenHeight(e.nativeEvent.layout.height);
  }, []);
  const onCardLayout = useCallback((e: LayoutChangeEvent) => {
    setCardHeight(e.nativeEvent.layout.height);
  }, []);
  const measured = screenHeight !== null && cardHeight !== null;

  const mapHeight = measured ? screenHeight - cardHeight + MAP_UNDER_CARD : 0;
  const pinTop = mapHeight / 2 - PIN_ABOVE_CENTRE;
  // Anchored by its bottom edge so the 4 gap to the pin holds at any text height.
  const calloutBottom = (screenHeight ?? 0) - (pinTop - CALLOUT_TO_PIN);

  // 49 from the top as drawn; only a taller Android status bar pushes it down.
  const backTop =
    Platform.OS === 'android'
      ? Math.max(mitowLayout.contentTop, insets.top)
      : mitowLayout.contentTop;

  // The design wraps the unbroken string inside a 94 text box as "Move the map"
  // / "to set the point". MiText scales the type per device while the box is
  // fixed, which would wrap it into three lines on a 412 phone, so the text box
  // scales with the rendered type and keeps those two lines. 110 on the frame.
  const calloutScale = renderedTypeScale(mitowType.bodyXS135.fontSize, theme.scaleRatio, fontScale);
  const calloutWidth =
    (calloutScale === 1 ? CALLOUT_TEXT_BOX : roundHalf(CALLOUT_TEXT_BOX * calloutScale)) +
    CALLOUT_PADDING * 2;

  // Two address lines reserved, so the card keeps its drawn height before the
  // first lookup lands and for a one-line address.
  const addressLineHeight =
    (theme.scaleRatio === 1
      ? mitowType.bodyS14.lineHeight
      : roundHalf(mitowType.bodyS14.lineHeight * theme.scaleRatio)) *
    Math.min(fontScale, MAX_FONT_SCALE);

  return (
    <View style={{ flex: 1, backgroundColor: mitowColors.surfacePage }} onLayout={onRootLayout}>
      {/* Edge-to-edge: the bar is transparent over the map; its content is dark. */}
      <StatusBar style="dark" />

      {measured && isNativeMapAvailable() ? (
        <MapPreview
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: mapHeight }}
          initialRegion={initialRegion}
          onRegionChangeComplete={onRegionChangeComplete}
          controllerRef={map}
          // Lifts the provider logo above the card. Equal top and bottom keep the
          // camera centre at the map's vertical centre, where the pin tip is.
          mapPadding={{ top: MAP_UNDER_CARD, bottom: MAP_UNDER_CARD }}
          showRecenter={false}
          showUserLocation={false}
          userLocationLabel=""
        />
      ) : null}

      <MiMapButton
        icon="chevron-left"
        size={46}
        accessibilityLabel="Go back"
        onPress={() => navigation.goBack()}
        style={{ position: 'absolute', left: FLOAT_INSET, top: backTop }}
      />

      <View onLayout={onCardLayout} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <MiSheetPanel showHandle={false} paddingTop={CARD_PAD_TOP}>
          <MiText variant="overline12" color="secondary" numberOfLines={1}>
            PICKUP LOCATION
          </MiText>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: ADDRESS_ICON_GAP }}>
            <MiLineIcon name="map-pin" size={ADDRESS_ICON} />
            <View style={{ flex: 1, gap: ADDRESS_TEXT_GAP }}>
              <MiText variant="title20">{title || ' '}</MiText>
              <MiText
                variant="bodyS14"
                color="secondary"
                style={{ minHeight: addressLineHeight * ADDRESS_LINES }}
              >
                {address}
              </MiText>
            </View>
          </View>

          <MiButton label="Confirm pickup" onPress={onConfirm} />
        </MiSheetPanel>
      </View>

      {measured ? (
        <>
          <MiMapButton
            icon="locate"
            size={50}
            accessibilityLabel="Locate me"
            onPress={() => void onLocate()}
            style={{ position: 'absolute', right: FLOAT_INSET, bottom: cardHeight + FLOAT_INSET }}
          />

          {/* Fixed centre pin: its tip marks the camera centre. Never blocks map gestures. */}
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: pinTop, left: 0, right: 0, alignItems: 'center' }}
          >
            <MiLineIcon
              name="map-pin"
              size={PIN_SIZE}
              style={{ transform: [{ translateX: PIN_OFFSET_FROM_MID }] }}
            />
          </View>

          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: calloutBottom,
              left: 0,
              right: 0,
              alignItems: 'center',
            }}
          >
            <MiMapCallout
              text="Move the map to set the point"
              tail="bottom"
              width={calloutWidth}
              style={{ transform: [{ translateX: PIN_OFFSET_FROM_MID }] }}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}
