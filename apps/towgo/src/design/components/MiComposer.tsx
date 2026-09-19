import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { mitowType } from '../tokens/type';

export type MiComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  /**
   * Called with the TRIMMED text when Send is pressed or the keyboard's send key is
   * used, and only when that text is non-empty (an empty Send does nothing; no disabled
   * look is drawn). The input is not cleared here: clear `value` in the handler.
   */
  onSend: (text: string) => void;
  /** Default "Type a message…" (ends in U+2026), verbatim from 22 and 60. */
  placeholder?: string;
  /**
   * Bottom padding override. Default: max(34, safe-area bottom) while the keyboard is
   * closed (34 is the drawn home-indicator zone) and 10 while it is open (22 spec
   * Decision 3: mirrors the top padding).
   */
  paddingBottom?: number;
  inputRef?: React.RefObject<TextInput | null>;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Default "Message". */
  inputAccessibilityLabel?: string;
  /** Default "Send message". */
  sendAccessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** Tracks whether the software keyboard is up (will* on iOS so the padding moves with it). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setOpen(true));
    const hide = Keyboard.addListener(hideEvent, () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

/**
 * Chat composer. Not a Figma component: frame "Composer" `292:2677` on 22 and the same
 * frame on 60 (`297:3624`, identical geometry).
 *
 * - Bar: full width, surface/page, 1 px border/subtle TOP border (inside, in layout),
 *   padding 10 top / 21 sides / 34 bottom, gap 10, items centred → 93 tall.
 * - Input `292:2678`: flex 1 × 48, surface/muted, radius 999, padding 0 / 16, no border.
 *   A one-line TextInput in MiTow/Body M 15; placeholder text/placeholder, typed text
 *   text/primary (inferred: typing is not drawn).
 * - Send `292:2680`: 48 circle, surface/inverse, icon/arrow-right 22 in text/on-dark
 *   (stroke 2.2 absolute). Button press scale, light haptic.
 *
 * Not drawn, so not built: attachments, emoji, counters, a disabled Send, a spinner.
 * Keep focus after sending (`submitBehavior="submit"`).
 */
export function MiComposer({
  value,
  onChangeText,
  onSend,
  placeholder = 'Type a message…',
  paddingBottom,
  inputRef,
  onFocus,
  onBlur,
  inputAccessibilityLabel = 'Message',
  sendAccessibilityLabel = 'Send message',
  style,
}: MiComposerProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  const t = mitowType.bodyM15;

  const bottom =
    paddingBottom ?? (keyboardOpen ? 10 : Math.max(mitowLayout.sheetPadBottom, insets.bottom));

  const send = () => {
    const text = value.trim();
    if (text) onSend(text);
  };

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingTop: 10,
          paddingLeft: mitowLayout.sideMargin,
          paddingRight: mitowLayout.sideMargin,
          paddingBottom: bottom,
          backgroundColor: mitowColors.surfacePage,
          borderTopWidth: 1,
          borderTopColor: mitowColors.borderSubtle,
        },
        style,
      ]}
    >
      <View
        style={{
          flex: 1,
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.surfaceMuted,
        }}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={mitowColors.textPlaceholder}
          multiline={false}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={send}
          onFocus={onFocus}
          onBlur={onBlur}
          selectionColor={mitowColors.brandYellow}
          cursorColor={mitowColors.textPrimary}
          accessibilityLabel={inputAccessibilityLabel}
          maxFontSizeMultiplier={1.2}
          style={{
            flex: 1,
            fontFamily: theme.fonts[t.weight],
            fontSize: t.fontSize,
            lineHeight: t.lineHeight,
            letterSpacing: t.letterSpacing,
            color: mitowColors.textPrimary,
            padding: 0,
            includeFontPadding: false,
          }}
        />
      </View>

      <Pressable
        onPress={send}
        pressScale={theme.motion.pressScale.button}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel={sendAccessibilityLabel}
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
