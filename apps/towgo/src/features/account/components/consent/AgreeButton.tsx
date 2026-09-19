import React from 'react';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors, mitowLayout, mitowRadii } from '@/design';
import { ExactText } from './ExactText';

/** Primary Button 224:10 as instanced on 06 (287:2010): no leading or trailing icon. */
const PADDING_HORIZONTAL = 16;
const GAP = 12;

/**
 * E5 "I Agree": 351×54, surface/inverse, radius 14, label MiTow/Strong 16
 * text/on-dark centred. Built locally so the label uses the exact Figma type
 * metrics (see `ExactText`); `MiButton` scales its label. Only the default state
 * is drawn, so there is no spinner or dimmed state.
 */
export function AgreeButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.button}
      haptic="medium"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        height: mitowLayout.controlHeight,
        borderRadius: mitowRadii.button,
        backgroundColor: mitowColors.surfaceInverse,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: GAP,
        paddingHorizontal: PADDING_HORIZONTAL,
        alignSelf: 'stretch',
      }}
    >
      <ExactText variant="strong16" color="onDark" numberOfLines={1}>
        {label}
      </ExactText>
    </Pressable>
  );
}
