import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { mitowColors, mitowRadii, MiText } from '@/design';

/**
 * Figma 17's "No tow trucks nearby" callout `372:18870`: an instance of Map
 * Callout `223:41`, variant Tail=Bottom Left `223:35`.
 *
 * Built here rather than with `MiMapCallout` because the instance clips its
 * bubble (`I372:18870;223:36`, overflow clipped) and the shared component does
 * not; everything else is the same Figma geometry.
 *
 * Position: x 123, y 170, 148 × 44.5 on the 393 frame. Its centre (197) sits
 * half a point right of the screen's centre line (196.5), so it is placed from
 * the centre with that half point kept: exactly x 123 at 393 wide, and still
 * centred the same way on other widths. The top is the drawn 170 on every
 * screen height (the design attaches it to no map coordinate, so it is a fixed
 * overlay, not a map marker). Not interactive.
 */

/** Instance width. */
const CALLOUT_WIDTH = 148;
/** Drawn y on the 852 frame. */
const CALLOUT_TOP = 170;
/** Drawn x 123 = screen centre 196.5 − 73.5. */
const CALLOUT_OFFSET_FROM_CENTRE = -73.5;
/** Bubble padding on all four sides. */
const BUBBLE_PADDING = 8;
/** Tail frame `I372:18870;223:39` and its inset inside the tail row. */
const TAIL_WIDTH = 16;
const TAIL_HEIGHT = 10.5;
const TAIL_INSET = 8;

export function NoTrucksCallout() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: CALLOUT_TOP,
        left: '50%',
        marginLeft: CALLOUT_OFFSET_FROM_CENTRE,
        width: CALLOUT_WIDTH,
        // Vertical auto layout, items start, item spacing -1 (see the tail row).
        alignItems: 'flex-start',
      }}
    >
      {/* Bubble: surface/inverse, radius 10, padding 8, overflow clipped. */}
      <View
        style={{
          alignSelf: 'stretch',
          padding: BUBBLE_PADDING,
          borderRadius: mitowRadii.callout,
          backgroundColor: mitowColors.surfaceInverse,
          overflow: 'hidden',
        }}
      >
        <MiText variant="bodyXS135" color="onDark" align="center">
          No tow trucks nearby
        </MiText>
      </View>

      {/* Tail row: full width, padding-left 8, clipped; starts 1 pt inside the bubble. */}
      <View
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          marginTop: -1,
          paddingLeft: TAIL_INSET,
          overflow: 'hidden',
        }}
      >
        <Svg width={TAIL_WIDTH} height={TAIL_HEIGHT} viewBox={`0 0 ${TAIL_WIDTH} ${TAIL_HEIGHT}`}>
          <Path d="M0 0H16L3 10C2.2 10.6 1 10.1 1 9.1L0 0Z" fill={mitowColors.surfaceInverse} />
        </Svg>
      </View>
    </View>
  );
}
