import React from 'react';
import { configureMaps } from '@towing/ui';
import { MITOW_MAP_STYLE } from '@/design/tokens/mapStyle';
import { AppProviders } from '@/providers/AppProviders';
import { ThemedStatusBar } from '@/providers/ThemedStatusBar';
import { RootNavigator } from '@/navigation/RootNavigator';
import { initOnlineManager } from '@/lib/network/onlineManager';
import { env } from '@/lib/env';

// Bridge connectivity into TanStack Query once, at module load.
initOnlineManager();

/**
 * Tells `@towing/ui` whether `<MapPreview />` can render a real map (Phase 16).
 *
 * At module load, before the first render: the facade reads this per render and
 * would show the placeholder for one frame otherwise. It is a slot rather than
 * an env read inside the package because `@towing/ui` is compiled from source by
 * both apps and must not depend on a variable only one of them defines.
 *
 * iOS ignores the key entirely (Apple Maps needs none). On Android an empty key
 * keeps the themed placeholder, because `react-native-maps` with no key draws a
 * blank grey grid with a Google watermark — which looks broken rather than
 * pending. SETUP-CHECKLIST item 7.
 */
configureMaps({
  androidKeyPresent: env.mapsAndroidKey.length > 0,
  defaultMapStyle: MITOW_MAP_STYLE,
});

export default function App() {
  return (
    <AppProviders>
      <ThemedStatusBar />
      <RootNavigator />
    </AppProviders>
  );
}
