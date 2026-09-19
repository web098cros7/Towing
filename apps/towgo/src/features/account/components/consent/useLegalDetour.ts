import { useCallback, useEffect, useRef, useState } from 'react';
import { navigationRef } from '@/navigation/navigationRef';

/**
 * Opens 56 · Privacy & Legal (route `Legal`) from the consent overlay.
 *
 * The overlay is a Modal rendered as a SIBLING of the NavigationContainer, so it
 * cannot use `useNavigation()` and would cover any screen it pushes. Instead it
 * pushes `Legal` through the container ref, reports `away = true` so the Modal
 * hides while Legal is on screen, and flips back as soon as the customer leaves
 * Legal (back chevron, Android back, swipe). Consent is still required: nothing
 * here records it or lets the customer past it.
 */
export function useLegalDetour() {
  const [away, setAway] = useState(false);
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      unsubscribe.current?.();
      unsubscribe.current = null;
    },
    [],
  );

  const openLegal = useCallback(() => {
    if (!navigationRef.isReady() || unsubscribe.current) return;
    setAway(true);
    navigationRef.navigate('Legal');
    unsubscribe.current = navigationRef.addListener('state', () => {
      if (navigationRef.getCurrentRoute()?.name === 'Legal') return;
      unsubscribe.current?.();
      unsubscribe.current = null;
      setAway(false);
    });
  }, []);

  return { away, openLegal };
}
