import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive, type IconComponent } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon, type MiLineIconName } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';

type MiMapButtonBaseProps = {
  /** Line icon by Figma name ('chevron-left' Back, 'locate' Locate me, 'navigation' Recenter, 'phone', 'message'). A legacy icon component is still accepted. */
  icon?: MiLineIconName | IconComponent;
  /** A colour icon instead of a line icon (screen 10's Swap circle: 'swap' at 24). */
  colorIcon?: MiColorIconName;
  onPress?: () => void;
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

export type MiMapButtonProps = MiMapButtonBaseProps &
  (
    | {
        /** Required: the control is a bare glyph. */
        accessibilityLabel: string;
        decorative?: false;
      }
    | {
        accessibilityLabel?: string;
        /**
         * The circle as a picture, not a control: a plain View with the same look,
         * no touch handling, hidden from assistive tech (26's Share card draws a Map
         * Control inside a card that takes the tap and carries the label itself).
         * `onPress`, `disabled` and `accessibilityLabel` are ignored.
         */
        decorative: true;
      }
  );

/** A white circular icon control — Map Control and Icon Button (Outline); `decorative` draws it as a picture. */
export function MiMapButton({
  icon,
  colorIcon,
  onPress,
  accessibilityLabel,
  variant = 'floating',
  size,
  iconSize,
  disabled = false,
  decorative = false,
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

  const circleStyle: StyleProp<ViewStyle> = [
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
  ];

  if (decorative) {
    return (
      <View
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={circleStyle}
      >
        {content}
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
      style={circleStyle}
    >
      {content}
    </Pressable>
  );
}
