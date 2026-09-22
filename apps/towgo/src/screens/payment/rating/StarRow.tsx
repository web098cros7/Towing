import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon, mitowColors } from '@/design';

/**
 * Figma 31 · Rate Your Trip's star row `236:562`: five `icon/star` instances at 37, gap 10.85,
 * items-start, clips. The row hugs its five stars (5 × 37 + 4 × 10.85 = 228.4); the sheet centres
 * it.
 *
 * The master `icon/star` (`218:45`) is drawn FILLED — Figma's fill is brand/yellow — so every
 * drawn star is yellow and there is no empty/outline variant anywhere in the boards. Picked and
 * unpicked are therefore told apart by COLOUR ALONE, using the same glyph: a star the customer
 * has not picked yet falls back to the icon's own unfilled colour, border/handle, which reads as
 * a quiet grey star rather than an invented outline glyph.
 *
 * Pressable through `usePressablePrimitive()` (chip press scale, selection haptic),
 * `accessibilityRole="radio"` in a `radiogroup`, one radio per star.
 */

/** The design's five stars, 1-based. */
const STARS = [1, 2, 3, 4, 5] as const;

/** Figma instance size and gap of the Stars row (`236:562`). */
const STAR_SIZE = 37;
const STAR_GAP = 10.85;

export function StarRow({
  value,
  onChange,
  disabled = false,
}: {
  /** 0 = nothing picked yet. */
  value: number;
  onChange: (rating: number) => void;
  /** A submit is in flight: the stars stop responding. */
  disabled?: boolean;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Your rating"
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: STAR_GAP }}
    >
      {STARS.map((star) => (
        <Pressable
          key={star}
          onPress={() => onChange(star)}
          disabled={disabled}
          pressScale={theme.motion.pressScale.chip}
          haptic="selection"
          accessibilityRole="radio"
          accessibilityState={{ selected: value === star, checked: value === star, disabled }}
          accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
          hitSlop={4}
        >
          <MiLineIcon
            name="star"
            size={STAR_SIZE}
            color={star <= value ? mitowColors.brandYellow : mitowColors.borderHandle}
          />
        </Pressable>
      ))}
    </View>
  );
}
