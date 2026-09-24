import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';
import { MiText } from './MiText';

export type MiMapChipProps = {
  /** Verbatim, e.g. "Your location". MiTow/Chip 13.5, text/primary, no wrap. */
  label: string;
  /** Master "Show icon": the 20×20 trailing arrow drawn in the component. Default false. */
  showIcon?: boolean;
  /**
   * Minimum width of the LABEL's box. Omit to hug the text (the master's own auto width).
   * 35's "View on Map" (`I245:902;234:295`) draws it at 81 inside a 133-wide chip.
   *
   * A MINIMUM rather than a fixed width, deliberately: the master lets a label run past its box
   * rather than clip (Whitespace=nowrap, no overflow rule), and a fixed box would cut the label
   * off at the 1.2× accessibility font cap. So the chip is exactly the drawn 133 at normal
   * sizes and grows instead of truncating at larger ones.
   */
  labelMinWidth?: number;
  /**
   * 'pickup' is the green "Pickup Point" chip with white text (owner decision,
   * 24 Sep 2026, after Rapido's): the one place the customer's pickup is named
   * on a map. Default: the white master.
   */
  tone?: 'default' | 'pickup';
  style?: StyleProp<ViewStyle>;
};

/** The pickup green the booking map's pin uses (`RoutePin`). */
const PICKUP_GREEN = '#1E9E5A';

/**
 * Map Chip (234:294): white pill, padding 7 vertical / 13 horizontal, gap 6,
 * MiTow/Elevation/Floating, 32 tall. Not interactive.
 */
export function MiMapChip({
  label,
  showIcon = false,
  labelMinWidth,
  tone = 'default',
  style,
}: MiMapChipProps) {
  const pickup = tone === 'pickup';
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          alignSelf: 'flex-start',
          gap: 6,
          paddingVertical: 7,
          paddingHorizontal: 13,
          borderRadius: mitowRadii.pill,
          backgroundColor: pickup ? PICKUP_GREEN : mitowColors.surfacePage,
          ...mitowShadows.floating,
        },
        style,
      ]}
    >
      <MiText
        variant="chip135"
        numberOfLines={1}
        color={pickup ? 'onDark' : undefined}
        style={labelMinWidth ? { minWidth: labelMinWidth } : undefined}
      >
        {label}
      </MiText>
      {showIcon ? (
        <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
          <Path
            d="M3.75 10H15.8333M11 14.8333L15.8333 10L11 5.16667"
            stroke={mitowColors.textPrimary}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}
