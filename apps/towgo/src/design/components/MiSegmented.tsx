import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { MiText } from './MiText';

export type MiSegmentedOption = {
  key: string;
  label: string;
};

export type MiSegmentedProps = {
  options: MiSegmentedOption[];
  value: string;
  onChange: (key: string) => void;
  /**
   * Keys that render normally but do not respond. Used for Login's "Email" tab:
   * the design shows it, the app authenticates by phone OTP only, and a tab that
   * silently does nothing is better than one that navigates somewhere unbuilt.
   */
  disabledKeys?: string[];
  /**
   * Instance height. Defaults to the master's `mitowLayout.segmentHeight` (40), which is what
   * 03 Login draws. 33 / 34's Bookings filter instances are 46.
   *
   * MUST BE EVEN. The Segment master's label is centred by auto-layout, and 40 − 20 lands on
   * 10 exactly; 46 − 20 lands on 13 exactly. An odd height would put a half-pixel between the
   * label's two edges, which Android rounds asymmetrically.
   */
  height?: number;
};

/** Equal-width segmented control (Figma "Segment"). */
export function MiSegmented({
  options,
  value,
  onChange,
  disabledKeys = [],
  height = mitowLayout.segmentHeight,
}: MiSegmentedProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {options.map((option) => {
        const selected = option.key === value;
        const isDisabled = disabledKeys.includes(option.key);

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            disabled={isDisabled}
            pressScale={theme.motion.pressScale.chip}
            haptic="selection"
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: isDisabled }}
            accessibilityLabel={option.label}
            style={{
              flex: 1,
              height,
              borderRadius: mitowRadii.segment,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 12,
              backgroundColor: selected ? mitowColors.surfaceInverse : mitowColors.surfaceMuted,
            }}
          >
            <MiText
              variant={selected ? 'strong15' : 'bodyM15'}
              color={selected ? 'onDark' : 'primary'}
              numberOfLines={1}
            >
              {option.label}
            </MiText>
          </Pressable>
        );
      })}
    </View>
  );
}
