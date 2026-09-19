import React from 'react';
import { View, type ImageSourcePropType } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';
import { MiText } from './MiText';

export type MiPillProps = {
  /** Leading colour icon at 18 (Figma icon/color/*). A require()d source is still accepted. */
  icon?: MiColorIconName | ImageSourcePropType;
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/**
 * Selector pill of Figma 10 ("Pickup now" 289:2197, "For me" 289:2202):
 * surface/muted fill, radius 999, 32 tall, padding 7 / 10, gap 6, no border or
 * shadow. Colour icon 18, MiTow/Chip 13.5 label, then "Chevron (down)": the
 * icon/chevron-right glyph rotated to point down, 16×16.
 */
export function MiPill({
  icon,
  label,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: MiPillProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.chip}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: mitowLayout.pillHeight,
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderRadius: mitowRadii.pill,
        backgroundColor: mitowColors.surfaceMuted,
      }}
    >
      {icon ? (
        typeof icon === 'string' ? (
          <MiColorIcon name={icon as MiColorIconName} size={18} />
        ) : (
          <MiColorIcon source={icon} size={18} />
        )
      ) : null}
      <MiText variant="chip135" numberOfLines={1}>
        {label}
      </MiText>
      <View style={{ width: 16, height: 16, transform: [{ rotate: '90deg' }] }}>
        <MiLineIcon name="chevron-right" size={16} />
      </View>
    </Pressable>
  );
}
