import React from 'react';
import { View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowRadii } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';
import { MiText } from './MiText';

/**
 * Fill of the banner.
 * - `brand` brand/yellow-soft #FDF6DC (master default; 08, 09, 16, 18, 58).
 * - `muted` surface/muted #F3F5F8 (17 "No drivers available").
 * - `success` status/success-soft #E4F5E9 (30 "Secure Payment" `245:1078`, a fill override on the
 *   instance).
 * - `danger` status/danger-soft #FDECEC (26 "Need Immediate Help?" `254:1337`, a fill override on
 *   the instance).
 */
export type MiInfoBannerTone = 'brand' | 'muted' | 'success' | 'danger';

const TONE_FILL: Record<MiInfoBannerTone, string> = {
  brand: mitowColors.brandYellowSoft,
  muted: mitowColors.surfaceMuted,
  success: mitowColors.successSoft,
  danger: mitowColors.dangerSoft,
};

export type MiInfoBannerProps = {
  /** Colour icon by Figma name (preferred) or a require()d source. Drawn 49×49 by default. */
  icon: MiColorIconName | ImageSourcePropType;
  /** Drawn in place of `icon` (an animated icon); `icon` still names it for the record. */
  iconNode?: React.ReactNode;
  iconSize?: number;
  /**
   * MiTow/Strong 15.5 (or `titleVariant`), text/primary. Copy verbatim from the spec. Omit it and
   * NO title node is rendered (26's Tip `254:1443` has no title layer at all; an empty string
   * would still take a line in RN).
   */
  title?: string;
  /**
   * Text style of the title. Default 'strong155' (the master). 26's Emergency alert and 58's Help
   * banner set their title in MiTow/Title 20: 'title20'.
   */
  titleVariant?: 'strong155' | 'title20';
  /** MiTow/Body XS 13.5, text/secondary. Copy verbatim from the spec. */
  subtitle: string;
  tone?: MiInfoBannerTone;
  /** Master "Show chevron": trailing icon/chevron-right 24. Default false; Home 08's banner sets true. */
  showChevron?: boolean;
  /** Makes the whole banner pressable. */
  onPress?: () => void;
  /** Fixed height. Default 67 (master). Screen 18 uses 71.1. */
  /** Fixed height, or 'auto' to grow with the text (at least 67). */
  height?: number | 'auto';
  /** Default 8. Screen 18 uses 11. */
  paddingLeft?: number;
  /** Default 8. */
  paddingRight?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * Pressable banner: the button's label (default "{title}. {subtitle}"). Static banner: when set,
   * the banner is read as ONE element with this label (58's Help banner, 26's alert and Tip).
   */
  accessibilityLabel?: string;
};

/**
 * Info Banner (224:14): row, items centred, gap 8, radius 14, no border, no
 * shadow; text column flex 1 with no gap; optional trailing chevron.
 * Tones and title variants reproduce instance overrides: 29 'Your trip is safe' is the plain
 * master at height 85; 30 is tone 'success' at 71 with the green-shield asset (`MiColorIcon` name
 * 'verified-success'); 26's alert is tone 'danger' + titleVariant 'title20' at 106; 26's Tip is
 * tone 'muted', no title, at 62; 58's Help banner is titleVariant 'title20' at 98.
 */
export function MiInfoBanner({
  icon,
  iconNode,
  iconSize = 49,
  title,
  titleVariant = 'strong155',
  subtitle,
  tone = 'brand',
  showChevron = false,
  onPress,
  height = 67,
  paddingLeft = 8,
  paddingRight = 8,
  style,
  accessibilityLabel,
}: MiInfoBannerProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  const containerStyle: StyleProp<ViewStyle> = [
    {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      ...(height === 'auto' ? { minHeight: 67, paddingVertical: 10 } : { height }),
      paddingLeft,
      paddingRight,
      borderRadius: mitowRadii.cardSm,
      backgroundColor: TONE_FILL[tone],
    },
    style,
  ];

  const content = (
    <>
      {iconNode ?? (
        <MiColorIcon
          {...(typeof icon === 'string' ? { name: icon } : { source: icon })}
          size={iconSize}
        />
      )}
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {title ? <MiText variant={titleVariant}>{title}</MiText> : null}
        <MiText variant="bodyXS135" color="secondary">
          {subtitle}
        </MiText>
      </View>
      {showChevron ? <MiLineIcon name="chevron-right" size={24} /> : null}
    </>
  );

  if (!onPress) {
    if (accessibilityLabel) {
      return (
        <View accessible accessibilityLabel={accessibilityLabel} style={containerStyle}>
          {content}
        </View>
      );
    }
    return <View style={containerStyle}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (title ? `${title}. ${subtitle}` : subtitle)}
      style={containerStyle}
    >
      {content}
    </Pressable>
  );
}
