import React from 'react';
import { View } from 'react-native';
import { MiText, mitowColors, type MitowTypeVariant } from '@/design';

/**
 * Holds a dynamic text slot of Figma 18 open while its value is not known yet
 * (the first tracking read) or not provided by the server (data gaps).
 *
 * The design draws every slot filled, so the slot keeps its drawn geometry
 * instead of collapsing: the line height is the real text style's (a single
 * space in the same `MiText` variant, so it scales exactly like the value will),
 * the width is the Figma text box's. A surface/muted bar marks it; no copy is
 * invented and no designed element is dropped.
 */
export function SlotPlaceholder({
  variant,
  width,
}: {
  variant: MitowTypeVariant;
  /** The Figma text box width for this slot. */
  width: number;
}) {
  return (
    <View
      style={{ width, maxWidth: '100%' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <MiText variant={variant} numberOfLines={1}>
        {' '}
      </MiText>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '18%',
          bottom: '18%',
          borderRadius: 4,
          backgroundColor: mitowColors.surfaceMuted,
        }}
      />
    </View>
  );
}
