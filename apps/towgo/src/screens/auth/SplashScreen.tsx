import React from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { mitowColors, MiSpinner, MiTowLockup } from '@/design';

/**
 * 01 · Splash (Figma `284:1684` on board `225:31`, "Brand moment while the app
 * loads"). Its only exit is the flow arrow to 02 Welcome; nothing on it is tappable.
 *
 * The app draws exactly two things on `surface/page` #FFFFFF:
 * - the crane lockup `421:19938` (173.7 × 90.6), centred on the full frame;
 * - the Loader `284:1848` (32 × 32), 78 from the physical bottom edge, centred.
 * No text, no tagline, no version label. Status bar and home indicator are OS chrome.
 *
 * Edge to edge with no safe-area insets: the design centres the lockup on the full
 * 852 frame and measures the Loader from the frame's bottom edge.
 *
 * Launch sequence the design implies (it draws one splash, light only):
 * 1. The native launch splash (`expo-splash-screen`, held by `FontGate` until the
 *    fonts load) should show this same lockup, centred on #FFFFFF, so the handoff
 *    to this screen is seamless and only the Loader appears. Its image is
 *    `./splash/launch-lockup.png` (1392 × 728 = 174 × 91 dp at 8x, the lockup
 *    centred on a transparent canvas, from `./splash/launch-lockup.svg`); used at
 *    `imageWidth: 174` it draws the artwork at exactly 173.7 dp. A native splash
 *    cannot animate, hence the lockup alone there.
 * 2. This screen. `authStore.hydrate()` is a synchronous MMKV read, so it must be
 *    held on screen with `useSplashHold` (`./splash/useSplashHold`) or it is gone in
 *    about a frame.
 * 3. 02 Welcome (or the signed-in stack).
 */

/** Figma lockup `421:19938` width. Height follows the artwork ratio (90.6174). */
const LOCKUP_WIDTH = 173.7;
/** Figma Loader `284:1848` size. */
const LOADER_SIZE = 32;
/** 852 − (742 + 32): Loader bottom to frame bottom. */
const LOADER_BOTTOM = 78;

export function SplashScreen() {
  return (
    <View style={styles.page}>
      {/*
        Dark glyphs, no bar background (edge to edge): the page is always #FFFFFF.
        This entry must stay. The global ThemedStatusBar asks for 'light' in dark
        theme, and RN merges StatusBar props in MOUNT order with the latest winning.
        App mounts ThemedStatusBar before RootNavigator, so this screen's entry is
        pushed after it, and a theme change re-renders ThemedStatusBar in place
        (replaceStackEntry keeps its position) without overtaking this one.
      */}
      <StatusBar style="dark" />

      <View style={styles.lockupLayer}>
        {/* Figma paints the letterforms #000000 and the pivot / "o" bowl #FFFFFF: the component defaults. */}
        <MiTowLockup artwork="splash" width={LOCKUP_WIDTH} />
      </View>

      <View style={styles.loaderLayer}>
        <MiSpinner size={LOADER_SIZE} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: mitowColors.surfacePage,
  },
  lockupLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  loaderLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: LOADER_BOTTOM,
    alignItems: 'center',
    pointerEvents: 'none',
  },
});
