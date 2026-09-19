import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors } from '../tokens/colors';
import { mitowRadii } from '../tokens/layout';
import { MiText } from './MiText';

export type MiChipProps = {
  /** Label#281:112, verbatim. MiTow/Chip 13.5, text/primary in both states (never bold). */
  label: string;
  /** State=Selected `281:1788` when true; State=Default `281:1786` otherwise. Default false. */
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Default: the label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Chip (`281:1790`): a pill (radius 999) that hugs its label, padding 8 top/bottom and
 * 14 left/right, content centred.
 * - Default: surface/page fill, 1.2 border/handle border → 36.4 tall.
 * - Selected: brand/yellow-soft fill, 1.5 brand/yellow border → 37 tall. No check mark.
 *
 * Figma has `strokesIncludedInLayout` true, and an RN border takes layout space too, so
 * the paddings are the drawn ones and the selected chip really is 0.6 larger. Do not
 * compensate.
 *
 * Pressable through `usePressablePrimitive()`: chip press scale, selection haptic,
 * `accessibilityState.selected`. Place chips in a row (21: wrapping row, gap 8,
 * `alignItems: 'center'`; 22: horizontal ScrollView, gap 8); in a column, pass
 * `alignSelf` so it keeps hugging.
 */
export function MiChip({
  label,
  selected = false,
  onPress,
  disabled = false,
  accessibilityLabel,
  style,
}: MiChipProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      pressScale={theme.motion.pressScale.chip}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: mitowRadii.pill,
          borderWidth: selected ? 1.5 : 1.2,
          borderColor: selected ? mitowColors.brandYellow : mitowColors.borderHandle,
          backgroundColor: selected ? mitowColors.brandYellowSoft : mitowColors.surfacePage,
        },
        style,
      ]}
    >
      <MiText variant="chip135" numberOfLines={1}>
        {label}
      </MiText>
    </Pressable>
  );
}
