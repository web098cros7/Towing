import React, { useState } from 'react';
import {
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { mitowType } from '../tokens/type';
import { MiText } from './MiText';

export type MiTextFieldProps = {
  /** "Show label": MiTow/Medium 16 above the box, gap 8. */
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Default-state text (text/placeholder). Copy verbatim from the spec. */
  placeholder?: string;
  /**
   * Forces a Figma state. Omit to derive it: Disabled when `disabled`, Error when
   * `error`, Focused while focused, otherwise Default/Filled by value.
   * Default   1.2 border/subtle, white, placeholder text/placeholder
   * Filled    1.2 border/subtle, white, value text/primary
   * Focused   1.5 brand/yellow, white
   * Disabled  1.2 border/subtle, surface/muted fill, value text/secondary, not editable
   * Error     1.5 status/danger, white; helper in status/danger-text
   */
  state?: 'default' | 'filled' | 'focused' | 'disabled' | 'error';
  disabled?: boolean;
  error?: boolean;
  /** "Show helper": MiTow/Body S 14 below the box (text/secondary, or status/danger-text on Error). */
  helper?: string;
  /** "Show action": MiTow/Strong 14 text/brand link inside the box, right (e.g. "Change"). */
  actionLabel?: string;
  onAction?: () => void;
  /** "Show leading icon" slot, before the input (gap 12). e.g. Login's "+91" selector. */
  leftSlot?: React.ReactNode;
  /** "Show trailing icon" slot, after the input (20×20 in the master). */
  rightSlot?: React.ReactNode;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  autoFocus?: boolean;
  maxLength?: number;
  accessibilityLabel?: string;
  inputRef?: React.RefObject<TextInput | null>;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Text Field (component set 281:1711): column gap 8; input box 56 tall, radius
 * 14, padding 14 horizontal, gap 12; value in MiTow/Body L 15.5 (21 line height).
 */
export function MiTextField({
  label,
  value,
  onChangeText,
  placeholder,
  state,
  disabled = false,
  error = false,
  helper,
  actionLabel,
  onAction,
  leftSlot,
  rightSlot,
  keyboardType,
  autoCapitalize,
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  autoFocus = false,
  maxLength,
  accessibilityLabel,
  inputRef,
  onFocus,
  onBlur,
  style,
}: MiTextFieldProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const [focused, setFocused] = useState(false);

  const resolved =
    state ??
    (disabled ? 'disabled' : error ? 'error' : focused ? 'focused' : value ? 'filled' : 'default');

  const isDisabled = resolved === 'disabled';
  const borderWidth = resolved === 'focused' || resolved === 'error' ? 1.5 : 1.2;
  const borderColor =
    resolved === 'focused'
      ? mitowColors.brandYellow
      : resolved === 'error'
        ? mitowColors.danger
        : mitowColors.borderSubtle;
  const textColor = isDisabled ? mitowColors.textSecondary : mitowColors.textPrimary;
  const t = mitowType.bodyL155;

  return (
    <View style={[{ gap: 8 }, style]}>
      {label ? <MiText variant="medium16">{label}</MiText> : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          height: mitowLayout.inputHeight,
          paddingHorizontal: 14,
          backgroundColor: isDisabled ? mitowColors.surfaceMuted : mitowColors.surfacePage,
          borderWidth,
          borderColor,
          borderRadius: mitowRadii.input,
          overflow: 'hidden',
        }}
      >
        {leftSlot}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={mitowColors.textPlaceholder}
          editable={!isDisabled}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          autoFocus={autoFocus}
          maxLength={maxLength}
          selectionColor={mitowColors.brandYellow}
          cursorColor={mitowColors.textPrimary}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ disabled: isDisabled }}
          style={{
            flex: 1,
            fontFamily: theme.fonts[t.weight],
            fontSize: t.fontSize,
            lineHeight: t.lineHeight,
            letterSpacing: t.letterSpacing,
            color: textColor,
            padding: 0,
            includeFontPadding: false,
          }}
        />
        {actionLabel ? (
          <Pressable
            onPress={onAction}
            pressScale={theme.motion.pressScale.chip}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            hitSlop={12}
          >
            <MiText variant="strong14" color="brand" numberOfLines={1}>
              {actionLabel}
            </MiText>
          </Pressable>
        ) : null}
        {rightSlot}
      </View>

      {helper ? (
        <MiText variant="bodyS14" color={resolved === 'error' ? 'danger' : 'secondary'}>
          {helper}
        </MiText>
      ) : null}
    </View>
  );
}
