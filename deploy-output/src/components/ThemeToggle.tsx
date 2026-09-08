'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@towing/web-ui';

export const THEME_STORAGE_KEY = 'towfleet-theme';

/** Class-strategy dark-mode toggle, persisted; initial class is applied by the
 * inline script in the root layout to avoid a flash of the wrong theme. */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !(dark ?? false);
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Private-mode storage failures are fine — theme just won't persist.
    }
  };

  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle dark mode">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
