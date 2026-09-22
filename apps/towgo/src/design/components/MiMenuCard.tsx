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
import { SlotBar } from './SlotBar';

export type MiMenuRowProps = {
  /**
   * Leading icon, 34×34 (Figma "Icon" swap). Either a colour icon
   * (`{ color: 'map' }`), a line icon (`{ line: 'calendar' }`), or a legacy
   * require()d image source.
   *
   * `null` keeps the icon's drawn BOX empty: the server did not say which icon this row wears
   * (35's "Paid via …" when the payment method is unknown), and an empty slot at the right size
   * is better than a glyph that names the wrong thing.
   */
  icon: { color: MiColorIconName } | { line: MiLineIconName } | ImageSourcePropType | null;
  /** Icon box size. Default 34 (master). 35's Payment row (`245:982`) draws it at 34 too. */
  iconSize?: number;
  /**
   * MiTow/Body M 15, text/primary. `null` holds the line open with a placeholder bar
   * `titleSlotWidth` wide when one is given (or `'fill'` for the drawn `w-full` box); omitted, a
   * missing title is not drawn.
   */
  title: string | null;
  /** Figma width of the Title text box, used only while `title` is missing. `'fill'` = `w-full`. */
  titleSlotWidth?: number | 'fill';
  /** "Show subtitle": MiTow/Body S 14, text/secondary. Omit to hide. */
  subtitle?: string | null;
  /** Figma width of the Subtitle text box, used only while `subtitle` is missing. `'fill'` = `w-full`. */
  subtitleSlotWidth?: number | 'fill';
  /** "Show value": MiTow/Strong 16 trailing text (e.g. "₹1,200"). */
  value?: string | null;
  /** Figma width of the Value text box, used only while `value` is missing. `'fill'` = `w-full`. */
  valueSlotWidth?: number | 'fill';
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
  titleSlotWidth,
  subtitle,
  subtitleSlotWidth,
  value,
  valueSlotWidth,
  showChevron = false,
  trailing,
  onPress,
  accessibilityLabel,
}: MiMenuRowProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  let leading: React.ReactNode;
  if (icon === null) {
    // The drawn box, left empty. No glyph, because a wrong one is worse than none.
    leading = <View style={{ width: iconSize, height: iconSize }} />;
  } else if (isIconObject(icon)) {
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
        {title ? (
          <MiText variant="bodyM15">{title}</MiText>
        ) : titleSlotWidth !== undefined ? (
          <SlotBar variant="bodyM15" width={titleSlotWidth} />
        ) : null}
        {subtitle ? (
          <MiText variant="bodyS14" color="secondary">
            {subtitle}
          </MiText>
        ) : subtitleSlotWidth !== undefined ? (
          <SlotBar variant="bodyS14" width={subtitleSlotWidth} />
        ) : null}
      </View>
      {value ? (
        <MiText variant="strong16" numberOfLines={1}>
          {value}
        </MiText>
      ) : valueSlotWidth !== undefined ? (
        <SlotBar variant="strong16" width={valueSlotWidth} />
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
      accessibilityLabel={
        accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : (title ?? ''))
      }
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
  /**
   * Where the 1.2 border/subtle stroke sits. Default true: an RN border, which takes layout
   * space (today's render; 06 and 10 keep it). false: Figma's INSIDE stroke that is NOT in
   * layout, drawn as an absolute overlay above the rows, so the paddings measure from the outer
   * edge as in the master: a one-row card is 5 + 50 + 5 = 60 tall, with the icon at x 14 and the
   * chevron's right edge 10 from the card edge. No screen passes it today: 27's "Add method"
   * card (`253:1153`), which it was added for, renders through `MiSupportCard` (the Menu Card
   * with the same inside stroke) so that it presses like 58's and 26's cards.
   */
  borderInLayout?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Menu Card (253:1137): surface/page, 1.2 border/subtle, MiTow/Elevation/Card,
 * vertical, no gap. Auto-inserts 1px dividers (inset 62, running to the inner
 * right edge) between its MiMenuRow children; none after the last row.
 * `borderInLayout={false}` draws the stroke as Figma does (INSIDE, no layout space).
 */
export function MiMenuCard({
  children,
  radius = mitowRadii.cardSm,
  paddingVertical = 5,
  dividerInset = 62,
  dividers = true,
  borderInLayout = true,
  style,
}: MiMenuCardProps) {
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View
      style={[
        {
          backgroundColor: mitowColors.surfacePage,
          borderRadius: radius,
          ...(borderInLayout ? { borderWidth: 1.2, borderColor: mitowColors.borderSubtle } : null),
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
      {borderInLayout ? null : (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: radius,
            borderWidth: 1.2,
            borderColor: mitowColors.borderSubtle,
          }}
        />
      )}
    </View>
  );
}
