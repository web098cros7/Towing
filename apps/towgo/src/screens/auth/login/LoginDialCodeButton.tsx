import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors, MiLineIcon, MiText } from '@/design';

export type LoginDialCodeButtonProps = {
  dialCode: string;
  onPress: () => void;
};

/**
 * 03 Login country-code group `259:1762` and the divider `259:1766` after it.
 *
 * Group: code text (MiTow/Medium 16, the selected dial code) + "Chevron (down)"
 * `259:1764`, gap 4. The chevron is icon/chevron-right `218:26` at 18, turned
 * 90° clockwise so it points down; `MiLineIcon` keeps its 2.2 px stroke at 18.
 *
 * Divider: 1×28 border/subtle. It is the Input row's next child, so the row's
 * gap 12 sits on both sides of it. Returned as a fragment for that reason.
 */
export function LoginDialCodeButton({ dialCode, onPress }: LoginDialCodeButtonProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <>
      <Pressable
        onPress={onPress}
        pressScale={theme.motion.pressScale.chip}
        haptic="selection"
        hitSlop={{ top: 17.5, bottom: 17.5, left: 14, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={`Country code ${dialCode}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      >
        <MiText variant="medium16">{dialCode}</MiText>
        <MiLineIcon name="chevron-right" size={18} style={{ transform: [{ rotate: '90deg' }] }} />
      </Pressable>

      <View style={{ width: 1, height: 28, backgroundColor: mitowColors.borderSubtle }} />
    </>
  );
}
