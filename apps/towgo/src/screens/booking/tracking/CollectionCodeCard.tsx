import React from 'react';
import { View } from 'react-native';
import { MiCodeCell, MiColorIcon, MiText, mitowColors, mitowRadii } from '@/design';

/** Figma 24 copy, verbatim. The label is upper case in the characters themselves. */
const LABEL = 'YOUR COLLECTION CODE';
const NOTE =
  'The driver cannot start your tow without this code. Never share it before they arrive.';

const DIGITS = 6;

/**
 * Figma 24 · Collection code `299:4150` (a plain frame, not a component).
 *
 * brand/yellow-soft, radius 16, padding 16, gap 12, no stroke and no shadow
 * (not `MiCard`, which adds both). Holds, top to bottom:
 * - Label `299:4151` "YOUR COLLECTION CODE": Overline 12 (+0.96), text/brand.
 * - Code row `299:4152`: six OTP Cells State=Filled, space-between across the
 *   319 inner width (6.2 between cells), items centred. Read-only: no input,
 *   focus, caret or keyboard. While the code is not known (first read, failed
 *   read) the cells show State=Empty (spec Decision D5); nothing else is drawn.
 * - Note `299:4171`: icon/color/verified 26 top-aligned, gap 10, Body S 14
 *   secondary, wrapping to two lines at 283.
 *
 * The cells are hidden from accessibility; the card carries one label.
 */
export function CollectionCodeCard({ code }: { code: string | null }) {
  // Never parsed as a number: a code can start with 0.
  const digits = code ? code.split('') : [];

  return (
    <View
      accessible
      accessibilityLabel={
        code
          ? `Your collection code is ${digits.join(' ')}. ${NOTE}`
          : `Your collection code. ${NOTE}`
      }
      style={{
        backgroundColor: mitowColors.brandYellowSoft,
        borderRadius: mitowRadii.card,
        padding: 16,
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <MiText variant="overline12" color="brand" numberOfLines={1}>
        {LABEL}
      </MiText>

      <View
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {Array.from({ length: DIGITS }, (_, i) => (
          <MiCodeCell key={i} digit={digits[i] ?? null} />
        ))}
      </View>

      <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <MiColorIcon name="verified" size={26} />
        <MiText variant="bodyS14" color="secondary" style={{ flex: 1 }}>
          {NOTE}
        </MiText>
      </View>
    </View>
  );
}
