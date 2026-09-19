import React from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon, mitowColors, mitowLayout, mitowRadii, mitowType } from '@/design';
import { useKeyboardOpen } from './useKeyboardOpen';

/** Input `292:2678`: 48 tall with one 20 line, so 14 above and below the text. */
const INPUT_HEIGHT = 48;
const INPUT_PAD_Y = (INPUT_HEIGHT - mitowType.bodyM15.lineHeight) / 2;
/** NOT DRAWN: the field grows with its text up to 4 lines, then scrolls (22 Decision 6). */
const MAX_LINES = 4;

/**
 * Composer `292:2677`, built here rather than with `MiComposer` because 22's owner
 * decision is a field that GROWS up to 4 lines, and `MiComposer` is a fixed one-line
 * field. Every drawn value is `MiComposer`'s, so at one line the two are identical:
 *
 * - Bar: full width, surface/page, 1 px border/subtle TOP border (inside, in layout),
 *   padding 10 top / 21 sides, gap 10 → 93 tall on iPhone 16. Bottom padding is the
 *   34 home-indicator zone (or the system inset when taller) with the keyboard closed,
 *   and 10 while it is open (22 Decision 3, mirrors the top).
 * - Input: flex × 48, surface/muted, radius 24 (the drawn 999 on a 48 pill), padding
 *   0 / 16, no border. MiTow/Body M 15; placeholder "Type a message…" (U+2026) in
 *   text/placeholder, typed text text/primary (inferred: typing is not drawn).
 * - Send `292:2680`: 48 circle, surface/inverse, icon/arrow-right 22 in text/on-dark
 *   (stroke 2.2 absolute). Button press scale, light haptic.
 *
 * Growth (not drawn, flagged): each extra line adds 20; past 4 lines the text scrolls
 * inside the field. The corners stay 24, and Send stays at the bottom of the bar
 * (`flex-end`; at one line that is the drawn centre, both being 48).
 *
 * Send works only with text (after trimming); an empty Send does nothing and keeps
 * the one drawn look, since no disabled Send is designed. The keyboard's send key
 * sends too and keeps the keyboard up (`submitBehavior="submit"`), so a Return never
 * inserts a line break: the field grows by wrapping. Not drawn, so not built:
 * attachments, camera, microphone, emoji, a counter, a spinner.
 */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** The TRIMMED text, only when non-empty. The input is not cleared here. */
  onSend: (text: string) => void;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  const t = mitowType.bodyM15;

  const canSend = value.trim().length > 0;
  const send = () => {
    const text = value.trim();
    if (text) onSend(text);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
        paddingTop: 10,
        paddingLeft: mitowLayout.sideMargin,
        paddingRight: mitowLayout.sideMargin,
        paddingBottom: keyboardOpen ? 10 : Math.max(mitowLayout.sheetPadBottom, insets.bottom),
        backgroundColor: mitowColors.surfacePage,
        borderTopWidth: 1,
        borderTopColor: mitowColors.borderSubtle,
      }}
    >
      <View
        style={{
          flex: 1,
          minHeight: INPUT_HEIGHT,
          justifyContent: 'center',
          paddingHorizontal: 16,
          borderRadius: INPUT_HEIGHT / 2,
          backgroundColor: mitowColors.surfaceMuted,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Type a message…"
          placeholderTextColor={mitowColors.textPlaceholder}
          multiline
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={send}
          selectionColor={mitowColors.brandYellow}
          cursorColor={mitowColors.textPrimary}
          accessibilityLabel="Message"
          maxFontSizeMultiplier={1.2}
          style={{
            fontFamily: theme.fonts[t.weight],
            fontSize: t.fontSize,
            lineHeight: t.lineHeight,
            letterSpacing: t.letterSpacing,
            color: mitowColors.textPrimary,
            paddingHorizontal: 0,
            paddingTop: INPUT_PAD_Y,
            paddingBottom: INPUT_PAD_Y,
            maxHeight: INPUT_PAD_Y * 2 + t.lineHeight * MAX_LINES,
            includeFontPadding: false,
            textAlignVertical: 'top',
          }}
        />
      </View>

      <Pressable
        onPress={send}
        disabled={!canSend}
        pressScale={theme.motion.pressScale.button}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !canSend }}
        style={{
          width: 48,
          height: 48,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.surfaceInverse,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MiLineIcon name="arrow-right" size={22} color={mitowColors.textOnDark} />
      </Pressable>
    </View>
  );
}
