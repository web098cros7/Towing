import React, { useImperativeHandle } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Text } from '../Text';
import type { MapPreviewProps } from './types';

/**
 * Styled stand-in for the live map while Google Maps keys are pending. Same
 * props as the future react-native-maps implementation, so swapping it in
 * (MapPreview.maps) touches nothing that consumes <MapPreview />.
 */
export function MapPreviewPlaceholder({
  height,
  showRecenter = true,
  onRecenter,
  recenterDisabled = false,
  recenterIcon: RecenterIcon,
  showUserLocation = false,
  userLocationLabel = 'You are here',
  userMarkerTop,
  label = 'MAP',
  controllerRef,
  style,
}: MapPreviewProps) {
  const theme = useTheme();

  // No camera here: every controller call is a no-op, so the screen-drawn map
  // buttons behave identically (and harmlessly) on this path. `overlays`,
  // `mapPadding`, `customMapStyle` and `onMapReady` are ignored: there are no
  // coordinates to anchor anything to.
  useImperativeHandle(
    controllerRef,
    () => ({
      animateToRegion: () => {},
      animateToCoordinate: () => {},
      fitToCoordinates: () => {},
      fitToContent: () => {},
    }),
    [],
  );

  const markerPositionStyle =
    userMarkerTop === undefined
      ? { alignItems: 'center' as const }
      : ({
          position: 'absolute',
          left: 0,
          right: 0,
          top: userMarkerTop,
          alignItems: 'center',
        } as const);

  return (
    <View
      style={[
        {
          // No height → parent/style controls sizing (e.g. absolute fill).
          height: height ?? undefined,
          backgroundColor: theme.colors.mapBg,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {/* Faint grid to imply a map surface */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '33%',
          width: 1,
          backgroundColor: theme.colors.border,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '66%',
          width: 1,
          backgroundColor: theme.colors.border,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 1,
          backgroundColor: theme.colors.border,
        }}
      />

      {showUserLocation ? (
        <View pointerEvents="none" style={markerPositionStyle}>
          {/* Label pill */}
          <View
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.radii.pill,
              paddingHorizontal: 12,
              paddingVertical: 6,
              marginBottom: 10,
              ...theme.shadows.fab,
            }}
          >
            <Text
              weight="medium"
              style={{ fontSize: 12, lineHeight: 16, color: theme.colors.info }}
            >
              {userLocationLabel}
            </Text>
          </View>
          {/* Accuracy ring + dot */}
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: theme.colors.infoSoftBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                backgroundColor: theme.colors.info,
                borderWidth: 3,
                borderColor: theme.colors.card,
              }}
            />
          </View>
        </View>
      ) : (
        <Text
          variant="display"
          weight="bold"
          color="tertiary"
          style={{ fontSize: 45, letterSpacing: 4, opacity: 0.32 }}
        >
          {label}
        </Text>
      )}

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
            // No alpha here: this node carries elevation, and on Android the
            // elevation shadow is drawn outside the view's own alpha, so fading
            // it makes the shadow show through. Dim the glyph instead.
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
