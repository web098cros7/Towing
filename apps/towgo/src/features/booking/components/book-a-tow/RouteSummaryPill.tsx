import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors, mitowLayout, mitowRadii, mitowShadows, MiText } from '@/design';
import { PIN_COLOR } from './RoutePin';

/**
 * Figma 14 Route summary `370:18920`: a 46-tall floating card (radius 16,
 * Elevation/Floating) holding the 8 × 28 route glyph, the pickup / drop column
 * and the "Edit" link. Row, items centred, padding 14 left / 16 right / 5
 * vertical, gap 10. No chevron, no other icon.
 */
export function RouteSummaryPill({
  pickup,
  drop,
  onEdit,
}: {
  pickup: string;
  drop: string;
  onEdit: () => void;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    // The shadow lives on the outer node; the text column does the clipping, so
    // `overflow: 'hidden'` never cuts the Floating shadow off.
    <View
      style={{
        flex: 1,
        height: mitowLayout.navBarHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 14,
        paddingRight: 16,
        paddingVertical: 5,
        borderRadius: mitowRadii.card,
        backgroundColor: mitowColors.surfacePage,
        ...mitowShadows.floating,
      }}
    >
      <RouteGlyph />

      {/* Single lines that CLIP at the column edge, as drawn: no ellipsis. */}
      <View style={{ flex: 1, height: 36, overflow: 'hidden' }}>
        <MiText variant="label13" color="secondary" numberOfLines={1} ellipsizeMode="clip">
          {pickup}
        </MiText>
        <MiText variant="strong14" numberOfLines={1} ellipsizeMode="clip">
          {drop}
        </MiText>
      </View>

      <Pressable
        onPress={onEdit}
        pressScale={theme.motion.pressScale.chip}
        haptic="light"
        hitSlop={{ top: 14, bottom: 14, left: 12, right: 16 }}
        accessibilityRole="button"
        accessibilityLabel="Edit locations"
      >
        <MiText variant="strong14" color="brand">
          Edit
        </MiText>
      </Pressable>
    </View>
  );
}

/**
 * Route glyph `370:18921`, 8 × 28: Pickup ring (8, 2 text/primary stroke, white
 * fill), Line (2 × 8 at 3, 10, border/subtle) and Drop (8 × 8 at 0, 20, radius 2,
 * text/primary), recoloured green / red like every pickup and drop pin (owner,
 * 25 Sep 2026).
 */
function RouteGlyph() {
  return (
    <View style={{ width: 8, height: 28 }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 8,
          height: 8,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: PIN_COLOR.pickup,
          backgroundColor: mitowColors.surfacePage,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 3,
          top: 10,
          width: 2,
          height: 8,
          backgroundColor: mitowColors.borderSubtle,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 20,
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: PIN_COLOR.drop,
        }}
      />
    </View>
  );
}
