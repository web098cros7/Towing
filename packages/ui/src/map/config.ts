import { Platform } from 'react-native';

/**
 * Whether `<MapPreview />` renders a real map or the themed placeholder.
 *
 * A SLOT SET BY THE APP AT BOOT, not an env read inside this package.
 * `@towing/ui` is compiled from source by both apps and has no build config of
 * its own; reaching for `process.env` here would make a shared component depend
 * on a variable only one app defines, and would leak app configuration into a
 * package whose whole job is to be configuration-free. It is the same shape as
 * the dependency-free animation slots TowGo fills and MiTow Driver leaves empty.
 *
 * THE PLATFORMS ARE NOT IN THE SAME POSITION, which is why this exists at all.
 * iOS renders through Apple Maps with no key, no billing account and no
 * configuration. Android has no keyless provider: without a Maps SDK key
 * `react-native-maps` draws a blank grey grid with a Google watermark, which is
 * strictly worse than the placeholder — it looks like the app is broken rather
 * than like a map is pending. No key exists yet (SETUP-CHECKLIST item 7).
 */

/**
 * `web` is excluded outright: `react-native-maps` has no web implementation, and
 * the Expo web target is used here for quick component checks.
 */
let androidKeyPresent = false;

export interface MapConfig {
  /** True when `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` is set in the app's build. */
  androidKeyPresent: boolean;
}

/** Call once at app boot, before the first map renders. */
export function configureMaps(config: MapConfig): void {
  androidKeyPresent = config.androidKeyPresent;
}

/**
 * Whether the real map is rendering.
 *
 * Read by screens that must BEHAVE differently rather than merely look
 * different: a draggable pin over the placeholder would let a customer confirm
 * a pickup they cannot see, so `MapPickerScreen` refuses to open instead of
 * pretending. A screen that only looks different should not call this — it
 * should pass props the placeholder ignores.
 */
export function isNativeMapAvailable(): boolean {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS === 'android') return androidKeyPresent;
  return false;
}
