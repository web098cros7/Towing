import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { MapPreview, Text, type MapMarker, type MapPolyline } from '@towing/ui';
import { decodePolyline, type BookingTracking } from '@towing/api-contracts';
import { useAnimatedPosition } from '../hooks/useAnimatedPosition';

/**
 * §11.4's live map, and the replacement for what was there before.
 *
 * WHAT THIS DELETES. `TrackingMapCard` drew the route as a hardcoded SVG path
 * (`d="M 84 27 L 62 40 Q 56 43 52 50 …"`) with the driver at `left: '84%'` and
 * the pickup at `left: '17%'`, over a decorative map. It was the same picture for
 * every trip, every driver and every city — a drawing of a tow rather than a tow.
 *
 * WHAT REPLACES IT: real coordinates, a real Directions polyline where one
 * exists, an interpolated bearing-rotated marker, §11.4's auto-fit camera with
 * the pan-pause and re-center chip, and §11.6's ghost state when the fixes stop.
 */

export interface TrackingMapProps {
  tracking: BookingTracking | undefined;
  /** §11.6 — `stale` and `offline` both dim the marker. */
  presence: 'live' | 'stale' | 'offline';
  /** Space at the bottom the sheet occupies, so the fit does not put the truck under it. */
  bottomInset: number;
}

export function TrackingMap({ tracking, presence, bottomInset }: TrackingMapProps) {
  const theme = useTheme();

  /**
   * §11.4's "user pan pauses auto-follow, a re-center chip restores it".
   *
   * THE STATE LIVES HERE, NOT IN `MapPreview`, because the chip does: it has to
   * sit clear of a bottom sheet whose height the map component knows nothing
   * about. `MapPreview` owns the camera; this owns the decision.
   */
  const [following, setFollowing] = useState(true);

  const animated = useAnimatedPosition(tracking?.position ?? null);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];

    if (animated) {
      out.push({
        key: 'driver',
        coordinate: { latitude: animated.lat, longitude: animated.lng },
        tone: 'driver',
        // Only when the fix actually carried one — 0 is due north, not "unknown".
        bearingDeg: tracking?.position?.headingDeg === null ? undefined : animated.heading,
        // §11.6: dimmed once the fixes are older than the threshold. The
        // customer is looking at where the driver WAS.
        ghost: presence !== 'live',
        // §11.3: a halo instead of a confidently wrong dot.
        accuracyMeters: tracking?.position?.lowAccuracy ? 60 : undefined,
      });
    }

    if (tracking) {
      out.push({
        key: 'pickup',
        coordinate: { latitude: tracking.pickup.lat, longitude: tracking.pickup.lng },
        tone: 'pickup',
      });
      if (tracking.drop) {
        out.push({
          key: 'drop',
          coordinate: { latitude: tracking.drop.lat, longitude: tracking.drop.lng },
          tone: 'drop',
        });
      }
    }

    return out;
  }, [animated, presence, tracking]);

  const polylines = useMemo<MapPolyline[]>(() => {
    if (!tracking) return [];

    /**
     * THE ACTIVE LEG ONLY. Before the OTP the customer cares where the driver is
     * relative to THEM; after it, where the vehicle is going. Drawing both at
     * once turns a tow across a city into two lines meeting at a point nobody is
     * looking at.
     */
    const encoded =
      tracking.status === 'in_progress' ? tracking.routeDropPolyline : tracking.routePolyline;
    if (!encoded) return [];

    const coordinates = decodePolyline(encoded).map((point) => ({
      latitude: point.lat,
      longitude: point.lng,
    }));
    if (coordinates.length < 2) return [];

    return [
      {
        key: 'route',
        coordinates,
        // A Haversine route IS a straight line, and drawing it solid would claim
        // a road that is not there. Dashed and honest — the same call the Phase 5
        // fleet map makes for its un-routed job legs.
        tone: tracking.etaSource === 'google_directions' ? 'route' : 'direct',
      },
    ];
  }, [tracking]);

  const onUserPan = useCallback(() => setFollowing(false), []);
  const onRecenter = useCallback(() => setFollowing(true), []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapPreview
        style={StyleSheet.absoluteFill}
        markers={markers}
        polylines={polylines}
        fitToMarkers
        followMode={following ? 'fit' : 'paused'}
        onUserPan={onUserPan}
        fitPadding={{ top: 96, right: 56, bottom: bottomInset + 32, left: 56 }}
        // The chip below replaces it — `MapPreview`'s own sits bottom-right,
        // where the sheet is.
        showRecenter={false}
        label="Live tracking"
      />

      {/*
        §11.4's re-center chip. Rendered only while following is PAUSED, because
        a chip that is always visible is a button that usually does nothing —
        and its appearing is the affordance that tells the customer the map has
        stopped following on purpose rather than broken.
      */}
      {!following ? (
        <View style={[styles.chipWrap, { bottom: bottomInset + 16 }]}>
          <Pressable
            onPress={onRecenter}
            accessibilityRole="button"
            // Maestro matches on labels, not testIDs — every new control needs a
            // stable, unique one to be reachable from a flow.
            accessibilityLabel="Re-center on your driver"
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.radii.pill,
              paddingHorizontal: 14,
              paddingVertical: 8,
              ...theme.shadows.fab,
            }}
          >
            <Text
              weight="medium"
              style={{ fontSize: 13, lineHeight: 18, color: theme.colors.brand }}
            >
              Re-center
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
