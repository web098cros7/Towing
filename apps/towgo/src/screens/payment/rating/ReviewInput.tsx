import React from 'react';
import { TextInput } from 'react-native';
import { mitowColors, mitowType } from '@/design';
import { useTheme } from '@towing/theme';

/**
 * Figma 31 · Rate Your Trip's review box `236:568`: 42 tall, 351 wide (the sheet's content
 * width), surface/muted, radius 12, padding 12 sides, no border and no shadow, one line of
 * MiTow/Body S 14.
 *
 * NOT `MiTextField` nor `MiComposer`: the Text Field draws a 1.2 stroke at 56 tall with its own
 * focus states, and the composer's input is a 48 pill with a send button beside it. 31 draws
 * neither, so this is the drawn box over a plain `TextInput` — the same construction the tracking
 * screen's `TruckCallout` uses where a component's chrome does not exist in the frame.
 *
 * The drawn box is ONE line with no wrap, so `multiline` is off and a long review scrolls
 * horizontally inside it rather than growing the box. The placeholder is 31's own copy, in
 * text/placeholder (the app's `MiText` token, so the two cannot drift).
 */
const BOX_HEIGHT = 42;

export function ReviewInput({
  value,
  onChangeText,
  editable,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** A Done submit is in flight: the box stops accepting text. */
  editable: boolean;
}) {
  const theme = useTheme();
  const type = mitowType.bodyS14;

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      editable={editable}
      placeholder="Write a review (optional)"
      placeholderTextColor={mitowColors.textPlaceholder}
      multiline={false}
      maxLength={1000}
      selectionColor={mitowColors.brandYellow}
      cursorColor={mitowColors.textPrimary}
      accessibilityLabel="Write a review (optional)"
      maxFontSizeMultiplier={1.2}
      style={{
        alignSelf: 'stretch',
        height: BOX_HEIGHT,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: mitowColors.surfaceMuted,
        fontFamily: theme.fonts[type.weight],
        fontSize: type.fontSize,
        lineHeight: type.lineHeight,
        letterSpacing: type.letterSpacing,
        color: mitowColors.textPrimary,
        paddingVertical: 0,
        includeFontPadding: false,
      }}
    />
  );
}

/** The box's drawn height, for the caller that measures the card. */
export const REVIEW_BOX_HEIGHT = BOX_HEIGHT;
