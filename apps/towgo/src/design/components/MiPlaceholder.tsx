import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { mitowColors } from '../tokens/colors';
import { MiText } from './MiText';

export type MiPlaceholderProps = {
  /** Default 'Placeholder'. Pass null to hide the label ("Show label" = false). */
  label?: string | null;
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Placeholder (234:258): surface/muted fill, 1.5 dashed border/handle border,
 * radius 12, centred MiTow/Label 13 text/placeholder label. Default 120×80.
 * Only for an element the design itself draws as a Placeholder.
 */
export function MiPlaceholder({
  label = 'Placeholder',
  width = 120,
  height = 80,
  radius = 12,
  style,
}: MiPlaceholderProps) {
  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: mitowColors.surfaceMuted,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: mitowColors.borderHandle,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {label ? (
        <MiText variant="label13" color="placeholder" align="center" numberOfLines={1}>
          {label}
        </MiText>
      ) : null}
    </View>
  );
}
