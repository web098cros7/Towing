import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, {
  Marker,
  Overlay,
  Polyline,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
  type MapStyleElement,
  type Region,
} from 'react-native-maps';
import type { NearestPartner } from '@/features/home/types';
import type { LatLng } from '@/types/geo';
import {
  boundsAround,
  placeCamera,
  scaleOfRegion,
  type HomeMapRegion,
  type ScreenPoint,
} from './homeMapCamera';
import {
  etaLabel,
  PartnerTruckMarker,
  partnerMarkerAnchor,
  partnerMarkerCenterOffset,
  truckGlow,
  UserLocationMarker,
  userMarkerAnchor,
  userMarkerCenterOffset,
} from './HomeMapMarkers';

/**
 * Home's real map (product owner decision), drawn as Figma 07 draws its map
 * `287:2017`.
 *
 * WHY NOT `MapPreview`. The design's z-order is streets, truck glow, route,
 * truck. On both Google Maps and Apple Maps every marker draws above every
 * line, so a glow inside a marker covers the end of the route. Here the glow is
 * a ground overlay under the route line, which `MapPreview` cannot draw (and
 * `packages/ui` is not this screen's to change). The same control removes the
 * loading spinner and background the design does not draw, and applies 07's map
 * palette.
 *
 * Provider: Google on Android. iOS stays on Apple Maps: Google on iOS needs the
 * Google Maps pods and an iOS key (`app.config.ts`) in a dev build, and asking
 * for it without them fails at runtime.
 */

/** M1 land colour, shown until tiles draw. */
const MAP_LAND = '#F1F4F7';
/** M3 `map/route` #858E9E (no app token), width 4.2, round caps. */
const ROUTE_COLOR = '#858E9E';
const ROUTE_WIDTH = 4.2;

/**
 * Figma 07 "Streets (stylised)" palette `287:2018` as Google style JSON: land
 * #F1F4F7, green blocks #DAF2E2, water #D5EBFC, streets and main roads #FFFFFF
 * with no casing, minor streets #FAFBFC. The drawn map has no labels, points of
 * interest, transit or borders, so those are hidden. Google provider only.
 */
const HOME_MAP_STYLE: MapStyleElement[] = [
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { elementType: 'geometry', stylers: [{ color: MAP_LAND }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: MAP_LAND }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ visibility: 'on' }, { color: '#DAF2E2' }],
  },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D5EBFC' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#FAFBFC' }] },
];

/** How long a marker keeps re-snapshotting after mount or a content change (images, SVG, fonts). */
const MARKER_SETTLE_MS = 1500;
const CAMERA_MS = 350;
/** Span of the region shown before the first framing (about 2.5 km). */
const INITIAL_DELTA = 0.022;

export type HomeMapHandle = {
  /** Puts the customer and partner back where 07 frames them. */
  frame: (animated?: boolean) => void;
};

export type HomeMapProps = {
  /** Position the map box (absolute). */
  style?: StyleProp<ViewStyle>;
  /** Map view size in dp. */
  width: number;
  height: number;
  /** The strip along the bottom the sheet covers: the Google logo and the camera stay above it. */
  coveredBottom: number;
  customer: LatLng | undefined;
  partner: NearestPartner | undefined;
  /** Where 07 puts the customer's dot, in map-view dp. */
  customerAt: ScreenPoint;
  /** Where 07 puts the truck (the route's end), in map-view dp. */
  partnerAt: ScreenPoint;
  /** dp the truck may sit left of / below the dot when the partner is not up-right. */
  room: { west: number; south: number };
};

function useSettling(key: unknown): boolean {
  const [settling, setSettling] = useState(true);
  useEffect(() => {
    setSettling(true);
    const timer = setTimeout(() => setSettling(false), MARKER_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return settling;
}

const round = (value: number, digits: number) => value.toFixed(digits);

export const HomeMap = forwardRef<HomeMapHandle, HomeMapProps>(function HomeMap(
  { style, width, height, coveredBottom, customer, partner, customerAt, partnerAt, room },
  ref,
) {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const framed = useRef(false);

  // Before the first frame: centred on the customer at street level.
  const [initialRegion] = useState<HomeMapRegion | undefined>(() =>
    customer
      ? { ...customer, latitudeDelta: INITIAL_DELTA, longitudeDelta: INITIAL_DELTA }
      : undefined,
  );

  /** dp per radian of the camera, for sizing the glow overlay in dp. */
  const [scale, setScale] = useState<number | undefined>(undefined);

  // The latest geometry, read when framing (the point objects change every render).
  // Updated in an effect declared before the framing effect, so it runs first.
  const latest = useRef({
    width,
    height,
    coveredBottom,
    customer,
    partner,
    customerAt,
    partnerAt,
    room,
  });
  useEffect(() => {
    latest.current = {
      width,
      height,
      coveredBottom,
      customer,
      partner,
      customerAt,
      partnerAt,
      room,
    };
  });

  const frame = useCallback(
    (animated = true) => {
      const p = latest.current;
      if (!ready || !p.customer || p.width <= 0 || p.height <= 0) return;
      // Google applies `mapPadding` to camera moves; Apple Maps frames the whole view.
      const viewportHeight = Platform.OS === 'android' ? p.height - p.coveredBottom : p.height;
      const placed = placeCamera({
        customer: p.customer,
        partner: p.partner?.coordinate,
        viewport: { width: p.width, height: viewportHeight },
        customerAt: p.customerAt,
        partnerAt: p.partnerAt,
        room: p.room,
      });
      setScale(placed.scale);
      mapRef.current?.animateToRegion(placed.region, animated ? CAMERA_MS : 0);
      framed.current = true;
    },
    [ready],
  );

  useImperativeHandle(ref, () => ({ frame }), [frame]);

  // Frame when the map is ready, and again when the customer or partner moves
  // somewhere new or the layout changes (not on every 15 s poll of the same spot).
  const customerKey = customer
    ? `${round(customer.latitude, 5)},${round(customer.longitude, 5)}`
    : 'none';
  const partnerKey = partner
    ? `${round(partner.coordinate.latitude, 5)},${round(partner.coordinate.longitude, 5)}`
    : 'none';
  const layoutKey = [width, height, customerAt.x, customerAt.y, partnerAt.x, partnerAt.y]
    .map((n) => Math.round(n))
    .join(',');
  useEffect(() => {
    frame(framed.current);
  }, [frame, customerKey, partnerKey, layoutKey]);

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      if (width <= 0 || region.longitudeDelta <= 0) return;
      const next = scaleOfRegion(region, width);
      setScale((current) =>
        current !== undefined && Math.abs(next - current) / current < 0.01 ? current : next,
      );
    },
    [width],
  );

  /*
   * Always defined with the partner (the initial region's scale until the first
   * frame), so the glow mounts in the same commit as the route and before it:
   * Apple Maps stacks overlays in insertion order, so a glow added later would
   * cover the line.
   */
  const glowBounds = useMemo(() => {
    if (!partner) return undefined;
    const current = scale ?? scaleOfRegion({ longitudeDelta: INITIAL_DELTA }, Math.max(1, width));
    return boundsAround(partner.coordinate, truckGlow, current);
  }, [partner, scale, width]);

  const userSettling = useSettling(customerKey);
  // Re-snapshot when the ETA changes AND when the truck image lands late.
  const [truckLoads, setTruckLoads] = useState(0);
  const onTruckLoad = useCallback(() => setTruckLoads((n) => n + 1), []);
  const partnerSettling = useSettling(`${partner?.etaMinutes ?? ''}:${truckLoads}`);

  return (
    <View style={[{ width, height, backgroundColor: MAP_LAND, overflow: 'hidden' }, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        onMapReady={() => setReady(true)}
        onRegionChangeComplete={onRegionChangeComplete}
        customMapStyle={HOME_MAP_STYLE}
        mapPadding={{ top: 0, right: 0, bottom: coveredBottom, left: 0 }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        showsTraffic={false}
        showsBuildings={false}
        showsIndoors={false}
        showsIndoorLevelPicker={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        zoomControlEnabled={false}
        moveOnMarkerPress={false}
        rotateEnabled={false}
        pitchEnabled={false}
        loadingEnabled={false}
      >
        {/* M2 Truck glow, under the route (Overlay before Polyline; z 0 < 1 on Google). */}
        {partner && glowBounds ? (
          <Overlay image={truckGlow.image} bounds={glowBounds} style={{ zIndex: 0 }} />
        ) : null}

        {/* M3 Route: solid map/route line from the partner to the customer's dot. */}
        {partner && glowBounds ? (
          <Polyline
            coordinates={partner.route ?? [partner.coordinate, ...(customer ? [customer] : [])]}
            strokeColor={ROUTE_COLOR}
            strokeWidth={ROUTE_WIDTH}
            lineCap="round"
            lineJoin="round"
            zIndex={1}
          />
        ) : null}

        {/* M4 Truck + M9 "Towing partner" callout. */}
        {partner ? (
          <Marker
            coordinate={partner.coordinate}
            anchor={partnerMarkerAnchor}
            centerOffset={partnerMarkerCenterOffset}
            zIndex={2}
            tracksViewChanges={partnerSettling}
            tappable={false}
            accessibilityLabel={`Towing partner, ${etaLabel(partner.etaMinutes)}`}
          >
            <PartnerTruckMarker etaMinutes={partner.etaMinutes} onImageLoad={onTruckLoad} />
          </Marker>
        ) : null}

        {/* M5 halo, M6 dot, M7 pickup pin, M8 "Your location" chip. */}
        {customer ? (
          <Marker
            coordinate={customer}
            anchor={userMarkerAnchor}
            centerOffset={userMarkerCenterOffset}
            zIndex={1}
            tracksViewChanges={userSettling}
            tappable={false}
            accessibilityLabel="Your location"
          >
            <UserLocationMarker />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
});
