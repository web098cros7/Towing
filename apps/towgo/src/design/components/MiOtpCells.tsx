import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Keyboard, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';
import type { OtpInputHandle } from '@towing/ui';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { MiText } from './MiText';

const OTP_LENGTH = 6;
const NON_DIGITS = /\D/g;

export type MiOtpCellsProps = {
  value: string;
  onChange: (digits: string) => void;
  /** Focus the hidden input on mount. 04 focuses after its push transition instead. */
  autoFocus?: boolean;
};

/** Figma OTP Cell `281:1732` variants. There is no Error variant. */
type OtpCellVariant = 'empty' | 'filled' | 'focused';

/**
 * Common to every variant: 48 x 56, surface/page, radius 12, children centred.
 *
 * `flexShrink: 1` only matters below ~340dp wide, where six fixed 48dp cells
 * would otherwise overflow the row; at 351dp the cells stay exactly 48 wide and
 * `space-between` puts 12.6 between them, as drawn.
 */
const CELL_BASE: ViewStyle = {
  width: mitowLayout.otpCell.width,
  flexShrink: 1,
  height: mitowLayout.otpCell.height,
  borderRadius: mitowRadii.otpCell,
  borderStyle: 'solid',
  backgroundColor: mitowColors.surfacePage,
  alignItems: 'center',
  justifyContent: 'center',
};

const CELL_VARIANT: Record<OtpCellVariant, ViewStyle> = {
  /** State=Empty `281:1723`: border 1.2 border/subtle, no content. */
  empty: { borderWidth: 1.2, borderColor: mitowColors.borderSubtle },
  /** State=Filled `281:1726`: border 1.2 border/handle, digit in Title 23. */
  filled: { borderWidth: 1.2, borderColor: mitowColors.borderHandle },
  /** State=Focused `281:1729`: border 1.5 brand/yellow, caret, no digit. */
  focused: { borderWidth: 1.5, borderColor: mitowColors.brandYellow },
};

/** Caret `281:1731`: 2 x 24, radius 1, text/primary. */
const CARET: ViewStyle = {
  width: 2,
  height: 24,
  borderRadius: 1,
  backgroundColor: mitowColors.textPrimary,
};

/** Code row `284:1864`: full width, height 56, justify space-between, items centred. */
const ROW: ViewStyle = {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
};

/**
 * The single input that actually receives the code. Invisible but full-size over
 * the cells, so a tap anywhere on the row lands on it and focuses it natively
 * (no wrapping pressable is needed, so none is drawn or animated).
 *
 * opacity 0 exactly, not "nearly 0": at 0.02 Android painted the typed digits as
 * a faint ghost behind the first cell. An opacity-0 input stays focusable and
 * tappable.
 */
const HIDDEN_INPUT = StyleSheet.flatten([
  StyleSheet.absoluteFill,
  { opacity: 0, color: 'transparent' },
]);

/**
 * The code row always shows the drawn state, whether or not the hidden input has
 * focus (the keyboard may not have opened yet, or the customer dismissed it):
 * - a cell holding a digit is Filled;
 * - the cell the next digit lands in is Focused (yellow ring + caret);
 * - every cell after it is Empty.
 * The design never draws a cell that is both filled and focused, so once all six
 * are entered every cell is Filled.
 */
function variantFor(index: number, length: number): OtpCellVariant {
  if (index < length) return 'filled';
  return index === length ? 'focused' : 'empty';
}

function OtpCell({ variant, digit }: { variant: OtpCellVariant; digit: string }) {
  return (
    <View
      style={[CELL_BASE, CELL_VARIANT[variant]]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {variant === 'filled' ? (
        <MiText variant="title23" align="center" numberOfLines={1}>
          {digit}
        </MiText>
      ) : variant === 'focused' ? (
        <View style={CARET} />
      ) : null}
    </View>
  );
}

/**
 * Code row (`284:1864`) built from OTP Cell `281:1732`: six 48 x 56 cells in a
 * full-width row.
 *
 * Six drawn cells over ONE hidden `TextInput`, never six inputs: a single input
 * is what keeps pasting a code and the OS SMS autofill (`oneTimeCode` on iOS,
 * `sms-otp` on Android) landing as one insertion. Its
 * `accessibilityLabel="One-time code"` is the screen-reader target and the handle
 * `maestro/customer-login.yaml` taps, so the cells themselves are hidden from
 * accessibility.
 *
 * Deliberately not a wrapper around `@towing/ui`'s `OtpInput`: that component
 * wraps the row in a raw react-native `Pressable` and only marks a cell active
 * while its input has focus, which loses the drawn Focused cell whenever the
 * keyboard is closed.
 */
export const MiOtpCells = forwardRef<OtpInputHandle, MiOtpCellsProps>(function MiOtpCells(
  { value, onChange, autoFocus = false },
  ref,
) {
  const inputRef = useRef<TextInput>(null);

  const handleChange = useCallback(
    // No `maxLength` on the input: a pasted "123 456" must survive until the
    // non-digits are stripped here.
    (raw: string) => onChange(raw.replace(NON_DIGITS, '').slice(0, OTP_LENGTH)),
    [onChange],
  );

  /**
   * Focus the input and make sure the number pad is up. Calling `focus()` on an
   * input that already has focus is a no-op, and Android's back key hides the
   * keyboard without blurring, so a focused input with no keyboard is blurred and
   * focused again.
   */
  const focus = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    if (input.isFocused()) {
      if (Keyboard.isVisible()) return;
      input.blur();
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    input.focus();
  }, []);

  useImperativeHandle(ref, () => ({ focus }), [focus]);

  const length = Math.min(value.length, OTP_LENGTH);

  return (
    <View style={ROW}>
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <OtpCell key={i} variant={variantFor(i, length)} digit={value[i] ?? ''} />
      ))}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        caretHidden
        accessibilityLabel="One-time code"
        style={HIDDEN_INPUT}
      />
    </View>
  );
});
