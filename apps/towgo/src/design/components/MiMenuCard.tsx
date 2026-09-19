import React from 'react';
import { View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon, type MiLineIconName } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';
import { MiText } from './MiText';

export type MiMenuRowProps = {
  /**
   * Leading icon, 34×34 (Figma "Icon" swap). Either a colour icon
   * (`{ color: 'map' }`), a line icon (`{ line: 'calendar' }`), or a legacy
   * require()d image source.
   */
  icon: { color: MiColorIconName } | { line: MiLineIconName } | ImageSourcePropType;
  /** Icon box size. Default 34 (master). */
  iconSize?: number;
  /** MiTow/Body M 15, text/primary. */
  title: string;
  /** "Show subtitle": MiTow/Body S 14, text/secondary. Omit to hide. */
  subtitle?: string;
  /** "Show value": MiTow/Strong 16 trailing text (e.g. "₹1,200"). */
  value?: string;
  /**
   * "Show chevron": trailing icon/chevron-right at 20. The MASTER default is true,
   * but 06 Consent and 10 Saved & Recent turn it OFF. Default here: false — set
   * it from your spec.
   */
  showChevron?: boolean;
  /** Custom trailing element (e.g. a Toggle), placed before the chevron. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
};

function isIconObject(
  icon: MiMenuRowProps['icon'],
): icon is { color: MiColorIconName } | { line: MiLineIconName } {
  return typeof icon === 'object' && icon !== null && ('color' in icon || 'line' in icon);
}

/**
 * Menu Row (238:520): row, items centred, gap 14, padding 8 top/bottom, 14 left,
 * 10 right; text column flex 1 with gap 1. No fill or border of its own.
 */
export function MiMenuRow({
  icon,
  iconSize = 34,
  title,
  subtitle,
  value,
  showChevron = false,
  trailing,
  onPress,
  accessibilityLabel,
}: MiMenuRowProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  let leading: React.ReactNode;
  if (isIconObject(icon)) {
    leading =
      'color' in icon ? (
        <MiColorIcon name={icon.color} size={iconSize} />
      ) : (
        <MiLineIcon name={icon.line} size={iconSize} />
      );
  } else {
    leading = <MiColorIcon source={icon} size={iconSize} />;
  }

  const rowStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 8,
  };

  const content = (
    <>
      {leading}
      <View style={{ flex: 1, gap: 1, overflow: 'hidden' }}>
        <MiText variant="bodyM15">{title}</MiText>
        {subtitle ? (
          <MiText variant="bodyS14" color="secondary">
            {subtitle}
          </MiText>
        ) : null}
      </View>
      {value ? (
        <MiText variant="strong16" numberOfLines={1}>
          {value}
        </MiText>
      ) : null}
      {trailing}
      {showChevron ? <MiLineIcon name="chevron-right" size={20} /> : null}
    </>
  );

  if (!onPress) return <View style={rowStyle}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.row}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)}
      style={rowStyle}
    >
      {content}
    </Pressable>
  );
}

export type MiMenuCardProps = {
  children: React.ReactNode;
  /**
   * Corner radius. Master Menu Card 253:1137 = 14. Instances on 06 Consent and
   * 10 Saved & Recent = 16. Default 14 — pass what your spec says.
   */
  radius?: number;
  /** Top/bottom padding. Master = 5; 06 and 10 = 4. Default 5. */
  paddingVertical?: number;
  /** Divider left inset (a 1px border/subtle line). Default 62 (14 + 34 + 14). */
  dividerInset?: number;
  /** Draw dividers between rows. Default true. */
  dividers?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Menu Card (253:1137): surface/page, 1.2 border/subtle, MiTow/Elevation/Card,
 * vertical, no gap. Auto-inserts 1px dividers (inset 62, running to the inner
 * right edge) between its MiMenuRow children; none after the last row.
 */
export function MiMenuCard({
  children,
  radius = mitowRadii.cardSm,
  paddingVertical = 5,
  dividerInset = 62,
  dividers = true,
  style,
}: MiMenuCardProps) {
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View
      style={[
        {
          backgroundColor: mitowColors.surfacePage,
          borderRadius: radius,
          borderWidth: 1.2,
          borderColor: mitowColors.borderSubtle,
          paddingVertical,
          ...mitowShadows.card,
        },
        style,
      ]}
    >
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {child}
          {dividers && i < items.length - 1 ? (
            <View
              style={{
                height: 1,
                backgroundColor: mitowColors.borderSubtle,
                marginLeft: dividerInset,
              }}
            />
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}
