import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  Dimensions,
  Keyboard,
  LayoutAnimation,
  Platform,
  type KeyboardEvent,
  type View,
} from 'react-native';

export type KeyboardOverlap = {
  /** The software keyboard is up. */
  visible: boolean;
  /**
   * How much of the frame's bottom the keyboard covers, in px. 0 when the
   * window already resized above the keyboard (Android adjustResize).
   */
  overlap: number;
  /** Attach to the measured frame's `onLayout`. */
  onFrameLayout: () => void;
};

type State = { visible: boolean; overlap: number };

const overlapOf = (keyboardTop: number | null, frameBottom: number | null) =>
  keyboardTop === null || frameBottom === null
    ? 0
    : Math.max(0, Math.round(frameBottom - keyboardTop));

/**
 * Tracks the software keyboard against a frame, so a screen that must not
 * scroll (03 Login draws one static frame) can still keep its field above the
 * keyboard. The keyboard-open layout is not drawn in Figma (spec data gap 7).
 *
 * iOS never resizes the window, so the overlap is measured from the keyboard's
 * top edge and animated with the keyboard's own curve, as `KeyboardAvoidingView`
 * does. On Android the window normally shrinks above the keyboard and the
 * overlap comes out 0; if it does not, the same measurement covers it.
 */
export function useKeyboardOverlap(frameRef: RefObject<View | null>): KeyboardOverlap {
  const [state, setState] = useState<State>({ visible: false, overlap: 0 });
  const stateRef = useRef(state);
  const keyboardTop = useRef<number | null>(null);
  const frameBottom = useRef<number | null>(null);

  const apply = useCallback((next: State, event?: KeyboardEvent) => {
    const prev = stateRef.current;
    if (prev.visible === next.visible && prev.overlap === next.overlap) return;
    if (Platform.OS === 'ios' && event?.duration) {
      const duration = Math.max(event.duration, 10);
      LayoutAnimation.configureNext({
        duration,
        update: { duration, type: LayoutAnimation.Types[event.easing] ?? 'keyboard' },
      });
    }
    stateRef.current = next;
    setState(next);
  }, []);

  const onFrameLayout = useCallback(() => {
    frameRef.current?.measureInWindow((_x, y, _width, height) => {
      frameBottom.current = y + height;
      if (keyboardTop.current !== null) {
        apply({ visible: true, overlap: overlapOf(keyboardTop.current, frameBottom.current) });
      }
    });
  }, [apply, frameRef]);

  useEffect(() => {
    const onShow = (event: KeyboardEvent) => {
      const { screenY, height } = event.endCoordinates;
      // iOS reports a closing keyboard as a frame change that ends off screen.
      const offScreen = Platform.OS === 'ios' && screenY >= Dimensions.get('window').height;
      if (height <= 0 || offScreen) {
        keyboardTop.current = null;
        apply({ visible: false, overlap: 0 }, event);
        return;
      }
      keyboardTop.current = screenY;
      if (Platform.OS === 'ios') {
        // The frame does not move on iOS, so the stored measurement holds and
        // the animation can be configured in step with the keyboard.
        // Before the first measurement the frame is the full-height screen.
        const bottom = frameBottom.current ?? Dimensions.get('window').height;
        apply({ visible: true, overlap: overlapOf(screenY, bottom) }, event);
        return;
      }
      frameRef.current?.measureInWindow((_x, y, _width, frameHeight) => {
        frameBottom.current = y + frameHeight;
        // The keyboard may have closed again before the measurement came back.
        if (keyboardTop.current === null) return;
        apply({ visible: true, overlap: overlapOf(keyboardTop.current, frameBottom.current) });
      });
    };

    const onHide = (event: KeyboardEvent) => {
      keyboardTop.current = null;
      apply({ visible: false, overlap: 0 }, event);
    };

    const subscriptions =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillShow', onShow),
            Keyboard.addListener('keyboardWillChangeFrame', (event) => {
              if (keyboardTop.current !== null) onShow(event);
            }),
            Keyboard.addListener('keyboardWillHide', onHide),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', onShow),
            Keyboard.addListener('keyboardDidHide', onHide),
          ];

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [apply, frameRef]);

  return { visible: state.visible, overlap: state.overlap, onFrameLayout };
}
