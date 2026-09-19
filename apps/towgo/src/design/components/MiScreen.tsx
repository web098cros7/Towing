import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { mitowColors } from '../tokens/colors';

export type MiScreenProps = {
  children: React.ReactNode;
  /** Defaults to the design's page white. Login passes the canvas grey. */
  backgroundColor?: string;
  edges?: readonly Edge[];
  /** Pinned below the body — the redesign's CTAs sit at the bottom of the frame. */
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Screen shell for the MiTow redesign.
 *
 * `@towing/ui`'s `Screen` types its `background` as the enum `'surface0' | 'card'`,
 * and `surface0` is #FAFAFA — close enough to read as a bug next to this design's
 * true #FFFFFF, and wrong outright for Login's #F3F6F8. Widening that shared prop
 * for one app's redesign is the worse trade.
 */
export function MiScreen({
  children,
  backgroundColor = mitowColors.surfacePage,
  edges = ['top'],
  footer,
  contentStyle,
}: MiScreenProps) {
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor }}>
      <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      {footer}
    </SafeAreaView>
  );
}
