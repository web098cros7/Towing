import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { mitowColors } from '../tokens/colors';
import { mitowRadii } from '../tokens/layout';
import { MiText } from './MiText';

/**
 * Figma variant of Map Callout (223:41):
 * - 'bottom'     Tail=Bottom 223:29 — 14×10 tail, centred in a row with 20 right padding.
 * - 'bottomLeft' Tail=Bottom Left 223:35 — 16×10.5 tail, 8 in from the left.
 * `center` / `left` are legacy aliases.
 */
export type MiMapCalloutTail = 'bottom' | 'bottomLeft' | 'center' | 'left';

export type MiMapCalloutProps = {
  /** Verbatim copy; put the design's explicit line breaks in as "\n". MiTow/Body XS 13.5, text/on-dark, centred. */
  text: string;
  tail?: MiMapCalloutTail;
  /** Fixed width. Default 110 (master). Pass the spec's instance width (e.g. 148), or 'auto' to hug text. */
  width?: number | 'auto';
  /**
   * Bubble padding top and bottom. Default 8 (master, all four sides). 23's
   * "Driver has arrived" instance `236:393` overrides it to 12.5; the sides stay 8.
   */
  paddingVertical?: number;
  /**
   * Fixed bubble height (tail excluded). Default: hugs the text. 23 draws its bubble at
   * 44: Figma boxes the one 18.5 line as 19, so 12.5 + 19 + 12.5, while RN's hug would
   * give 43.5. The text stays at the top of the content box, as drawn.
   */
  bubbleHeight?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Map Callout: a surface/inverse bubble (radius 10, padding 8) with the tail row
 * overlapping it by 1 (bubble margin-bottom -1). Tails are the exported Figma paths.
 */
export function MiMapCallout({
  text,
  tail = 'bottom',
  width = 110,
  paddingVertical = 8,
  bubbleHeight,
  style,
}: MiMapCalloutProps) {
  const isLeft = tail === 'bottomLeft' || tail === 'left';

  return (
    <View
      style={[{ alignItems: 'flex-start', width: width === 'auto' ? undefined : width }, style]}
    >
      <View
        style={{
          backgroundColor: mitowColors.surfaceInverse,
          borderRadius: mitowRadii.callout,
          paddingHorizontal: 8,
          paddingVertical,
          height: bubbleHeight,
          marginBottom: -1,
          alignSelf: 'stretch',
        }}
      >
        <MiText variant="bodyXS135" color="onDark" align="center">
          {text}
        </MiText>
      </View>
      <View
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          justifyContent: isLeft ? 'flex-start' : 'center',
          paddingLeft: isLeft ? 8 : 0,
          paddingRight: isLeft ? 0 : 20,
        }}
      >
        {isLeft ? (
          <Svg width={16} height={10.5} viewBox="0 0 16 10.5">
            <Path d="M0 0H16L3 10C2.2 10.6 1 10.1 1 9.1L0 0Z" fill={mitowColors.surfaceInverse} />
          </Svg>
        ) : (
          <Svg width={14} height={10} viewBox="0 0 14 10">
            <Path
              d="M0 0H14L8.3 8.9C7.7 9.8 6.3 9.8 5.7 8.9L0 0Z"
              fill={mitowColors.surfaceInverse}
            />
          </Svg>
        )}
      </View>
    </View>
  );
}
