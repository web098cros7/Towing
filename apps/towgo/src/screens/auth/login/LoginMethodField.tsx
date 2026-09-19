import React from 'react';
import { TextInput, View } from 'react-native';
import { mitowColors, mitowLayout, mitowRadii, mitowType, MiText } from '@/design';
import type { LoginMethod } from './loginMethods.data';
import { useScaledTypeStyle } from './loginType';

/** Input `259:1761` border: 1.2 px, stroke alignment INSIDE. */
const INPUT_BORDER = 1.2;
/**
 * Figma pads 14 from the OUTER edge because an inside stroke takes no layout
 * space. A React Native border does, so the padding gives the border back:
 * content starts at x14 as drawn.
 */
const INPUT_PAD_X = 14 - INPUT_BORDER;

export type LoginMethodFieldProps = {
  method: LoginMethod;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<TextInput | null>;
  maxLength?: number;
  /** Mobile only: the country-code group and divider, placed before the text. */
  leading?: React.ReactNode;
};

/**
 * 03 Login field `259:1759`: label (MiTow/Medium 16), gap 8, then Input
 * `259:1761`.
 *
 * The Input is a plain frame in Figma, not a Text Field instance: white, 1.2
 * border/subtle inside stroke, radius 14, 56 tall, horizontal padding 14,
 * gap 12, items centred. Only its resting look is drawn, so there is no focus
 * ring and no custom selection colour. Placeholder and typed text are Body L
 * 15.5; typed text is text/primary, as the design's filled Text Field draws it.
 */
export function LoginMethodField({
  method,
  value,
  onChangeText,
  onSubmit,
  inputRef,
  maxLength,
  leading,
}: LoginMethodFieldProps) {
  const inputType = useScaledTypeStyle(mitowType.bodyL155);

  return (
    <View style={{ gap: 8 }}>
      <MiText variant="medium16">{method.fieldLabel}</MiText>

      <View
        style={{
          height: mitowLayout.inputHeight,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: INPUT_PAD_X,
          backgroundColor: mitowColors.surfacePage,
          borderWidth: INPUT_BORDER,
          borderColor: mitowColors.borderSubtle,
          borderRadius: mitowRadii.input,
        }}
      >
        {leading}

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={method.placeholder}
          placeholderTextColor={mitowColors.textPlaceholder}
          keyboardType={method.keyboardType}
          textContentType={method.textContentType}
          autoComplete={method.autoComplete}
          autoCapitalize={method.autoCapitalize}
          autoCorrect={false}
          maxLength={maxLength}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          cursorColor={mitowColors.textPrimary}
          maxFontSizeMultiplier={1.2}
          accessibilityLabel={method.inputAccessibilityLabel}
          style={{
            ...inputType,
            flex: 1,
            alignSelf: 'stretch',
            color: mitowColors.textPrimary,
            padding: 0,
            includeFontPadding: false,
            textAlignVertical: 'center',
          }}
        />
      </View>
    </View>
  );
}
