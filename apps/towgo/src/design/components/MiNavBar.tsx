import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon } from '../icons/MiLineIcon';
import { mitowLayout } from '../tokens/layout';
import { MiHelpChip } from './MiHelpChip';
import { MiText } from './MiText';

export type MiNavBarProps = {
  /** Back action for the icon/chevron-left (24, stroke 2.4) at the leading slot's left edge. */
  onBack?: () => void;
  /** MiTow/Heading 18, centred between leading and trailing. Omit (or ' ') for no visible title (screen 04). */
  title?: string;
  /**
   * Figma variant. 'none' = Trailing=None 258:1418 (leading slot 70, empty 70 trailing slot).
   * 'help' = Trailing=Help 258:1424 (leading slot 58, Help chip with 12 side padding).
   */
  trailing?: 'none' | 'help';
  /** Help chip press (trailing='help'). Must open the root 'Support' route. */
  onHelp?: () => void;
  /** @deprecated Legacy free-form trailing slot (70 wide). Not a Figma variant. */
  right?: React.ReactNode;
  /** Hide the chevron (keeps the slot). Not used by any MiTow screen. */
  hideBack?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Nav Bar (component set 258:1437): a 46-tall row, full content width (351 at
 * side margin 21), items centred, no gap, no fill.
 */
export function MiNavBar({
  onBack,
  title,
  trailing = 'none',
  onHelp,
  right,
  hideBack = false,
  style,
}: MiNavBarProps) {
  const Pressable = usePressablePrimitive();
  const isHelp = trailing === 'help';

  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', height: mitowLayout.navBarHeight },
        style,
      ]}
    >
      <View
        style={{ width: isHelp ? 58 : 70, height: 46, flexDirection: 'row', alignItems: 'center' }}
      >
        {hideBack ? null : (
          <Pressable
            onPress={onBack}
            pressScale={0.9}
            haptic="light"
            hitSlop={{ top: 11, bottom: 11, left: 21, right: 22 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={{ width: 24, height: 24 }}
          >
            <MiLineIcon name="chevron-left" size={24} />
          </Pressable>
        )}
      </View>

      <MiText variant="heading18" align="center" numberOfLines={1} style={{ flex: 1 }}>
        {title && title.trim() ? title : ''}
      </MiText>

      {isHelp ? (
        <MiHelpChip onPress={onHelp} paddingHorizontal={12} />
      ) : (
        <View style={{ width: 70, height: 46, alignItems: 'flex-end', justifyContent: 'center' }}>
          {right}
        </View>
      )}
    </View>
  );
}
