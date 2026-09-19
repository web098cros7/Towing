import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { MiLineIcon, type MiLineIconName } from '../icons/MiLineIcon';
import { MiText } from './MiText';

export type MiSummaryRowProps = {
  /** MiTow/Body S 14, text/secondary ("Pickup", "Drop"). */
  label: string;
  /** MiTow/Body M 15, text/primary. */
  value: string;
  /** Line icon at 28. Default 'map-pin'. */
  icon?: MiLineIconName;
  /** "Show chevron": icon/chevron-right 24. Default false (16/17 have it off). */
  showChevron?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Summary Row (224:50): row, items centred, gap 20; icon 28; text column flex 1,
 * gap 3, clips, single lines (no wrapping, no ellipsis in the design).
 */
export function MiSummaryRow({
  label,
  value,
  icon = 'map-pin',
  showChevron = false,
  style,
}: MiSummaryRowProps) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 20 }, style]}>
      <MiLineIcon name={icon} size={28} />
      <View style={{ flex: 1, gap: 3, overflow: 'hidden' }}>
        <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="clip">
          {label}
        </MiText>
        <MiText variant="bodyM15" numberOfLines={1} ellipsizeMode="clip">
          {value}
        </MiText>
      </View>
      {showChevron ? <MiLineIcon name="chevron-right" size={24} /> : null}
    </View>
  );
}
