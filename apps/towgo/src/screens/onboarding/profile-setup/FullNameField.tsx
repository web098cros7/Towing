import React, { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@towing/theme';
import { mitowColors, mitowLayout, mitowRadii, mitowType, MiText } from '@/design';

export type FullNameFieldProps = {
  /** Field Label `I284:1906;281:1682`, verbatim. */
  label: string;
  /** Text Field State=Default `281:1661` copy, verbatim. */
  placeholder: string;
  /** Value `I284:1906;281:1686`: what the customer types. */
  value: string;
  onChangeText: (value: string) => void;
  /** Text Field State=Error `281:1701`: 1.5 status/danger ring. Helper stays hidden, as on this instance. */
  error: boolean;
  inputRef: React.RefObject<TextInput | null>;
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  autoFocus?: boolean;
};

/** MiText's rounding (`design/components/MiText.tsx`), so the value scales exactly like the label. */
const roundHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * Figma 05's Full name field `284:1906`: an instance of Text Field `281:1711` with
 * the label shown and the leading icon, action, trailing icon and helper hidden.
 *
 * Screen-local rather than `MiTextField` because the foundation field draws the
 * typed value at the raw 15.5 while `MiText` scales the label, title and note by
 * `theme.scaleRatio` (0.88–1.06). In Figma the Value (Body L 15.5) is the same
 * size as the subtitle and in proportion with the label, so here the value and
 * placeholder use MiText's scaling and its 1.2 font-scale cap. Everything else
 * is the component's own geometry, in exact px:
 * - column gap 8 (label → box)
 * - box 56 tall, radius 14, padding 14 horizontal, white fill, clips
 * - Default / Filled: 1.2 border/subtle. Focused: 1.5 brand/yellow. Error: 1.5 status/danger.
 *   The border takes layout space, as `strokesIncludedInLayout` does in Figma,
 *   so the text starts at 15.5 when Focused.
 */
export function FullNameField({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  inputRef,
  onSubmitEditing,
  autoFocus = false,
}: FullNameFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const state = error ? 'error' : focused ? 'focused' : value ? 'filled' : 'default';
  const ringed = state === 'focused' || state === 'error';

  const t = mitowType.bodyL155;
  const ratio = theme.scaleRatio;

  return (
    <View style={{ gap: 8 }}>
      <MiText variant="medium16">{label}</MiText>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: mitowLayout.inputHeight,
          paddingHorizontal: 14,
          backgroundColor: mitowColors.surfacePage,
          borderWidth: ringed ? 1.5 : 1.2,
          borderColor:
            state === 'error'
              ? mitowColors.danger
              : state === 'focused'
                ? mitowColors.brandYellow
                : mitowColors.borderSubtle,
          borderRadius: mitowRadii.input,
          overflow: 'hidden',
        }}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={mitowColors.textPlaceholder}
          autoFocus={autoFocus}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
          selectionColor={mitowColors.brandYellow}
          cursorColor={mitowColors.textPrimary}
          maxFontSizeMultiplier={1.2}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          style={{
            flex: 1,
            fontFamily: theme.fonts[t.weight],
            fontSize: ratio === 1 ? t.fontSize : roundHalf(t.fontSize * ratio),
            lineHeight: ratio === 1 ? t.lineHeight : roundHalf(t.lineHeight * ratio),
            letterSpacing:
              ratio === 1 ? t.letterSpacing : roundHalf(t.letterSpacing * ratio * 10) / 10,
            color: mitowColors.textPrimary,
            padding: 0,
            includeFontPadding: false,
          }}
        />
      </View>
    </View>
  );
}
