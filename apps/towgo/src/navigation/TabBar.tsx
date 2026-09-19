import React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { mitowColors, MiTabItem, type MiLineIconName } from '@/design';
import type { RootTabParamList } from './types';

/**
 * Figma Tab Item set `224:49`, as drawn on 08 Home (`226:270`) and pinned on
 * 33 / 34 / 38 / 46.
 *
 * Labels verbatim. Icons are the Figma glyphs through `MiLineIcon` at 30; only
 * the colour changes between states (text/secondary → brand/yellow), each glyph
 * keeping its own solid and outline parts. Support uses `headset-filled`, the
 * headset as the Tab Item draws it (right ear cup filled), which differs from
 * the Help chip's headset.
 */
const TABS: Record<keyof RootTabParamList, { label: string; icon: MiLineIconName }> = {
  Home: { label: 'Home', icon: 'home' },
  Bookings: { label: 'Bookings', icon: 'calendar' },
  SupportTab: { label: 'Support', icon: 'headset-filled' },
  Profile: { label: 'Profile', icon: 'user' },
};

/**
 * Tab Item height as it renders: 30 icon + 1 gap + 16.5 label line (Label 13 is
 * 13/16.5). Figma rounds the item box to 48; using the rendered height keeps the
 * bar at the drawn 84 with the items starting at the drawn 10.3.
 */
const ITEM_HEIGHT = 47.5;
/** Tab Items sit 10.3 below the bar's top edge in both variants. */
const PADDING_TOP = 10.3;
/**
 * The pinned bar's 1 px top stroke takes no layout space in Figma (items stay
 * at y 10.3 in the 84 frame), but a React Native border does, so it comes out
 * of the top padding.
 */
const PINNED_BORDER = 1;
/**
 * The bar is 84 tall on the 393 × 852 frame, INCLUDING the 34 pt home-indicator
 * zone: 10.3 + 48 items + 25.7 below them. So on iOS the items sit 8.3 pt into
 * the indicator zone exactly as drawn; below-item padding is inset − 8.3, never
 * less than the drawn 25.7.
 *
 * Android's bottom inset is a real button / gesture bar the labels must never
 * overlap, so there the padding is the full inset (still never under 25.7).
 */
const DRAWN_BELOW_ITEMS = 84 - PADDING_TOP - ITEM_HEIGHT;
const IOS_INDICATOR_OVERLAP = 34 - DRAWN_BELOW_ITEMS;

/**
 * Bottom clearance a scrolling screen must reserve. The bar is in normal flow,
 * so the navigator already excludes it from the screen area; this is only
 * breathing room under the last row. Kept because tab screens import it.
 */
export function useTabBarSpace(): number {
  return 12;
}

/**
 * Two variants, no shadow in either:
 *
 * - HOME (08): no border and nothing of its own beyond white, so it reads as
 *   the last part of Home's white bottom sheet, exactly as Figma nests it.
 * - PINNED (every other tab, 33 / 34 / 38 / 46): white with a 1 px border/subtle
 *   top border.
 *
 * Pressing Support never selects it: `BottomTabs` intercepts that tab's
 * `tabPress` and pushes root `Support` (58).
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const onHome = state.routes[state.index]?.name === 'Home';

  const paddingBottom =
    Platform.OS === 'ios'
      ? Math.max(DRAWN_BELOW_ITEMS, insets.bottom - IOS_INDICATOR_OVERLAP)
      : Math.max(DRAWN_BELOW_ITEMS, insets.bottom);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: mitowColors.surfacePage,
        paddingTop: onHome ? PADDING_TOP : PADDING_TOP - PINNED_BORDER,
        paddingHorizontal: 5,
        paddingBottom,
        borderTopWidth: onHome ? 0 : PINNED_BORDER,
        borderTopColor: mitowColors.borderSubtle,
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const tab = TABS[route.name as keyof RootTabParamList];
        if (!tab) return null;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          // The selection haptic is fired by the pressable on press-in.
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <MiTabItem
            key={route.key}
            label={tab.label}
            icon={tab.icon}
            active={focused}
            onPress={onPress}
            onLongPress={onLongPress}
            style={{ flex: 1 }}
          />
        );
      })}
    </View>
  );
}
