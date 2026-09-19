import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';
import { MiText } from './MiText';

export type MiServiceTileProps = {
  /** MiTow/Label 13, text/primary, centred. Keep the design's hard breaks as "\n" ("Battery\nJump Start"). */
  label: string;
  /** Colour icon centred in the 68 circle. */
  icon: MiColorIconName;
  /** Icon box. Master 56. Home 08: 56 for "Tow a Car", 50 for the other three. */
  iconSize?: number;
  /** Tile (and label) width. Master 80; Home 08 instances are 68. */
  width?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Service Tile (224:23): column, gap 4, items centred. A 68×68 surface/muted
 * circle (clips) holding a colour icon, then the label.
 */
export function MiServiceTile({
  label,
  icon,
  iconSize = 56,
  width = 80,
  onPress,
  accessibilityLabel,
  style,
}: MiServiceTileProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      pressScale={theme.motion.pressScale.chip}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label.replace(/\n/g, ' ')}
      style={[{ width, alignItems: 'center', gap: 4 }, style]}
    >
      <View
        style={{
          width: mitowLayout.serviceCircle,
          height: mitowLayout.serviceCircle,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <MiColorIcon name={icon} size={iconSize} />
      </View>
      <MiText variant="label13" align="center" style={{ width }}>
        {label}
      </MiText>
    </Pressable>
  );
}
