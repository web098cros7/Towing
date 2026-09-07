import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Text } from './Text';
import type { IconComponent } from './types';

export type RatingInputProps = {
  /** 0 means unrated. */
  value: number;
  onChange: (value: number) => void;
  max?: number;
  size?: number;
  /** Outline star. Falls back to a ☆ glyph. */
  icon?: IconComponent;
  /** Filled star. Falls back to `icon`, then to a ★ glyph. */
  filledIcon?: IconComponent;
  disabled?: boolean;
};

/**
 * §9.1.10's "rate & review" input — the interactive half.
 *
 * ⚠ A NEW COMPONENT, NOT A PROP ON `RatingStars`. That one is display-only,
 * renders a decimal average beside a single star, and has zero call sites; a
 * component that owns touch handling, an accessibility role and haptics is a
 * different component wearing the same name. Adding `editable` to it would mean
 * every future reader has to work out which half they are looking at.
 *
 * IN `packages/ui` RATHER THAN IN TOWGO, following the `OtpInput` precedent
 * Phase 18 set: the driver app rates the customer through the same
 * `POST …/rate` shape, so a second implementation would be two star rows that
 * drift.
 *
 * THE ACCESSIBILITY LABELS ARE LOAD-BEARING. This repo has no `testID`
 * convention — Maestro matches on visible copy or `accessibilityLabel` — so
 * `"4 stars"` is the only handle a flow has on this control.
 */
export function RatingInput({
  value,
  onChange,
  max = 5,
  size = 36,
  icon: Icon,
  filledIcon: FilledIcon,
  disabled = false,
}: RatingInputProps) {
  const theme = useTheme();
  const Filled = FilledIcon ?? Icon;

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      accessibilityRole="radiogroup"
    >
      {Array.from({ length: max }, (_, index) => {
        const star = index + 1;
        const selected = star <= value;

        return (
          <Pressable
            key={star}
            onPress={() => onChange(star)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
            // A generous hit area: these are 36pt glyphs with 8pt gaps, and a
            // mis-tap here submits the wrong rating rather than doing nothing.
            hitSlop={8}
            style={{ padding: 2 }}
          >
            {selected && Filled ? (
              <Filled size={size} color={theme.colors.star} fill={theme.colors.star} />
            ) : Icon ? (
              <Icon size={size} color={theme.colors.textTertiary} />
            ) : (
              <Text
                style={{
                  fontSize: size,
                  lineHeight: size * 1.15,
                  color: selected ? theme.colors.star : theme.colors.textTertiary,
                }}
              >
                {selected ? '★' : '☆'}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
