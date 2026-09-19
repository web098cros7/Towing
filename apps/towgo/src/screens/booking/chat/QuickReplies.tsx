import React from 'react';
import { ScrollView } from 'react-native';
import { MiChip, mitowLayout } from '@/design';

/**
 * Figma 22's three quick replies (`292:2684`, `292:2686`, `292:2688`), verbatim
 * static app copy. "I'm" uses the straight apostrophe U+0027. Whether they should
 * change with the trip status is open (22 Data gap 10).
 */
export const QUICK_REPLIES = ["I'm at the pickup point", 'Please call me', 'Running 5 mins late'] as const;

/**
 * Quick replies `292:2683`: 393 wide, padding 21 left and right, gap 8, items
 * centred, no fill; three Chips (State=Default, 36.4 tall). The frame clips its
 * 497.2-wide content, so it scrolls horizontally, starting at offset 0 with the
 * third chip cut at the screen edge as drawn. No scroll indicator and no edge fade.
 *
 * A tap sends the chip's label at once (22 Decision 2); the input is left alone.
 */
export function QuickReplies({ onSend }: { onSend: (text: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{
        paddingHorizontal: mitowLayout.sideMargin,
        gap: 8,
        alignItems: 'center',
      }}
    >
      {QUICK_REPLIES.map((label) => (
        <MiChip key={label} label={label} onPress={() => onSend(label)} />
      ))}
    </ScrollView>
  );
}
