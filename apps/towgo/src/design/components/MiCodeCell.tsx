import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { MiText } from './MiText';

/**
 * Display looks of Figma OTP Cell `281:1732`:
 * - `filled` State=Filled `281:1726`: 1.2 border/handle, the digit in MiTow/Title 23.
 * - `empty`  State=Empty `281:1723`: 1.2 border/subtle, no content (24's proposed
 *            loading look, spec Decision D5).
 * The Focused variant (yellow ring + caret) belongs to an input and is not offered.
 */
export type MiCodeCellState = 'filled' | 'empty';

export type MiCodeCellProps = {
  /** One character of the code ("4"). Never parse the code as a number (leading zeros). */
  digit?: string | null;
  /** Default: `filled` when `digit` is non-empty, otherwise `empty`. */
  state?: MiCodeCellState;
  style?: StyleProp<ViewStyle>;
};

/**
 * A READ-ONLY OTP Cell (`281:1732`) for 24's collection code: 48 × 56, surface/page,
 * radius 12, content centred, no shadow. No input, focus, caret or keyboard; `MiOtpCells`
 * stays the input used by 04. Values are the same as `MiOtpCells`' CELL_BASE /
 * CELL_VARIANT, including `flexShrink: 1` (below ~340 dp six cells shrink instead of
 * overflowing; at 319 they stay 48 wide with 6.2 between them under space-between).
 *
 * Hidden from accessibility: give the card one label ("Your collection code is 4 8 2 7 1 9").
 */
export function MiCodeCell({ digit, state, style }: MiCodeCellProps) {
  const resolved: MiCodeCellState = state ?? (digit ? 'filled' : 'empty');
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: mitowLayout.otpCell.width,
          flexShrink: 1,
          height: mitowLayout.otpCell.height,
          borderRadius: mitowRadii.otpCell,
          borderStyle: 'solid',
          borderWidth: 1.2,
          borderColor: resolved === 'filled' ? mitowColors.borderHandle : mitowColors.borderSubtle,
          backgroundColor: mitowColors.surfacePage,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {resolved === 'filled' && digit ? (
        <MiText variant="title23" align="center" numberOfLines={1}>
          {digit}
        </MiText>
      ) : null}
    </View>
  );
}
