import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors } from '../tokens/colors';
import { mitowLayout, mitowRadii, mitowShadows } from '../tokens/layout';
import { MiModalFrame } from './MiModalFrame';

/** Sheet grabber: a full-width row holding a centred 36×5 bar, radius 2.5, border/handle. */
export function MiSheetHandle({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ alignSelf: 'stretch', alignItems: 'center' }, style]}>
      <View
        style={{
          width: mitowLayout.handle.width,
          height: mitowLayout.handle.height,
          borderRadius: mitowLayout.handle.height / 2,
          backgroundColor: mitowColors.borderHandle,
        }}
      />
    </View>
  );
}

export type MiSheetPanelProps = {
  children: React.ReactNode;
  /** Draw MiSheetHandle as the first child. Default true. */
  showHandle?: boolean;
  /** Default 14. Home 08 = 10.3; 13 Pick on Map bottom card = 20. */
  paddingTop?: number;
  /** Default 21. Home 08 = 22.4. */
  paddingLeft?: number;
  /** Default 21. Home 08 = 20.9. */
  paddingRight?: number;
  /**
   * Default 34 — the design's bottom padding, which IS the home-indicator zone
   * of the 852 frame. The rendered value is max(this, safe-area bottom inset)
   * unless `addSafeArea` is false. Home 08 = 0 (its tab bar sits inside).
   */
  paddingBottom?: number;
  /** Use max(paddingBottom, insets.bottom). Default true. */
  addSafeArea?: boolean;
  /** Gap between children. Default 16. Home 08 = 12. */
  gap?: number;
  /**
   * Wrap children (after the handle) in a ScrollView for short devices. Default false. The panel
   * and the ScrollView may shrink (flexShrink 1), so a sheet taller than its space scrolls; when
   * the content fits, nothing shrinks and the panel hugs it exactly as before.
   */
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The white bottom panel itself, NOT modal: surface/page, top corners 24,
 * MiTow/Elevation/Sheet, vertical stack. Use it for the in-screen sheets on
 * Home (08), Book a Tow (14), Searching (16/17), Driver En Route (18) and the
 * Pick on Map bottom card (13, showHandle={false} paddingTop={20}). The caller
 * positions it (usually absolute, bottom 0, left 0, right 0).
 */
export function MiSheetPanel({
  children,
  showHandle = true,
  paddingTop = mitowLayout.sheetPadTop,
  paddingLeft = mitowLayout.sideMargin,
  paddingRight = mitowLayout.sideMargin,
  paddingBottom = mitowLayout.sheetPadBottom,
  addSafeArea = true,
  gap = mitowLayout.blockGap,
  scrollable = false,
  style,
}: MiSheetPanelProps) {
  const insets = useSafeAreaInsets();
  const padBottom = addSafeArea ? Math.max(insets.bottom, paddingBottom) : paddingBottom;

  return (
    <View
      style={[
        {
          flexShrink: 1,
          backgroundColor: mitowColors.surfacePage,
          borderTopLeftRadius: mitowRadii.sheet,
          borderTopRightRadius: mitowRadii.sheet,
          paddingTop,
          paddingLeft,
          paddingRight,
          paddingBottom: padBottom,
          gap,
          ...mitowShadows.sheet,
        },
        style,
      ]}
    >
      {showHandle ? <MiSheetHandle /> : null}
      {scrollable ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ gap }}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );
}

export type MiSheetProps = Omit<MiSheetPanelProps, 'style'> & {
  visible: boolean;
  /** Android back / programmatic close. */
  onClose: () => void;
  /** Wrap the panel in a KeyboardAvoidingView (sheets with a text field, e.g. 12). Default false. */
  avoidKeyboard?: boolean;
  /**
   * Tapping the Dim. The design does not specify tap-outside behaviour, so the
   * default is no-op; pass `onClose` here only if your spec says so.
   */
  onBackdropPress?: () => void;
  accessibilityLabel?: string;
  panelStyle?: StyleProp<ViewStyle>;
};

/**
 * A modal bottom sheet (07, 11, 12, 15): the Figma "Dim" (surface/inverse at 45%
 * over the WHOLE frame, status bar strip included) with MiSheetPanel anchored to
 * the bottom. The dim fades in and the panel slides up. Works in Expo Go (plain RN Modal).
 *
 * The panel never rises above the status bar: the container is padded by the top safe-area inset
 * (the Dim, absolutely positioned, still covers the whole frame), and the keyboard avoider, the
 * slide-in view and the panel may shrink. Shrinking only happens when the content cannot fit
 * (e.g. 28 with the keyboard up); a `scrollable` panel then scrolls.
 *
 * The Modal's root is `MiModalFrame`, so on Android the dim and the panel reach the physical bottom edge (a `flex: 1` root stopped above the navigation bar).
 */
export function MiSheet({
  visible,
  onClose,
  avoidKeyboard = false,
  onBackdropPress,
  accessibilityLabel,
  panelStyle,
  ...panelProps
}: MiSheetProps) {
  const Pressable = usePressablePrimitive();
  const insets = useSafeAreaInsets();
  const panel = (
    <Animated.View
      entering={SlideInDown.duration(280)}
      accessibilityViewIsModal
      accessibilityLabel={accessibilityLabel}
      style={{ flexShrink: 1 }}
    >
      <MiSheetPanel {...panelProps} style={panelStyle} />
    </Animated.View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <MiModalFrame style={{ justifyContent: 'flex-end', paddingTop: insets.top }}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: mitowColors.dim }]}
          onPress={onBackdropPress}
          disabled={!onBackdropPress}
          pressScale={1}
          haptic={false}
          accessible={false}
          importantForAccessibility="no"
        />
        {avoidKeyboard ? (
          <KeyboardAvoidingView behavior="padding" style={{ flexShrink: 1 }}>
            {panel}
          </KeyboardAvoidingView>
        ) : (
          panel
        )}
      </MiModalFrame>
    </Modal>
  );
}
