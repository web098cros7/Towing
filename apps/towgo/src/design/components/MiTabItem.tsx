import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon, type MiLineIconName } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { MiText } from './MiText';

export type MiTabItemProps = {
  /** Verbatim: 'Home' | 'Bookings' | 'Support' | 'Profile'. */
  label: string;
  /** Home → 'home', Bookings → 'calendar', Support → 'headset-filled', Profile → 'user'. */
  icon: MiLineIconName;
  /** State=Active: icon and label brand/yellow. State=Default: text/secondary. Only the colour changes. */
  active: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tab Item (224:49): column, items centred, gap 1; 30×30 icon; label MiTow/Label 13,
 * no wrap. Width comes from the bar (Home's in-sheet bar: 95.75 fixed; pinned bar: flex 1).
 * The bar itself (padding top 10.3, horizontal 5; border/background by variant) is the navigator's.
 */
export function MiTabItem({ label, icon, active, onPress, onLongPress, style }: MiTabItemProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const color = active ? mitowColors.brandYellow : mitowColors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      pressScale={theme.motion.pressScale.chip}
      haptic="selection"
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[{ alignItems: 'center', gap: 1 }, style]}
    >
      <MiLineIcon name={icon} size={30} color={color} />
      <MiText variant="label13" numberOfLines={1} style={{ color }}>
        {label}
      </MiText>
    </Pressable>
  );
}
