import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';
import { MiText } from './MiText';

export type MiServiceCardProps = {
  /** MiTow/Strong 14, text/primary. Verbatim ("Flat Tyre Support", "Tow a Car" …). */
  title: string;
  /** Colour icon drawn 64×64 at the top-left. */
  icon?: MiColorIconName;
  /**
   * Replaces the 64 icon box entirely (e.g. 09's detached "Tow a Car" art, which
   * overflows its 64 box to the right; the Top row clips, the icon box does not).
   */
  iconNode?: React.ReactNode;
  /** Hidden "description" layer. Hidden on every 09 card: do not pass it unless a spec draws it. */
  description?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Service Card (258:1481): white, radius 14, MiTow/Elevation/Card, a 1.2
 * border/subtle stroke that takes NO layout space (drawn as an overlay, so the
 * Top row sits at 10/12 and the card is 117 tall), padding 12 top/bottom, 10
 * left, 8 right, column gap 10. Top row: icon left, icon/chevron-right 20 top-right.
 * Width comes from the caller (09's grid: two `flex: 1` cards, gap 10).
 */
export function MiServiceCard({
  title,
  icon,
  iconNode,
  description,
  onPress,
  style,
}: MiServiceCardProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        {
          backgroundColor: mitowColors.surfacePage,
          borderRadius: mitowRadii.cardSm,
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 10,
          paddingRight: 8,
          gap: 10,
          alignItems: 'flex-start',
          ...mitowShadows.card,
        },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: mitowRadii.cardSm,
          borderWidth: 1.2,
          borderColor: mitowColors.borderSubtle,
        }}
      />
      <View
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          overflow: 'hidden',
        }}
      >
        {iconNode ??
          (icon ? (
            <MiColorIcon name={icon} size={64} />
          ) : (
            <View style={{ width: 64, height: 64 }} />
          ))}
        <MiLineIcon name="chevron-right" size={20} />
      </View>
      <View style={{ alignSelf: 'stretch', gap: 2, overflow: 'hidden' }}>
        <MiText variant="strong14">{title}</MiText>
        {description ? (
          <MiText variant="label13" color="secondary">
            {description}
          </MiText>
        ) : null}
      </View>
    </Pressable>
  );
}
