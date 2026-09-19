import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Whether the software keyboard is up. `will*` on iOS so a layout change moves
 * with the keyboard, `did*` on Android where only those fire.
 *
 * The same listener `MiComposer` keeps internally (not exported from `@/design`).
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setOpen(true));
    const hide = Keyboard.addListener(hideEvent, () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return open;
}
