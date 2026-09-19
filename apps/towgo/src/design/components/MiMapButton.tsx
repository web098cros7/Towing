import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive, type IconComponent } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon, type MiLineIconName } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';

export type MiMapButtonProps = {
  /** Line icon by Figma name ('chevron-left' Back, 'locate' Locate me, 'navigation' Recenter, 'phone', 'message'). A legacy icon component is still accepted. */
  icon?: MiLineIconName | IconComponent;
  /** A colour icon instead of a line icon (screen 10's Swap circle: 'swap' at 24). */
  colorIcon?: MiColorIconName;
  onPress?: () => void;
  /** Required: the control is a bare glyph. */
  accessibilityLabel: string;
  /**
   * Circle diameter. 'floating' default 50 (Map Control 223:24). Screens: Back 46,
   * Locate/Recenter 50, Home Recenter 55, screen 10 Locate/Swap 40.
   * 'outline' default 55 (Icon Button (Outline) 226:313).
   */
  size?: number;
  /** Icon box. Default 24 ('floating') / 26 ('outline'). */
  iconSize?: number;
  /**
   * - 'floating' Map Control 223:24: white circle, MiTow/Elevation/Floating, no border.
   * - 'outline'  Icon Button (Outline) 226:313: white circle, 1.2 border/subtle, no shadow (18's Call / Message).
   */
  variant?: 'floating' | 'outline';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** A white circular icon control — Map Control and Icon Button (Outline). */
export function MiMapButton({
  icon,
  colorIcon,
  onPress,
  accessibilityLabel,
  variant = 'floating',
  size,
  iconSize,
  disabled = false,
  style,
}: MiMapButtonProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const diameter = size ?? (variant === 'outline' ? 55 : 50);
  const glyph = iconSize ?? (variant === 'outline' ? 26 : 24);

  let content: React.ReactNode = null;
  if (colorIcon) {
    content = <MiColorIcon name={colorIcon} size={glyph} />;
  } else if (typeof icon === 'string') {
    content = <MiLineIcon name={icon} size={glyph} />;
  } else if (icon) {
    const Legacy = icon;
    content = (
      <View style={{ width: glyph, height: glyph, alignItems: 'center', justifyContent: 'center' }}>
        <Legacy size={glyph} color={mitowColors.textPrimary} strokeWidth={2} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      pressScale={theme.motion.pressScale.chip}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={[
        {
          width: diameter,
          height: diameter,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.surfacePage,
          alignItems: 'center',
          justifyContent: 'center',
          ...(variant === 'outline'
            ? { borderWidth: 1.2, borderColor: mitowColors.borderSubtle }
            : mitowShadows.floating),
        },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}
