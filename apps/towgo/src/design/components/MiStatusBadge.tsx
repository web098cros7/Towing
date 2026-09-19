import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { mitowColors } from '../tokens/colors';
import { MiText } from './MiText';

/**
 * Figma Status Badge set `243:832`, property `Status`:
 * - `completed` Status=Completed `243:826`: status/success-soft fill, status/success-text label.
 * - `upcoming`  Status=Upcoming `243:828`: brand/yellow-soft fill, status/warning-text label.
 * - `cancelled` Status=Cancelled `243:830`: status/danger-soft fill, status/danger-text label.
 */
export type MiStatusBadgeStatus = 'completed' | 'upcoming' | 'cancelled';

export type MiStatusBadgeProps = {
  status: MiStatusBadgeStatus;
  /**
   * The label. The component has NO text property: instances override the text layer
   * directly (21's fee badge is Status=Completed with the text "No fee"). Defaults to the
   * variant's own label: "Completed", "Upcoming", "Cancelled".
   */
  label?: string;
  style?: StyleProp<ViewStyle>;
};

const SPEC: Record<MiStatusBadgeStatus, { bg: string; fg: string; label: string }> = {
  completed: { bg: mitowColors.successSoft, fg: mitowColors.successText, label: 'Completed' },
  upcoming: { bg: mitowColors.brandYellowSoft, fg: mitowColors.warningText, label: 'Upcoming' },
  cancelled: { bg: mitowColors.dangerSoft, fg: mitowColors.dangerText, label: 'Cancelled' },
};

/**
 * Status Badge (`243:832`): hugs its label, radius 8, padding 5 top/bottom and 10
 * left/right, no border, no shadow; label MiTow/Chip 13.5, one line. 28 tall
 * (5 + 18 + 5). Not interactive.
 *
 * It hugs along its parent's main axis; the cross axis follows the parent (put it in
 * a row with `alignItems: 'center'`, as 21's fee row does, or pass `alignSelf`).
 */
export function MiStatusBadge({ status, label, style }: MiStatusBadgeProps) {
  const spec = SPEC[status];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderRadius: 8,
          backgroundColor: spec.bg,
        },
        style,
      ]}
    >
      <MiText variant="chip135" numberOfLines={1} style={{ color: spec.fg }}>
        {label ?? spec.label}
      </MiText>
    </View>
  );
}
