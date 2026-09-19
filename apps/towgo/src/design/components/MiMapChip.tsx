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
  style?: StyleProp<ViewStyle>;
};

/**
 * Map Chip (234:294): white pill, padding 7 vertical / 13 horizontal, gap 6,
 * MiTow/Elevation/Floating, 32 tall. Not interactive.
 */
export function MiMapChip({ label, showIcon = false, style }: MiMapChipProps) {
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
          backgroundColor: mitowColors.surfacePage,
          ...mitowShadows.floating,
        },
        style,
      ]}
    >
      <MiText variant="chip135" numberOfLines={1}>
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
