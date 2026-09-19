import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';
import { MiText } from './MiText';

export type MiHelpChipProps = {
  /** Every Help chip opens the root 'Support' route (screen 58). */
  onPress?: () => void;
  /**
   * Side padding. 16 = the Help Button master 223:16 (95×46; Home 08, Searching 16/17,
   * Driver En Route 18). 12 = the chip inside Nav Bar Trailing=Help (87×46; screen 09).
   */
  paddingHorizontal?: 16 | 12;
  style?: StyleProp<ViewStyle>;
};

/**
 * Help Button (223:16): white pill, padding 11 vertical, gap 6, icon/headset 24,
 * "Help" in MiTow/Strong 15 text/primary, MiTow/Elevation/Floating. Height 46.
 */
export function MiHelpChip({ onPress, paddingHorizontal = 16, style }: MiHelpChipProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.chip}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel="Help"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 6,
          paddingHorizontal,
          paddingVertical: 11,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.surfacePage,
          ...mitowShadows.floating,
        },
        style,
      ]}
    >
      <MiLineIcon name="headset" size={24} />
      <MiText variant="strong15" numberOfLines={1}>
        Help
      </MiText>
    </Pressable>
  );
}
