import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { mitowColors, mitowRadii, mitowType, MiColorIcon, MiText } from '@/design';

/** `createBookingRequest.note` is capped at 500 characters by the contract. */
const NOTE_MAX_LENGTH = 500;

/** Placeholder `259:1589`, verbatim. */
const NOTES_PLACEHOLDER = 'Add any notes (e.g., vehicle condition, underground parking, etc.)';

/** Field `259:1585` stroke: 1.2 border/subtle, drawn inside and taking no layout space. */
const FIELD_BORDER = 1.2;

/** `MiText`'s rounding, so the input's type scales exactly like the sheet text around it. */
const roundHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * Figma 14 Notes section `259:1583`.
 *
 * Heading `259:1584`: "Additional Notes" (Heading 18) + " (Optional)" (Regular
 * 18 / 24 / −0.36, #4A5568). 12 below it, the field `259:1585`: surface/page,
 * radius 14, padding 14, gap 12, row centred: icon/color/feedback 32, a 1 × 36
 * border/subtle divider, then the text itself (two Body S 14 lines, 38). That
 * is 14 + 38 + 14 = 66 tall with a 266-wide text column: the 1.2 stroke is an
 * overlay, as Figma draws it, so it adds nothing to either.
 *
 * The field IS the input: the note is typed in place. The box keeps its drawn
 * two lines; a longer note scrolls inside them.
 */
export function NotesSection({
  note,
  onChangeNote,
}: {
  note: string;
  onChangeNote: (value: string) => void;
}) {
  const theme = useTheme();
  const body = mitowType.bodyS14;
  const ratio = theme.scaleRatio;
  const fontSize = ratio === 1 ? body.fontSize : roundHalf(body.fontSize * ratio);
  const lineHeight = ratio === 1 ? body.lineHeight : roundHalf(body.lineHeight * ratio);
  const letterSpacing =
    ratio === 1 ? body.letterSpacing : roundHalf(body.letterSpacing * ratio * 10) / 10;

  return (
    <View style={{ gap: 12 }}>
      <MiText variant="heading18">
        Additional Notes
        <MiText variant="heading18" weight="regular" color="secondary">
          {' (Optional)'}
        </MiText>
      </MiText>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderRadius: mitowRadii.cardSm,
          backgroundColor: mitowColors.surfacePage,
        }}
      >
        <MiColorIcon name="feedback" size={32} />
        <View style={{ width: 1, height: 36, backgroundColor: mitowColors.borderSubtle }} />
        <TextInput
          value={note}
          onChangeText={onChangeNote}
          placeholder={NOTES_PLACEHOLDER}
          placeholderTextColor={mitowColors.textPlaceholder}
          multiline
          maxLength={NOTE_MAX_LENGTH}
          maxFontSizeMultiplier={1.2}
          accessibilityLabel="Additional notes"
          selectionColor={mitowColors.brandYellow}
          cursorColor={mitowColors.textPrimary}
          textAlignVertical="center"
          style={{
            flex: 1,
            height: lineHeight * 2,
            padding: 0,
            margin: 0,
            fontFamily: theme.fonts[body.weight],
            fontSize,
            lineHeight,
            letterSpacing,
            color: mitowColors.textPrimary,
          }}
        />

        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: mitowRadii.cardSm,
              borderWidth: FIELD_BORDER,
              borderColor: mitowColors.borderSubtle,
            },
          ]}
        />
      </View>
    </View>
  );
}
