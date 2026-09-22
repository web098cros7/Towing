import React from 'react';
import { View } from 'react-native';
import { mitowColors } from '../tokens/colors';
import type { MitowTypeVariant } from '../tokens/type';
import { MiText } from './MiText';

export type SlotBarProps = {
  /**
   * The MiTow text style of the value this slot stands for; the bar takes that style's line
   * height, so it scales exactly like the value will. Default 'bodyS14'.
   */
  variant?: MitowTypeVariant;
  /**
   * The Figma text box width of the slot, in pt — or `'fill'` for a slot whose drawn text is
   * `w-full` (a Menu Row's title or subtitle, which fills its `flex: 1` column). The bar then
   * stretches to the parent, which must be able to constrain it; see the note below.
   */
  width: number | 'fill';
};

/**
 * Holds a dynamic text slot open while its value is unknown or not provided by the server:
 * 18's `SlotPlaceholder` look (`screens/booking/tracking/SlotPlaceholder.tsx`), inlined so the
 * design layer never imports from a screen. A single space in the real text style gives the
 * line height; the Figma text box gives the width; a surface/muted bar (radius 4, inset 18 %
 * top and bottom) marks it. No copy is invented and no designed element is dropped. Internal
 * to the design layer: NOT exported from `@/design` (screens keep using `SlotPlaceholder`).
 *
 * THE BAR FILLS THE SLOT, SO IT MUST SIT IN A BOX THAT CAN CONSTRAIN IT. In a `flex: 1` text
 * column of a `numberOfLines={1}` line, that box is the column: give the cell `alignSelf:
 * 'stretch'` (or let it stretch) so the cell measures to the column rather than to a `flex: 1`
 * child with no intrinsic width of its own.
 */
export function SlotBar({ variant = 'bodyS14', width }: SlotBarProps) {
  const fill = width === 'fill';
  return (
    <View
      style={
        fill
          ? { alignSelf: 'stretch', maxWidth: '100%' }
          : { width: width as number, maxWidth: '100%' }
      }
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
