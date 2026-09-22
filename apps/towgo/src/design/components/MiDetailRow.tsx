import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { MiText } from './MiText';
import { SlotBar } from './SlotBar';

export type MiDetailRowProps = {
  /** Left text. MiTow/Body M 15, text/secondary. Hugs, one line, never shrinks. */
  label: string;
  /**
   * Right text. MiTow/Strong 15, right-aligned, one line. When the row is too narrow it is the
   * value that yields (shrinks, tail ellipsis), never the label (29 Data gaps 9). `null` holds
   * the slot open with a Strong 15 placeholder bar `valueSlotWidth` wide, as 30's Summary Rows
   * do (29's Reason when the gateway gave none, its Reference ID before the booking is read). A
   * string, even '', renders as text exactly as before.
   */
  value: string | null;
  /**
   * Figma value box width, used only while `value` is null. Default 121 (29's Reason "Declined
   * by bank"); 29's Reference ID is 123.
   */
  valueSlotWidth?: number;
  /**
   * Colour of the value. 'primary' text/primary (default); 'danger' status/danger-text #C0343A
   * (29's Reason "Declined by bank"); 'success' status/success-text #237A42 (a credit line).
   */
  valueColor?: 'primary' | 'danger' | 'success';
  style?: StyleProp<ViewStyle>;
};

/**
 * Detail row (29 `292:2723`…`292:2732`, not a Figma component): horizontal, height 20,
 * `space-between`, items centred, gap 12 (the minimum space between label and value). Put it in
 * `<MiCard padding={16} gap={14}>` for 29's card (1.2 + 16 + 4 × 20 + 3 × 14 + 16 + 1.2 = 156.4,
 * as drawn). Read by screen readers as one element, "{label}, {value}" (the label alone while the
 * value is missing). Not pressable. 15's file-private `LineItem`
 * (features/booking/components/FareBreakdownSheet.tsx) is NOT switched to it: `LineItem` lets the
 * LABEL yield and has no 12 gap, so switching would change 15's render whenever a row overflows.
 */
export function MiDetailRow({
  label,
  value,
  valueSlotWidth = 121,
  valueColor = 'primary',
  style,
}: MiDetailRowProps) {
  return (
    <View
      accessible
      accessibilityLabel={value !== null ? `${label}, ${value}` : label}
      style={[
        {
          height: 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        },
        style,
      ]}
    >
      <MiText variant="bodyM15" color="secondary" numberOfLines={1} style={{ flexShrink: 0 }}>
        {label}
      </MiText>
      {value !== null ? (
        <MiText
          variant="strong15"
          color={valueColor}
          align="right"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ flexShrink: 1 }}
        >
          {value}
        </MiText>
      ) : (
        <SlotBar variant="strong15" width={valueSlotWidth} />
      )}
    </View>
  );
}
