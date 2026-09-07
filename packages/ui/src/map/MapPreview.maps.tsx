import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';
import { useTheme } from '@towing/theme';
import { Text } from '../Text';
import type { MapMarker, MapPreviewProps, MapRegion } from './types';

/**
 * The real map (Phase 16), behind the `MapPreviewProps` seam the placeholder
 * has always implemented.
 *
 * WHICH PROVIDER, AND WHY IT MATTERS HERE MORE THAN USUAL. On iOS this uses
 * `PROVIDER_DEFAULT` — Apple Maps — which needs no key and no billing account,
 * so the customer map is fully real on iOS today. On Android there is no
 * keyless option: Google Maps is the only provider and a missing key renders a
 * blank grey grid with the Google watermark. That asymmetry is exactly why
 * `MapPreview.tsx` gates on the key rather than rendering this unconditionally.
 *
 * NEVER OBSERVED ON A DEVICE. `react-native-maps` is a native module and no dev
 * client has ever been built for either app, so this file is typechecked,
 * bundle-clean and prebuild-clean — and has not been seen to draw a single tile.
 * Same honest standing as Phase 13's push adapters.
 */

/** One frame's worth of camera, when nothing else says where to look. */
const FALLBACK_REGION: MapRegion = {
  latitude: 12.9716,
  longitude: 77.5946,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export function MapPreviewMaps({
  height,
  showRecenter = true,
  onRecenter,
  recenterDisabled = false,
  recenterIcon: RecenterIcon,
  showUserLocation = false,
  userLocationLabel = 'You are here',
  style,
  initialRegion,
  region,
  markers,
  polylines,
  fitToMarkers = false,
  followMode,
  onUserPan,
  fitPadding,
  onRegionChange,
  onRegionChangeComplete,
  interactive = true,
}: MapPreviewProps) {
  const theme = useTheme();
  const mapRef = useRef<MapView | null>(null);
  const [ready, setReady] = useState(false);
  const hasFitted = useRef(false);
  /**
   * True while OUR OWN camera animation is in flight (Phase 18).
   *
   * This is what makes pan-pause work at all. `onRegionChange` fires for
   * programmatic moves exactly as it does for gestures, so a naive
   * "onRegionChange → pause following" wires the auto-fit to cancel itself on
   * its very first frame and the camera never follows anything. The Google
   * provider passes `isGesture` and that is preferred where present; this ref is
   * the fallback for Apple Maps, which does not.
   */
  const animating = useRef(false);

  /**
   * Controlled camera moves are ANIMATED rather than passed as `region`.
   *
   * `react-native-maps` treats a `region` prop as fully controlled: every render
   * snaps the camera back, so a user mid-pan is yanked to the last prop value
   * and the map feels broken. Animating from an imperative effect leaves the
   * gesture in charge, which is what a map has to do.
   */
  useEffect(() => {
    if (!region || !ready) return;
    mapRef.current?.animateToRegion(region, 350);
  }, [region, ready]);

  /**
   * ONE-SHOT BY DEFAULT; CONTINUOUS WHEN THE HOST ASKS (Phase 18).
   *
   * Phase 16 shipped the one-shot half and said why: nearby drivers refresh
   * every few seconds, and re-fitting on each batch re-frames the camera under
   * the customer's finger. That is still exactly right for the four callers that
   * pass only `fitToMarkers`, and `hasFitted` still governs them.
   *
   * §11.4 asks for more on the tracking screen — "auto-fits driver + pickup with
   * padding" as the driver moves — and that is safe there only because it comes
   * with the other half of the sentence: "user pan pauses auto-follow". So
   * continuous fitting is opt-in via `followMode`, and the moment the host sets
   * it to `'paused'` this stops touching the camera entirely.
   *
   * The polyline is included in the fit. A route that leaves the frame is the
   * common case on a long tow, and framing two markers while the line between
   * them runs off-screen looks like a rendering bug.
   */
  useEffect(() => {
    if (!fitToMarkers || !ready) return;
    if (followMode === 'paused') return;
    if (!followMode && hasFitted.current) return;

    const coordinates = [
      ...(markers ?? []).map((marker) => marker.coordinate),
      ...(polylines ?? []).flatMap((line) => line.coordinates),
    ];
    if (coordinates.length === 0) return;

    hasFitted.current = true;
    animating.current = true;
    mapRef.current?.fitToCoordinates(coordinates, {
      edgePadding: {
        top: fitPadding?.top ?? 64,
        right: fitPadding?.right ?? 64,
        bottom: fitPadding?.bottom ?? 64,
        left: fitPadding?.left ?? 64,
      },
      animated: true,
    });
    // Cleared a beat after the animation would have settled. `fitToCoordinates`
    // has no completion callback, so this is a timer rather than a promise —
    // deliberately longer than the animation so a late `onRegionChange` from our
    // own move is not mistaken for a gesture.
    const timer = setTimeout(() => {
      animating.current = false;
    }, 700);
    return () => clearTimeout(timer);
  }, [fitToMarkers, followMode, fitPadding, markers, polylines, ready]);

  const onMapReady = useCallback(() => setReady(true), []);

  /**
   * §11.4's pan-pause trigger.
   *
   * `isGesture` comes from the Google provider and is the honest signal. Apple
   * Maps omits it, so the `animating` ref stands in: anything that moves the
   * camera while we are not animating it ourselves was the user.
   */
  const handleRegionChange = useCallback(
    (_next: MapRegion, details?: { isGesture?: boolean }) => {
      onRegionChange?.();
      if (!onUserPan) return;
      const gesture = details?.isGesture ?? !animating.current;
      if (gesture) onUserPan();
    },
    [onRegionChange, onUserPan],
  );

  const handleRegionChangeComplete = useCallback(
    (next: MapRegion) => onRegionChangeComplete?.(next),
    [onRegionChangeComplete],
  );

  return (
    <View
      style={[
        {
          height: height ?? undefined,
          backgroundColor: theme.colors.mapBg,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        // Apple Maps on iOS (keyless); Google is the only Android option.
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        initialRegion={initialRegion ?? region ?? FALLBACK_REGION}
        onMapReady={onMapReady}
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation={showUserLocation}
        showsMyLocationButton={false}
        // Ours is drawn by the consumer, positioned against the sheet.
        showsCompass={false}
        toolbarEnabled={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        // Renders inside a Card with `overflow: hidden` on several screens;
        // without this Android draws the map over the rounded corners.
        loadingEnabled
        loadingBackgroundColor={theme.colors.mapBg}
      >
        {/*
          Lines BEFORE markers: `react-native-maps` draws children in order, so
          a polyline declared after a pin is drawn over it and the route appears
          to run through the middle of the truck glyph.
        */}
        {(polylines ?? []).map((line) => (
          <Polyline
            key={line.key}
            coordinates={line.coordinates}
            strokeWidth={line.tone === 'route' ? 5 : 3}
            strokeColor={line.tone === 'route' ? theme.colors.brand : theme.colors.textTertiary}
            // §11.4's honesty rule, and the Phase 5 fleet map's: a straight
            // fallback leg is DASHED so it cannot be read as a driven route.
            lineDashPattern={line.tone === 'direct' ? [6, 6] : undefined}
            lineCap="round"
            lineJoin="round"
            geodesic
          />
        ))}
        {(markers ?? []).map((marker) => (
          <MarkerPin key={marker.key} marker={marker} />
        ))}
      </MapView>

      {showUserLocation && userLocationLabel ? (
        <View pointerEvents="none" style={styles.labelWrap}>
          <View
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.radii.pill,
              paddingHorizontal: 12,
              paddingVertical: 6,
              ...theme.shadows.fab,
            }}
          >
            <Text weight="medium" style={{ fontSize: 12, lineHeight: 16, color: theme.colors.info }}>
              {userLocationLabel}
            </Text>
          </View>
        </View>
      ) : null}

      {showRecenter ? (
        <Pressable
          onPress={onRecenter}
          disabled={recenterDisabled}
          accessibilityRole="button"
          accessibilityLabel="Re-center map"
          accessibilityState={{ disabled: recenterDisabled }}
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: theme.colors.fabBg,
            alignItems: 'center',
            justifyContent: 'center',
            // No alpha: this node carries elevation, and on Android the shadow
            // is drawn outside the view's own alpha, so fading it makes the
            // shadow show through. Dim the glyph instead.
            ...theme.shadows.fab,
          }}
        >
          {RecenterIcon ? (
            <RecenterIcon
              size={18}
              color={recenterDisabled ? theme.colors.textTertiary : theme.colors.textSecondary}
            />
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A pin plus, when the position is uncertain, a halo sized to that uncertainty.
 *
 * The halo is not decoration. A §11.9 nearby-driver marker is snapped onto a
 * ~100 m grid and a §11.3 low-accuracy fix can be worse; drawing either as a
 * precise dot claims a precision the data does not have, and a customer who
 * walks to the dot finds nobody there.
 */
function MarkerPin({ marker }: { marker: MapMarker }) {
  const theme = useTheme();
  // A bearing of exactly 0 is a real heading (due north), so the test is for
  // presence, not truthiness — the caller omits the field when it is unknown.
  const hasBearing = marker.bearingDeg !== undefined && marker.bearingDeg !== null;

  const fill = {
    driver: theme.colors.brand,
    pickup: theme.colors.success,
    drop: theme.colors.error,
    user: theme.colors.info,
  }[marker.tone];

  return (
    <>
      {marker.accuracyMeters ? (
        <Circle
          center={marker.coordinate}
          radius={marker.accuracyMeters}
          strokeColor="transparent"
          fillColor={theme.colors.infoSoftBg}
        />
      ) : null}
      <Marker
        coordinate={marker.coordinate}
        // `tracksViewChanges` defaults to true, which re-rasterises every custom
        // marker on every render. With a screenful of drivers refreshing every
        // few seconds that is the single biggest frame-rate cost in the library.
        //
        // IT STAYS FALSE FOR THE BEARING MARKER TOO (Phase 18), and that is not
        // an oversight. `rotation` is applied by the native view rather than by
        // re-rendering the React child, so a rotating marker needs no
        // re-rasterisation — turning tracking back on for it would pay the whole
        // cost for nothing.
        tracksViewChanges={false}
        anchor={{ x: 0.5, y: 0.5 }}
        // §11.4's bearing. `flat` makes the glyph rotate WITH the map instead of
        // staying screen-upright, which is the difference between a truck facing
        // along the road and a truck facing the top of the phone.
        rotation={hasBearing ? marker.bearingDeg : undefined}
        flat={hasBearing}
        // §11.6's ghost. A dimmed marker says "this is where they were", which is
        // the honest claim when a fix is more than fifteen seconds old.
        opacity={marker.ghost ? 0.45 : 1}
      >
        {hasBearing ? (
          /*
           * A chevron rather than a dot, because a dot cannot show a bearing.
           * Built from two rotated bars rather than an SVG or an image asset:
           * `packages/ui` carries no icon files, and a marker child that pulls in
           * a rasteriser is the thing `tracksViewChanges={false}` exists to avoid.
           */
          <View style={styles.bearingWrap}>
            <View
              style={{
                width: 0,
                height: 0,
                borderLeftWidth: 8,
                borderRightWidth: 8,
                borderBottomWidth: 16,
                borderLeftColor: 'transparent',
                borderRightColor: 'transparent',
                borderBottomColor: fill,
              }}
            />
          </View>
        ) : (
          <View
            style={{
              width: marker.tone === 'driver' ? 18 : 16,
              height: marker.tone === 'driver' ? 18 : 16,
              borderRadius: 9,
              backgroundColor: fill,
              borderWidth: 3,
              borderColor: theme.colors.card,
            }}
          />
        )}
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  bearingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
  },
  labelWrap: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
