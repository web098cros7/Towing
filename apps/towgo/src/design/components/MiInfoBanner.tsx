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
 */
export type MiInfoBannerTone = 'brand' | 'muted';

export type MiInfoBannerProps = {
  /** Colour icon by Figma name (preferred) or a require()d source. Drawn 49×49 by default. */
  icon: MiColorIconName | ImageSourcePropType;
  iconSize?: number;
  /** MiTow/Strong 15.5, text/primary. Copy verbatim from the spec. */
  title: string;
  /** MiTow/Body XS 13.5, text/secondary. Copy verbatim from the spec. */
  subtitle: string;
  tone?: MiInfoBannerTone;
  /** Master "Show chevron": trailing icon/chevron-right 24. Default false; Home 08's banner sets true. */
  showChevron?: boolean;
  /** Makes the whole banner pressable. */
  onPress?: () => void;
  /** Fixed height. Default 67 (master). Screen 18 uses 71.1. */
  height?: number;
  /** Default 8. Screen 18 uses 11. */
  paddingLeft?: number;
  /** Default 8. */
  paddingRight?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * Info Banner (224:14): row, items centred, gap 8, radius 14, no border, no
 * shadow; text column flex 1 with no gap; optional trailing chevron.
 */
export function MiInfoBanner({
  icon,
  iconSize = 49,
  title,
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
      height,
      paddingLeft,
      paddingRight,
      borderRadius: mitowRadii.cardSm,
      backgroundColor: tone === 'brand' ? mitowColors.brandYellowSoft : mitowColors.surfaceMuted,
    },
    style,
  ];

  const content = (
    <>
      <MiColorIcon
        {...(typeof icon === 'string' ? { name: icon } : { source: icon })}
        size={iconSize}
      />
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <MiText variant="strong155">{title}</MiText>
        <MiText variant="bodyXS135" color="secondary">
          {subtitle}
        </MiText>
      </View>
      {showChevron ? <MiLineIcon name="chevron-right" size={24} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={containerStyle}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}. ${subtitle}`}
      style={containerStyle}
    >
      {content}
    </Pressable>
  );
}
