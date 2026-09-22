import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon, type MiLineIconName } from '../icons/MiLineIcon';
import { MiColorIcon } from './MiColorIcon';
import { MiText } from './MiText';
import { SlotBar } from './SlotBar';

export type MiSummaryRowProps = {
  /** MiTow/Body S 14, text/secondary ("Pickup", "Drop"). */
  label: string;
  /**
   * Value#224:11. MiTow/Body M 15, text/primary, one line, clipped. `null` holds the line open
   * with a Body M 15 placeholder bar `valueSlotWidth` wide (30 draws every row filled: a value
   * the app does not have yet, e.g. a missing Transaction ID, must not drop the row). A string,
   * even '', renders as text exactly as before.
   */
  value: string | null;
  /**
   * Figma Value box width, used only while `value` is null. Default 159 (30's Date & Time
   * "12 Mar 2025, 10:52 AM"); 30's Payment Method is 25, its Transaction ID 123.
   */
  valueSlotWidth?: number;
  /**
   * Icon#224:12, 28 × 28. A line-icon name (default 'map-pin'; 16, 17, 20, 21) or a colour icon
   * `{ color: 'calendar' }` (30's Date & Time / Payment Method / Transaction ID rows swap the
   * slot to icon/color/*).
   */
  icon?: MiLineIconName | { color: MiColorIconName };
  /** "Show chevron": icon/chevron-right 24. Default false (16/17 have it off). */
  showChevron?: boolean;
  /**
   * Replaces the chevron slot `224:56` (24 box at the right edge, vertically centred; the row's
   * gap 20 sits before it). Takes precedence over `showChevron`. 30's Transaction ID row puts its
   * copy button here (icon/color/copy 24, a direct swap of the nested chevron instance on
   * `245:1068`).
   */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Summary Row (224:50): row, items centred, gap 20; icon 28; text column flex 1,
 * gap 3, clips, single lines (no wrapping, no ellipsis in the design).
 * 30 (`245:1041`, `245:1057`, `245:1068`): colour icons + a trailing copy button.
 * Screen readers read the label and value as one element ("Transaction ID, pay_…"; the label
 * alone while the value is missing); `trailing` stays outside it, separately focusable.
 */
export function MiSummaryRow({
  label,
  value,
  valueSlotWidth = 159,
  icon = 'map-pin',
  showChevron = false,
  trailing,
  style,
}: MiSummaryRowProps) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 20 }, style]}>
      {typeof icon === 'string' ? (
        <MiLineIcon name={icon} size={28} />
      ) : (
        <MiColorIcon name={icon.color} size={28} />
      )}
      <View
        accessible
        accessibilityLabel={value !== null ? `${label}, ${value}` : label}
        style={{ flex: 1, gap: 3, overflow: 'hidden' }}
      >
        <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="clip">
          {label}
        </MiText>
        {value !== null ? (
          <MiText variant="bodyM15" numberOfLines={1} ellipsizeMode="clip">
            {value}
          </MiText>
        ) : (
          <SlotBar variant="bodyM15" width={valueSlotWidth} />
        )}
      </View>
      {trailing ?? (showChevron ? <MiLineIcon name="chevron-right" size={24} /> : null)}
    </View>
  );
}
