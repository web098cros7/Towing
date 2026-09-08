'use client';

import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

/**
 * The current theme, tracked from the `.dark` class on `<html>`.
 *
 * The app has no theme context — `ThemeToggle` just adds/removes that class and
 * everything else reacts through CSS. That works for CSS-driven UI, but MapLibre
 * paints into WebGL and cannot resolve `var(--success)`, so the map needs the
 * mode as a value in order to re-run `setPaintProperty` with literal colours.
 */
export function useThemeMode(): ThemeMode {
  // Always 'light' on the server and for the first client render; the observer
  // corrects it in the same commit, so hydration never sees a mismatch.
  const [mode, setMode] = useState<ThemeMode>('light');

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setMode(root.classList.contains('dark') ? 'dark' : 'light');

    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return mode;
}
