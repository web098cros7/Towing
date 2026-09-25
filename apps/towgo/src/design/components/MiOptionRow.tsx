import React from 'react';
import { View, type ImageSourcePropType } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';
import { MiText } from './MiText';

export type MiOptionRowProps = {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  /** Leading colour icon, 36×36. Screen 12 has one; screen 11 does not. */
  icon?: MiColorIconName | ImageSourcePropType;
  accessibilityLabel?: string;
  /** Not available yet: dimmed, not pressable (a language without translations). */
  disabled?: boolean;
};

/** Figma Radio inside the option row: 24 box. */
function Radio({ selected }: { selected: boolean }) {
  if (selected) {
    // Disc r=12 brand/yellow, centre dot r=5 text/primary.
    return (
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: mitowColors.brandYellow,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: mitowColors.textPrimary,
          }}
        />
      </View>
    );
  }
  // Ring r=10.2, stroke 1.6 #6B7485 (centred stroke → 22 outer diameter).
  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 1.6,
          borderColor: mitowColors.textPlaceholder,
        }}
      />
    </View>
  );
}

/**
 * Option row of Figma 11 / 12: 60 tall, padding 10 / 16 right / 10 / 14 left,
 * gap 14, radius 14. Unselected surface/page + 1.2 border/subtle; selected
 * brand/yellow-soft + 1.5 brand/yellow. The Figma stroke takes no layout space,
 * so the border is an overlay here and the paddings stay exact.
 */
export function MiOptionRow({
  title,
  subtitle,
  selected,
  onPress,
  icon,
  accessibilityLabel,
  disabled = false,
}: MiOptionRowProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      pressScale={theme.motion.pressScale.card}
      haptic="selection"
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        height: mitowLayout.optionRowHeight,
        paddingLeft: 14,
        paddingRight: 16,
        paddingVertical: 10,
        borderRadius: mitowRadii.cardSm,
        backgroundColor: selected ? mitowColors.brandYellowSoft : mitowColors.surfacePage,
        opacity: disabled ? 0.5 : 1,
      }}
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
          borderWidth: selected ? 1.5 : 1.2,
          borderColor: selected ? mitowColors.brandYellow : mitowColors.borderSubtle,
        }}
      />

      {icon ? (
        typeof icon === 'string' ? (
          <MiColorIcon name={icon as MiColorIconName} size={36} />
        ) : (
          <MiColorIcon source={icon} size={36} />
        )
      ) : null}

      <View style={{ flex: 1, gap: 1, overflow: 'hidden' }}>
        <MiText variant="bodyM15" numberOfLines={1} ellipsizeMode="clip">
          {title}
        </MiText>
        {subtitle ? (
          <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="clip">
            {subtitle}
          </MiText>
        ) : null}
      </View>

      <Radio selected={selected} />
    </Pressable>
  );
}
