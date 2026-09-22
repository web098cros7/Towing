import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import {
  MiColorIcon,
  MiText,
  mitowColors,
  mitowRadii,
  type MiColorIconName,
} from '@/design';

/** Quick Action Tile 253:1170 border: 1.2 border/subtle, stroke INSIDE (no layout space). */
const TILE_BORDER = 1.2;

/** The icon slot: a colour icon by name, drawn 42 × 42. */
const TILE_ICON = 42;

/** Every tile on 26 is 143 tall (two FIXED at 143, the Ambulance tile hugs to 143); used as minHeight. */
export const QUICK_ACTION_TILE_HEIGHT = 143;

export type QuickActionTileProps = {
  /** Icon#253:2 swapped to a colour icon, drawn 42 × 42. */
  icon: MiColorIconName;
  /** Title#253:0: MiTow/Strong 15.5, text/primary, centred, WRAPS. */
  title: string;
  /** Subtitle#253:1: MiTow/Body S 14, text/secondary, centred, WRAPS. */
  subtitle: string;
  /** The whole tile is the tap target. */
  onPress: () => void;
  /** e.g. "Call 112, Emergency Helpline". */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Quick Action Tile `253:1170` (Figma 26 only): column, content top-aligned and centred
 * horizontally, padding 16 top / 8 right / 14 bottom / 8 left, gap 10; surface/page, radius 14,
 * MiTow/Elevation/Card, 1.2 border/subtle INSIDE drawn as an overlay (no layout space, as in
 * MiSupportCard). Icon 42; text column (Text `253:1173`) fills the inner width, gap 2, clips;
 * title Strong 15.5 over subtitle Body S 14 secondary, both centred and wrapping. No chevron. The
 * whole tile is the tap target (card press scale, light haptic). Not in the foundation: no other
 * screen uses the component.
 */
export function QuickActionTile({
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
  style,
}: QuickActionTileProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          flex: 1,
          minHeight: QUICK_ACTION_TILE_HEIGHT,
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 10,
          paddingTop: 16,
          paddingRight: 8,
          paddingBottom: 14,
          paddingLeft: 8,
          backgroundColor: mitowColors.surfacePage,
          borderRadius: mitowRadii.cardSm,
          boxShadow: '0px 1px 1px 0px rgba(16, 24, 40, 0.04)',
        },
        style,
      ]}
    >
      <MiColorIcon name={icon} size={TILE_ICON} />
      {/* Text 253:1173: fills the inner width (94.33 in a 110.33 tile), gap 2, clips. Title and
          subtitle wrap, as drawn ("Emergency / Helpline", "Call / Ambulance"). */}
      <View style={{ alignSelf: 'stretch', gap: 2, overflow: 'hidden' }}>
        <MiText variant="strong155" align="center">
          {title}
        </MiText>
        <MiText variant="bodyS14" color="secondary" align="center">
          {subtitle}
        </MiText>
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: mitowRadii.cardSm,
          borderWidth: TILE_BORDER,
          borderColor: mitowColors.borderSubtle,
        }}
      />
    </Pressable>
  );
}
