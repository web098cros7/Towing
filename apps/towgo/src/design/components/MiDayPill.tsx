import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { mitowColors } from '../tokens/colors';
import { mitowRadii } from '../tokens/layout';
import { MiText } from './MiText';
import { useFigmaLineBox } from './useFigmaLineBox';

export type MiDayPillProps = {
  /** The day, e.g. "Today" (the only label the design draws). MiTow/Label 13, text/secondary. */
  label: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Day separator of the chat list. Not a Figma component: frame "Day" `292:2653` → "Pill"
 * `292:2654` on 22, the same frames on 60 (`297:3600`).
 *
 * Renders the full-width Day row (justify centre) holding the pill: hugs, padding 4
 * top/bottom and 10 left/right, surface/muted, radius 999, no border. The label line is
 * boxed at 17 as Figma boxes Label 13, so the pill is 25 tall (57 wide for "Today").
 */
export function MiDayPill({ label, style }: MiDayPillProps) {
  const labelBox = useFigmaLineBox('label13');
  return (
    <View style={[{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center' }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 4,
          paddingHorizontal: 10,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.surfaceMuted,
        }}
      >
        <MiText
          variant="label13"
          color="secondary"
          numberOfLines={1}
          style={{ minHeight: labelBox }}
        >
          {label}
        </MiText>
      </View>
    </View>
  );
}
