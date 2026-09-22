import React from 'react';
import { configureMaps } from '@towing/ui';
import { AppProviders } from '@/providers/AppProviders';
import { ThemedStatusBar } from '@/providers/ThemedStatusBar';
import { RootNavigator } from '@/navigation/RootNavigator';
import { initOnlineManager } from '@/lib/network/onlineManager';
import { env } from '@/lib/env';

/**
 * IMPORTED FOR ITS SIDE EFFECT, and that is the whole point.
 *
 * `driverLocationService` calls `TaskManager.defineTask` at module scope, and
 * that registration MUST happen during the bundle's initial evaluation. When
 * Android relaunches a killed app to deliver a background location update, it
 * runs the bundle and immediately looks up the task by name — if nothing has
 * imported the module by then, the task does not exist and the update is
 * dropped with a warning nobody sees. Importing it from a screen would make the
 * registration depend on which screen the app happened to open.
 */
import '@/lib/location/driverLocationService';

// Bridge connectivity into TanStack Query once, at module load.
initOnlineManager();

/**
 * Tells `@towing/ui` whether `<MapPreview />` can render a real map (Phase 16).
 *
 * The driver app draws no map yet — Phase 18's job execution is the first screen
 * that needs one — but `react-native-maps` is installed here in the same native
 * rebuild as `expo-location`, so the shared component resolves in both apps and
 * this flag is set now rather than being the one thing forgotten later.
 */
configureMaps({ androidKeyPresent: env.mapsAndroidKey.length > 0 });

export default function App() {
  return (
    <AppProviders>
      <ThemedStatusBar />
      <RootNavigator />
    </AppProviders>
  );
}
