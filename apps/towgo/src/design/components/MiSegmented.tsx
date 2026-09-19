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
};

/** Equal-width segmented control (Figma "Segment"). */
export function MiSegmented({ options, value, onChange, disabledKeys = [] }: MiSegmentedProps) {
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
              height: mitowLayout.segmentHeight,
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
