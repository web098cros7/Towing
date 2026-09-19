import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiText, mitowColors, mitowLayout, mitowRadii } from '@/design';
import { fixedType } from './welcomeType';

export type WelcomeButtonProps = {
  label: string;
  /**
   * - 'logIn'  Primary Button 224:10 instance 421:19857: brand/yellow fill,
   *            padding 24 left/right, gap 12, no stroke.
   * - 'signUp' Secondary Button 238:499 Tone=Strong instance 421:19858:
   *            surface/page fill, 1.5 INSIDE text/primary stroke, padding 16, gap 10.
   */
  kind: 'logIn' | 'signUp';
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * The two Welcome CTAs exactly as the instances are drawn: 54 tall, radius 14,
 * content centred on both axes, one label (MiTow/Strong 16, text/primary) and no
 * icon layer ("Show icon" / "Show leading icon" are false).
 *
 * Built here rather than with `MiButton` because `MiButton`'s label is a `MiText`
 * that rescales type by device width, and the design draws fixed type
 * (`fixedType`). Press feedback (scale + haptic) is the app-wide pressable
 * primitive's, as on every other MiTow control.
 */
export function WelcomeButton({ label, kind, onPress, style }: WelcomeButtonProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const isLogIn = kind === 'logIn';

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.button}
      haptic={isLogIn ? 'medium' : 'light'}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.base, isLogIn ? styles.logIn : styles.signUp, style]}
    >
      <MiText variant="strong16" color="primary" numberOfLines={1} style={labelType}>
        {label}
      </MiText>
    </Pressable>
  );
}

const labelType = fixedType('strong16');

const styles = StyleSheet.create({
  base: {
    height: mitowLayout.controlHeight,
    borderRadius: mitowRadii.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  logIn: {
    backgroundColor: mitowColors.brandYellow,
    paddingLeft: 24,
    paddingRight: 24,
    gap: 12,
  },
  signUp: {
    backgroundColor: mitowColors.surfacePage,
    // RN borders sit inside the box, matching the INSIDE stroke.
    borderWidth: 1.5,
    borderColor: mitowColors.textPrimary,
    paddingLeft: 16,
    paddingRight: 16,
    gap: 10,
  },
});
