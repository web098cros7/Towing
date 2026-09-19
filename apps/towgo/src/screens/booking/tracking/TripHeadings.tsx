import React from 'react';
import { View } from 'react-native';
import { MiText } from '@/design';
import { SlotPlaceholder } from './SlotPlaceholder';

/**
 * The static sheet heading of 19 · Driver Arriving (`254:1456`) and 23 · Driver
 * Arrived (`236:334`): the same frame as 18's (`226:319`), left padding 3.7,
 * gap 2.9, clips; Title 23 over Body M 15 secondary, each one auto-width line
 * (clipped, 18's convention). Unlike 18 there is no ETA in it: both titles are
 * static copy.
 */
export function StaticTripHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View
      style={{ paddingLeft: 3.7, gap: 2.9, overflow: 'hidden' }}
      accessible
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <MiText variant="title23" numberOfLines={1} ellipsizeMode="clip">
        {title}
      </MiText>
      <MiText variant="bodyM15" color="secondary" numberOfLines={1} ellipsizeMode="clip">
        {subtitle}
      </MiText>
    </View>
  );
}

/** Figma 24 copy, verbatim; the subtitle's only data is the driver's first name. */
const CODE_TITLE = 'Your driver has arrived';
const codeSubtitle = (firstName: string) => `Share this code so ${firstName} can start your tow.`;
/** The subtitle's Figma text box fills the 351 content width. */
const CODE_SUBTITLE_BOX_WIDTH = 351;

/**
 * 24 · Collection Code heading `299:4131`: a different frame from 18/19/23's,
 * no padding, gap 4, no clip, and both texts fill the width with auto height,
 * so they wrap rather than clip (no `numberOfLines`). Before the driver's name
 * is known the subtitle keeps its line with a placeholder bar.
 */
export function CodeHeading({ firstName }: { firstName: string | null }) {
  const subtitle = firstName ? codeSubtitle(firstName) : null;
  return (
    <View
      style={{ gap: 4 }}
      accessible
      accessibilityLabel={subtitle ? `${CODE_TITLE}. ${subtitle}` : CODE_TITLE}
    >
      <MiText variant="title23">{CODE_TITLE}</MiText>
      {subtitle ? (
        <MiText variant="bodyM15" color="secondary">
          {subtitle}
        </MiText>
      ) : (
        <SlotPlaceholder variant="bodyM15" width={CODE_SUBTITLE_BOX_WIDTH} />
      )}
    </View>
  );
}
