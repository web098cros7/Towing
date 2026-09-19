import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type ViewStyle,
} from 'react-native';
import { mitowColors } from '../tokens/colors';
import { MiText } from './MiText';
import { useFigmaLineBox } from './useFigmaLineBox';

/** Figma Chat Bubble set `281:1739`, property `Side`: Incoming `281:1733` / Outgoing `281:1736`. */
export type MiChatBubbleSide = 'incoming' | 'outgoing';

export type MiChatBubbleProps = {
  side: MiChatBubbleSide;
  /** Message#281:85, verbatim user text. MiTow/Body M 15, left-aligned on both sides. */
  message: string;
  /** Time#281:88, e.g. "10:08 AM". MiTow/Label 13. Omitted = not drawn. */
  time?: string;
  /** Show time#281:91. Default true (every bubble on 22 and 60 shows it). */
  showTime?: boolean;
  /**
   * Width of a bubble whose message wraps. Default 250, the width every wrapping
   * instance on 22 and 60 is drawn at (text width 222). The component description
   * says "max 264", but no screen draws that (22 spec Decision 4), so the instances win.
   */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
};

/** 18 on three corners; 6 on the corner under the sender (bottom-left in, bottom-right out). */
const RADIUS = 18;
const TAIL_RADIUS = 6;

/**
 * Chat Bubble (`281:1739`). Vertical, padding 10 / 14 / 9 / 14, gap 4.
 * - Incoming: surface/muted, text/primary message, text/secondary time at the left,
 *   bottom-left corner 6. Sits at the left of its row.
 * - Outgoing: surface/inverse, text/on-dark message and time, time at the right,
 *   bottom-right corner 6. Sits at the right of its row.
 *
 * Instance values over component values (screen 22 wins, as the owner sees it):
 * - The outgoing time is 100 % text/on-dark. The component paints it at 70 %, but
 *   every outgoing instance on 22 and 60 overrides that to 100 % (22 spec Decision 5).
 * - Width: a message that wraps gets a `maxWidth` (250) bubble; a one-line message hugs
 *   its text (22's "Got it. See you soon." is 172). RN's own text measurement hugs the
 *   longest line on iOS but fills the width on Android, so the wrap is detected from
 *   `onTextLayout` and the width set explicitly, identical on both platforms.
 * - The time line is boxed at 17 (Figma's box for Label 13's 16.5 line), so a two-line
 *   bubble is 80 and a one-line bubble 60, as drawn.
 */
export function MiChatBubble({
  side,
  message,
  time,
  showTime = true,
  maxWidth = 250,
  style,
}: MiChatBubbleProps) {
  const [wraps, setWraps] = useState(false);
  const timeBox = useFigmaLineBox('label13');
  const outgoing = side === 'outgoing';

  // Measured ONCE per message, at the hug width. Re-measuring after every width
  // change could flip between hug and `maxWidth` forever when a line only just fits.
  const measured = useRef<string | null>(null);
  if (measured.current !== null && measured.current !== message) {
    measured.current = null;
    if (wraps) setWraps(false);
  }

  const onTextLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (measured.current === message) return;
      measured.current = message;
      setWraps(e.nativeEvent.lines.length > 1);
    },
    [message],
  );

  return (
    <View
      style={[
        {
          alignSelf: outgoing ? 'flex-end' : 'flex-start',
          maxWidth,
          width: wraps ? maxWidth : undefined,
          paddingTop: 10,
          paddingRight: 14,
          paddingBottom: 9,
          paddingLeft: 14,
          gap: 4,
          alignItems: outgoing ? 'flex-end' : 'flex-start',
          backgroundColor: outgoing ? mitowColors.surfaceInverse : mitowColors.surfaceMuted,
          borderTopLeftRadius: RADIUS,
          borderTopRightRadius: RADIUS,
          borderBottomRightRadius: outgoing ? TAIL_RADIUS : RADIUS,
          borderBottomLeftRadius: outgoing ? RADIUS : TAIL_RADIUS,
        },
        style,
      ]}
    >
      <MiText
        variant="bodyM15"
        color={outgoing ? 'onDark' : 'primary'}
        align="left"
        onTextLayout={onTextLayout}
        style={{ alignSelf: 'stretch' }}
      >
        {message}
      </MiText>
      {showTime && time ? (
        <MiText
          variant="label13"
          color={outgoing ? 'onDark' : 'secondary'}
          numberOfLines={1}
          style={{ minHeight: timeBox }}
        >
          {time}
        </MiText>
      ) : null}
    </View>
  );
}
