import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type LayoutChangeEvent, type View } from 'react-native';

/**
 * Keeps 04's drawn layout still while the number pad is open.
 *
 * The frame is not scrollable and draws no keyboard: the content column is
 * top-anchored and the Terms line is pinned to the bottom of the screen. Two
 * things break that on a device, and this hook undoes both:
 *
 * 1. Where the window resizes for the keyboard (Android `adjustResize` without
 *    edge-to-edge), a flex layout would lift the Terms line up under the secure
 *    note. `frameHeight` is the tallest height the screen body has had, so the
 *    page keeps its full height and the Terms line stays where it is drawn, behind
 *    the keyboard.
 * 2. Where the keyboard only covers the window (edge-to-edge Android), a short
 *    phone hides the bottom of the column with no way to reach it.
 *    `keyboardOverlap` is how much of the body the keyboard covers; the screen
 *    appends that much scroll room below the page, which moves nothing that is
 *    drawn. iOS gets the same through `automaticallyAdjustKeyboardInsets`.
 */
export function useKeyboardStableFrame() {
  const frameRef = useRef<View>(null);
  const [frameHeight, setFrameHeight] = useState(0);
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);

  const measureOverlap = useCallback((keyboardTop: number) => {
    frameRef.current?.measureInWindow((_x, y, _width, height) => {
      setKeyboardOverlap(Math.max(0, Math.round(y + height - keyboardTop)));
    });
  }, []);

  const onFrameLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { height } = e.nativeEvent.layout;
      setFrameHeight((prev) => (height > prev ? height : prev));
      // Login's keyboard can still be up when this screen mounts, in which case
      // no `keyboardDidShow` arrives for it.
      const metrics =
        Platform.OS === 'android' && Keyboard.isVisible() ? Keyboard.metrics() : undefined;
      if (metrics) measureOverlap(metrics.screenY);
    },
    [measureOverlap],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      measureOverlap(e.endCoordinates.screenY),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [measureOverlap]);

  return { frameRef, onFrameLayout, frameHeight, keyboardOverlap };
}
