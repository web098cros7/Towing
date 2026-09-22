import React from 'react';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive, type IconComponent } from '@towing/ui';
import { MiLineIcon, type MiLineIconName } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { MiText } from './MiText';

/**
 * Figma component → tone:
 * - `dark`    Primary Button 224:10 (surface/inverse fill, text/on-dark label). Alias `primary`.
 * - `yellow`  Primary Button 224:10 with the fill overridden to brand/yellow and the
 *             label to text/primary (Welcome "Log In", Book a Tow "Confirm Booking").
 * - `outline` Secondary Button 238:499 Tone=Strong 238:491 (white, 1.5 text/primary border). Alias `secondaryStrong`.
 * - `quiet`   Secondary Button 238:499 Tone=Subtle 238:495 (white, 1.2 border/handle border). Alias `secondarySubtle`.
 * - `dangerSoft` Secondary Button 238:499 Tone=Strong 238:491 with 21's instance overrides
 *             ("Yes, Cancel Trip" `291:2587`): fill status/danger-soft, strokes removed,
 *             label status/danger-text. Gap 10 like every Secondary Button.
 */
export type MiButtonTone =
  | 'dark'
  | 'primary'
  | 'yellow'
  | 'outline'
  | 'secondaryStrong'
  | 'quiet'
  | 'secondarySubtle'
  | 'dangerSoft';

export type MiButtonProps = {
  label: string;
  onPress?: () => void;
  tone?: MiButtonTone;
  /**
   * Trailing icon ("Show icon" = true on Primary Button). Pass the Figma name —
   * the master's is 'arrow-right' at 24. A legacy icon component is still accepted.
   */
  trailingIcon?: MiLineIconName | IconComponent;
  /** Leading icon ("Show leading icon" = true), e.g. 58's 'message'. */
  leadingIcon?: MiLineIconName;
  /**
   * A leading element of your own, drawn BEFORE the label exactly where `leadingIcon` goes.
   * For a leading glyph that is not a line icon — 35's "Download Receipt" leads with the
   * `download` COLOUR icon at 22, and `MiColorIcon` is a different registry.
   *
   * Mutually exclusive with `leadingIcon`; that one wins if both are given. Additive: omitting
   * both renders exactly as before.
   */
  leadingSlot?: React.ReactNode;
  /** Size of the leading icon box. Default 22 (the master's Leading icon slot). */
  leadingIconSize?: number;
  /** Size of the trailing icon box. Default 24. */
  trailingIconSize?: number;
  /** Default 54 (every screen instance except Home "Book a Tow", which is 50). */
  height?: number;
  /** Default 16. Welcome "Log In" is 24; Home "Book a Tow" is 21. */
  paddingLeft?: number;
  /** Default 16. Welcome "Log In" is 24. */
  paddingRight?: number;
  /** Not drawn in Figma. Shows a spinner in the label colour and blocks presses. */
  loading?: boolean;
  /** Not drawn in Figma. Renders at 50% opacity and blocks presses. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

type ToneSpec = {
  bg: string;
  fg: string;
  labelColor: 'onDark' | 'primary' | 'danger';
  borderWidth: number;
  borderColor?: string;
  gap: number;
  filled: boolean;
};

function toneSpec(tone: MiButtonTone): ToneSpec {
  switch (tone) {
    case 'yellow':
      return {
        bg: mitowColors.brandYellow,
        fg: mitowColors.textPrimary,
        labelColor: 'primary',
        borderWidth: 0,
        gap: 12,
        filled: true,
      };
    case 'outline':
    case 'secondaryStrong':
      return {
        bg: mitowColors.surfacePage,
        fg: mitowColors.textPrimary,
        labelColor: 'primary',
        borderWidth: 1.5,
        borderColor: mitowColors.textPrimary,
        gap: 10,
        filled: false,
      };
    case 'quiet':
    case 'secondarySubtle':
      return {
        bg: mitowColors.surfacePage,
        fg: mitowColors.textPrimary,
        labelColor: 'primary',
        borderWidth: 1.2,
        borderColor: mitowColors.borderHandle,
        gap: 10,
        filled: false,
      };
    case 'dangerSoft':
      return {
        bg: mitowColors.dangerSoft,
        fg: mitowColors.dangerText,
        labelColor: 'danger',
        borderWidth: 0,
        gap: 10,
        filled: false,
      };
    case 'dark':
    case 'primary':
    default:
      return {
        bg: mitowColors.surfaceInverse,
        fg: mitowColors.textOnDark,
        labelColor: 'onDark',
        borderWidth: 0,
        gap: 12,
        filled: true,
      };
  }
}

/**
 * Primary Button (224:10) and Secondary Button (238:499) — radius 14, label
 * MiTow/Strong 16, content centred, gap 12 (primary) / 10 (secondary).
 *
 * The Pressable comes from `usePressablePrimitive()` so press-scale and haptic stay.
 */
export function MiButton({
  label,
  onPress,
  tone = 'dark',
  trailingIcon,
  leadingIcon,
  leadingSlot,
  leadingIconSize = 22,
  trailingIconSize = 24,
  height = mitowLayout.controlHeight,
  paddingLeft = 16,
  paddingRight = 16,
  loading = false,
  disabled = false,
  style,
  accessibilityLabel,
}: MiButtonProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const spec = toneSpec(tone);
  const isDisabled = disabled || loading;

  let trailing: React.ReactNode = null;
  if (typeof trailingIcon === 'string') {
    trailing = <MiLineIcon name={trailingIcon} size={trailingIconSize} color={spec.fg} />;
  } else if (trailingIcon) {
    const Legacy = trailingIcon;
    trailing = (
      <View
        style={{
          width: trailingIconSize,
          height: trailingIconSize,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Legacy size={trailingIconSize} color={spec.fg} strokeWidth={2} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      pressScale={theme.motion.pressScale.button}
      haptic={spec.filled ? 'medium' : 'light'}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        {
          height,
          borderRadius: mitowRadii.button,
          backgroundColor: spec.bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spec.gap,
          paddingLeft,
          paddingRight,
          alignSelf: 'stretch',
          borderWidth: spec.borderWidth,
          borderColor: spec.borderColor,
          opacity: disabled && !loading ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spec.fg} />
      ) : (
        <>
          {leadingIcon ? (
            <MiLineIcon name={leadingIcon} size={leadingIconSize} color={spec.fg} />
          ) : (
            (leadingSlot ?? null)
          )}
          <MiText variant="strong16" color={spec.labelColor} numberOfLines={1}>
            {label}
          </MiText>
          {trailing}
        </>
      )}
    </Pressable>
  );
}
