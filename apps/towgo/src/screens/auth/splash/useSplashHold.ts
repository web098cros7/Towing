import { useEffect, useState } from 'react';

/**
 * How long 01 Splash stays on screen at minimum, measured from the moment the JS
 * splash first paints.
 *
 * The design calls 01 a "Brand moment while the app loads" and draws the lockup
 * and the Loader, but the only loading behind it is `authStore.hydrate()`, a
 * synchronous MMKV read. Gated on that alone the drawn screen is gone in about a
 * frame, so it needs a floor to be seen at all.
 *
 * DATA GAP: Figma sets no duration (the prototype reaction on `284:1684` cannot be
 * read and no board states one). 1000 ms is an implementation choice, not a design
 * value: one full turn of the Loader (`MiSpinner`, 900 ms per turn) plus a beat.
 * Replace it when design supplies a number.
 */
export const SPLASH_MIN_VISIBLE_MS = 1000;

/**
 * Whether 01 Splash must still be mounted: while `loading` is true, and in any case
 * until `minVisibleMs` has passed since the calling component mounted.
 *
 * Call it from the component that mounts together with the JS splash, which is
 * `RootNavigator`: `FontGate` renders it only once fonts are ready, on the same
 * layout that hides the native launch splash, so the timer starts when 01 first
 * paints.
 *
 * ```tsx
 * const splashHeld = useSplashHold(status === 'hydrating');
 * {splashHeld ? <Stack.Screen name="Splash" … /> : status === 'unauthenticated' ? …}
 * ```
 * Anything else that would cover the splash (the consent overlay, the push-priming
 * sheet) should wait on `!splashHeld` too.
 */
export function useSplashHold(loading: boolean, minVisibleMs = SPLASH_MIN_VISIBLE_MS): boolean {
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    if (minVisibleMs <= 0) return;
    const timer = setTimeout(() => setMinElapsed(true), minVisibleMs);
    return () => clearTimeout(timer);
  }, [minVisibleMs]);

  return loading || (minVisibleMs > 0 && !minElapsed);
}
