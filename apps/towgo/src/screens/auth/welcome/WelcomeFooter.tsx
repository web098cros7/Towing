import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiText } from '@/design';
import { fixedType } from './welcomeType';

export type WelcomeFooterProps = {
  onContactSupport: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * How far the link's touch area reaches below its 19pt line. The screen keeps at
 * least this much between the footer and a real system navigation bar, so the
 * whole touch area stays above the bar.
 */
export const WELCOME_FOOTER_SLOP_BOTTOM = 8;

/**
 * 19 + 17 + 8 = a 44pt touch height. The slop grows upward into the drawn 26pt
 * gap below Sign Up (it stops 9 short of the button) rather than down toward the
 * system bar. None to the left: "Need help? " is not a link.
 */
const LINK_HIT_SLOP = { top: 17, bottom: WELCOME_FOOTER_SLOP_BOTTOM, left: 0, right: 12 } as const;

/**
 * Footer "Need help" (421:19859): ONE line, centre-aligned, auto width 187 × 19.
 * Characters `Need help? Contact Support`, no icon, chevron or underline.
 *
 * - Run 1 "Need help? " (trailing space included): MiTow/Body S 14, text/on-dark.
 * - Run 2 "Contact Support": no style applied = Inter Semi Bold 14 / 19 / -0.21
 *   (Body S 14 with a semibold override, NOT Strong 14's -0.28), brand/yellow.
 *
 * Only run 2 is drawn as a link, so only run 2 is the tap target; "Need help? "
 * has no action of its own. The line is therefore two text boxes in a row. The
 * space stays in run 1's Regular weight but is written as the first character of
 * the link box: a leading space is always part of a text box's measured width on
 * both platforms, a trailing one is not guaranteed to be. The glyphs, weights,
 * colours and positions are the same as the single Figma text node.
 */
export function WelcomeFooter({ onContactSupport, style }: WelcomeFooterProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <View style={[styles.row, style]}>
      <MiText variant="bodyS14" color="onDark" style={bodyType}>
        {'Need help?'}
      </MiText>
      <Pressable
        onPress={onContactSupport}
        pressScale={theme.motion.pressScale.chip}
        haptic="light"
        hitSlop={LINK_HIT_SLOP}
        accessibilityRole="link"
        accessibilityLabel="Contact Support"
      >
        <MiText variant="bodyS14" color="onDark" style={bodyType}>
          {' '}
          <MiText variant="bodyS14" weight="semibold" color="yellow" style={bodyType}>
            {'Contact Support'}
          </MiText>
        </MiText>
      </Pressable>
    </View>
  );
}

const bodyType = fixedType('bodyS14');

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignSelf: 'center' },
});
