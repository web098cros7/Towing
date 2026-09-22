
import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';
import { MiText } from './MiText';

/** Menu Card 253:1137 border: 1.2 border/subtle, stroke INSIDE (no layout space). */
const CARD_BORDER = 1.2;

/**
 * The icon slot: a colour icon by name (58; 26's three contact cards), or any node (26's Share
 * card).
 */
type MiSupportCardLeading =
  | {
      /** icon/color/<name>, drawn 34 × 34 with no background (the Menu Row's Icon#238:21). */
      icon: MiColorIconName;
      leading?: never;
    }
  | {
      /**
       * Replaces the 34 icon slot. 26's "Share My Live Location" (`254:1369`) swaps it to a Map
       * Control `223:24` resized to 34 holding icon/navigation 24:
       * `<MiMapButton icon="navigation" size={34} iconSize={24} accessibilityLabel=""
       *   style={{ pointerEvents: 'none' }} />` (pointer events off so the CARD takes the tap).
       */
      leading: React.ReactNode;
      icon?: never;
    };

export type MiSupportCardProps = MiSupportCardLeading & {
  /** Title#238:18. MiTow/Body M 15, text/primary, one line (shrinks to fit, never wraps). */
  title: string;
  /**
   * Subtitle#238:19. MiTow/Body S 14, text/secondary, one line (shrinks to fit, never wraps).
   * Omit it for "Show subtitle" = false: the text column is then the title alone, the row is
   * 8 + 34 + 8 = 50 tall and the card 60 (27's "Apply Coupon", `253:1153`).
   */
  subtitle?: string;
  /** The whole card is the tap target (card press scale, light haptic). */
  onPress: () => void;
  /**
   * The card surface. 'page' (default): the Menu Card master, surface/page, 1.2 border/subtle
   * INSIDE (drawn as an overlay, no layout space) and MiTow/Elevation/Card (58's five cards; 26's
   * Fire Brigade, MiTow Support and Notify cards). 'muted': 26's Share card `254:1369`, whose
   * instance overrides the fill to surface/muted #F3F5F8 and removes the stroke and the effect.
   */
  surface?: 'page' | 'muted';
  /** Default: the title. */
  accessibilityLabel?: string;
  /**
   * Trailing icon/chevron-right 20. The Menu Card master draws it; 26's "Share My Live Location"
   * (`254:1369`) has NO trailing layer at all, so it sets `showChevron={false}`. 58 keeps the
   * default (true).
   */
  showChevron?: boolean;
  /**
   * Drop shadow. 'card' (default): MiTow/Elevation/Card — 0 1 blur 2, #101828 at 4% (the Menu Card
   * master, 58's five cards). 'cardSm': the same colour/offset but blur 1 — 26's three contact
   * cards (`254:1393`, `409:18846`, `254:1426`) override the effect to a 1px blur on the
   * instance. 'none': no shadow (26's Share card `254:1369`, whose instance removes the effect).
   */
  shadow?: 'card' | 'cardSm' | 'none';
};

/**
 * Menu Card `253:1137` holding ONE Menu Row `238:520` (Show chevron = true, Show subtitle =
 * true): 351 × 66, column, padding 5 top / bottom, radius 14. Row: gap 14, padding 8 / 10 right /
 * 8 / 14 left, items centred; icon 34; text column flex 1, gap 1, clips; chevron-right 20
 * (MiLineIcon keeps the absolute 2.2 stroke). The whole card is the tap target.
 *
 * Moved from 58's `SupportScreen` (where it was the file-private `SupportCard`); 58 renders
 * exactly as before. Shared by 58, 26 and 27 (27's "Add method" `253:1153`, with no subtitle:
 * the same Menu Card, so the whole card presses the same way on all three). `MiMenuCard` +
 * `MiMenuRow` stay for multi-row cards.
 */
export function MiSupportCard({
  icon,
  leading,
  title,
  subtitle,
  onPress,
  surface = 'page',
  accessibilityLabel,
  showChevron = true,
  shadow = 'card',
}: MiSupportCardProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const muted = surface === 'muted';

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={{
        backgroundColor: muted ? mitowColors.surfaceMuted : mitowColors.surfacePage,
        borderRadius: mitowRadii.cardSm,
        paddingVertical: 5,
        ...(shadow === 'card'
          ? mitowShadows.card
          : shadow === 'cardSm'
            ? { boxShadow: '0px 1px 1px 0px rgba(16, 24, 40, 0.04)' }
            : null),
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 14,
          paddingRight: 10,
        }}
      >
        {leading !== undefined ? leading : icon ? <MiColorIcon name={icon} size={34} /> : null}
        {/* Text 238:529: gap 1, clips; title and subtitle are each drawn on ONE line, so the
            card keeps its drawn 66. Where a narrower device column cannot hold a line at
            the scaled size, it shrinks to fit rather than wrapping or dropping words. */}
        <View style={{ flex: 1, gap: 1, overflow: 'hidden' }}>
          <MiText variant="bodyM15" numberOfLines={1} ellipsizeMode="clip" adjustsFontSizeToFit>
            {title}
          </MiText>
          {subtitle ? (
            <MiText
              variant="bodyS14"
              color="secondary"
              numberOfLines={1}
              ellipsizeMode="clip"
              adjustsFontSizeToFit
            >
              {subtitle}
            </MiText>
          ) : null}
        </View>
        {/* icon/chevron-right at 20: MiLineIcon keeps the component's absolute 2.2 stroke. 26's
            Share card has no trailing layer at all. */}
        {showChevron ? (
          <MiLineIcon name="chevron-right" size={20} color={mitowColors.textPrimary} />
        ) : null}
      </View>
      {muted ? null : (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: mitowRadii.cardSm,
            borderWidth: CARD_BORDER,
            borderColor: mitowColors.borderSubtle,
          }}
        />
      )}
    </Pressable>
  );
}
